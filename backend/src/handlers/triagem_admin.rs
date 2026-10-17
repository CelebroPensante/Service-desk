//! US-25: gestão dos fluxos de triagem (somente administradores).
//!
//! Permite criar e editar perguntas, respostas e soluções da árvore sem mexer
//! no código. Duas garantias:
//!   * Consistência: a árvore ativa nunca passa de válida para inválida (sem nós
//!     órfãos, ciclos ou perguntas sem saída). Uma alteração que a quebrasse é
//!     recusada (422) e desfeita.
//!   * Auditoria: toda alteração fica registrada em auditoria_arvore (triggers
//!     do banco), com o usuário que a fez. A API informa o usuário ao banco por
//!     meio de set_config('app.usuario_id').

use axum::{
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use chrono::NaiveDateTime;
use serde::Serialize;
use sqlx::{PgConnection, Postgres, Transaction};

use crate::{
    auth::Claims,
    models::{
        triagem_admin::{
            nos_inalcancaveis, ramo_para_ativar, ramo_para_desativar, validar_arvore, ArestaGrafo, ArvoreAdmin,
            AuditoriaItem, EditarNoInput, EditarOpcaoInput, FiltroAuditoria, NoAdmin, NoGrafo,
            NovaOpcaoInput, NovoNoInput, OpcaoAdmin, Problema, Validacao,
        },
        ErroResposta,
    },
    AppState,
};

const TIPOS: [&str; 3] = ["pergunta", "sugestao_solucao", "etapa_final"];
const TIPO_SUGESTAO: &str = "sugestao_solucao";
const TIPO_ETAPA_FINAL: &str = "etapa_final";
const MAX_PERGUNTA: usize = 500;
const MAX_SOLUCAO: usize = 1000;
const MAX_TEXTO_OPCAO: usize = 200;
/// Serializa as edições da árvore: duas pessoas editando ao mesmo tempo não
/// quebram a validação uma da outra.
const LOCK_EDICAO_ARVORE: i64 = 25_025;

// ---------------------------------------------------------------
// Erros
// ---------------------------------------------------------------

pub enum ErroAdmin {
    NaoEncontrado(&'static str),
    Invalido(String),
    Conflito(String),
    /// A alteração deixaria a árvore ativa inconsistente
    Inconsistente(Vec<Problema>),
    Banco(sqlx::Error),
}

/// Traduz violações de regra do banco em erros amigáveis. Separada do `From`
/// para poder ser testada sem um banco de verdade.
fn erro_de_regra(codigo: Option<&str>, constraint: Option<&str>) -> Option<ErroAdmin> {
    match constraint.unwrap_or("") {
        "uq_opcao_texto_por_no" => {
            return Some(ErroAdmin::Conflito(
                "Já existe uma opção com esse texto nesta pergunta.".into(),
            ))
        }
        "ck_no_solucao_obrigatoria" => {
            return Some(ErroAdmin::Invalido(
                "A sugestão de solução precisa de um texto de solução.".into(),
            ))
        }
        "ck_opcao_origem_nao_terminal" | "fk_opcao_origem" => {
            return Some(ErroAdmin::Invalido(
                "Uma etapa final não pode ter opções de resposta.".into(),
            ))
        }
        "ck_opcao_sem_autoreferencia" => {
            return Some(ErroAdmin::Invalido("Uma opção não pode levar ao próprio nó.".into()))
        }
        _ => {}
    }
    // 23503 = foreign_key_violation; 23001 = restrict_violation (chave com
    // ON DELETE RESTRICT: o código que o PostgreSQL usa depende da versão).
    if matches!(codigo, Some("23503") | Some("23001")) {
        return Some(ErroAdmin::Conflito(
            "Este registro já foi usado em triagens e não pode ser excluído. \
             Desative o nó em vez de excluí-lo."
                .into(),
        ));
    }
    None
}

impl From<sqlx::Error> for ErroAdmin {
    fn from(e: sqlx::Error) -> Self {
        if let Some(db) = e.as_database_error() {
            if let Some(erro) = erro_de_regra(db.code().as_deref(), db.constraint()) {
                return erro;
            }
        }
        ErroAdmin::Banco(e)
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn registro_em_uso_vira_conflito_nos_dois_codigos_do_postgres() {
        // 23001 é o que o PostgreSQL devolve para ON DELETE RESTRICT (o caso do log)
        for codigo in ["23001", "23503"] {
            let erro = erro_de_regra(Some(codigo), Some("fluxo_triagem_no_atual_fkey"));
            assert!(
                matches!(erro, Some(ErroAdmin::Conflito(m)) if m.contains("Desative")),
                "código {codigo} deveria virar 409"
            );
        }
    }

    #[test]
    fn regras_conhecidas_viram_mensagens_especificas() {
        assert!(matches!(
            erro_de_regra(Some("23505"), Some("uq_opcao_texto_por_no")),
            Some(ErroAdmin::Conflito(_))
        ));
        assert!(matches!(
            erro_de_regra(Some("23514"), Some("ck_opcao_origem_nao_terminal")),
            Some(ErroAdmin::Invalido(_))
        ));
    }

    #[test]
    fn erro_desconhecido_continua_sendo_erro_interno() {
        assert!(erro_de_regra(Some("42P01"), None).is_none());
        assert!(erro_de_regra(None, None).is_none());
    }
}

impl IntoResponse for ErroAdmin {
    fn into_response(self) -> Response {
        match self {
            ErroAdmin::NaoEncontrado(m) => {
                (StatusCode::NOT_FOUND, Json(ErroResposta::new(m))).into_response()
            }
            ErroAdmin::Invalido(m) => {
                (StatusCode::BAD_REQUEST, Json(ErroResposta::new(m))).into_response()
            }
            ErroAdmin::Conflito(m) => {
                (StatusCode::CONFLICT, Json(ErroResposta::new(m))).into_response()
            }
            ErroAdmin::Inconsistente(problemas) => {
                let motivos = problemas
                    .iter()
                    .filter(|p| p.gravidade == "erro")
                    .map(|p| p.mensagem.as_str())
                    .collect::<Vec<_>>()
                    .join(" ");
                (
                    StatusCode::UNPROCESSABLE_ENTITY,
                    Json(serde_json::json!({
                        "erro": format!(
                            "Alteração recusada: a árvore ativa ficaria inconsistente. {motivos}"
                        ),
                        "problemas": problemas,
                    })),
                )
                    .into_response()
            }
            ErroAdmin::Banco(e) => {
                tracing::error!("erro na gestão dos fluxos de triagem: {e}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErroResposta::new("erro ao processar a alteração")),
                )
                    .into_response()
            }
        }
    }
}

/// Resposta das alterações: id do registro afetado + validação resultante
/// (inclui avisos que não impedem a alteração).
#[derive(Serialize)]
pub struct Mutacao {
    id: i32,
    /// Nós alterados pela operação (mais de um em ativar/desativar ramo)
    afetados: Vec<i32>,
    /// Dos afetados, os que foram desativados
    desativados: Vec<i32>,
    validacao: Validacao,
}

impl Mutacao {
    fn de(id: i32, validacao: Validacao) -> Self {
        Mutacao { id, afetados: vec![id], desativados: Vec::new(), validacao }
    }
}

// ---------------------------------------------------------------
// Validação e transação
// ---------------------------------------------------------------

type Tx = Transaction<'static, Postgres>;

async fn carregar_grafo(
    conn: &mut PgConnection,
) -> Result<(Vec<NoGrafo>, Vec<ArestaGrafo>), sqlx::Error> {
    let nos = sqlx::query_as::<_, NoGrafo>(
        "SELECT id, pergunta, tipo_no, eh_raiz, ativo FROM no_decisao",
    )
    .fetch_all(&mut *conn)
    .await?;
    let arestas = sqlx::query_as::<_, ArestaGrafo>(
        "SELECT id, id_no_origem, id_no_destino FROM opcao_resposta",
    )
    .fetch_all(&mut *conn)
    .await?;
    Ok((nos, arestas))
}

async fn validar_atual(conn: &mut PgConnection) -> Result<Validacao, sqlx::Error> {
    let (nos, arestas) = carregar_grafo(conn).await?;
    Ok(Validacao::de(validar_arvore(&nos, &arestas)))
}

/// Abre a transação de uma edição: trava edições concorrentes, informa ao banco
/// quem está alterando (auditoria) e guarda se a árvore estava válida antes.
async fn abrir(state: &AppState, claims: &Claims) -> Result<(Tx, bool), ErroAdmin> {
    let mut tx = state.db.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(LOCK_EDICAO_ARVORE)
        .execute(&mut *tx)
        .await?;
    sqlx::query("SELECT set_config('app.usuario_id', $1, true)")
        .bind(claims.user_id.to_string())
        .execute(&mut *tx)
        .await?;
    let antes = validar_atual(&mut tx).await?;
    Ok((tx, antes.valida))
}

/// Confirma a edição, a menos que ela tenha quebrado uma árvore que estava
/// válida. Se já estava inválida, a edição passa (é assim que se conserta).
async fn concluir(mut tx: Tx, valida_antes: bool) -> Result<Validacao, ErroAdmin> {
    let depois = validar_atual(&mut tx).await?;
    if valida_antes && !depois.valida {
        tx.rollback().await?;
        return Err(ErroAdmin::Inconsistente(depois.problemas));
    }
    tx.commit().await?;
    Ok(depois)
}

fn texto_obrigatorio(valor: &str, campo: &str, max: usize) -> Result<String, ErroAdmin> {
    let texto = valor.trim();
    if texto.is_empty() {
        return Err(ErroAdmin::Invalido(format!("{campo} é obrigatório.")));
    }
    if texto.chars().count() > max {
        return Err(ErroAdmin::Invalido(format!(
            "{campo} pode ter no máximo {max} caracteres."
        )));
    }
    Ok(texto.to_string())
}

// ---------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------

/// GET /api/admin/triagem/arvore — todos os nós (ativos e rascunhos) com suas
/// opções, mais a validação de consistência.
pub async fn listar_arvore(State(state): State<AppState>) -> Result<Json<ArvoreAdmin>, ErroAdmin> {
    let mut conn = state.db.acquire().await?;

    let mut nos = sqlx::query_as::<_, NoAdmin>(
        "SELECT id, pergunta, tipo_no, solucao_sugerida, eh_raiz, ativo, versao
         FROM no_decisao ORDER BY id",
    )
    .fetch_all(&mut *conn)
    .await?;

    let opcoes = sqlx::query_as::<_, OpcaoAdmin>(
        "SELECT id, id_no_origem, texto, ordem, id_no_destino, versao
         FROM opcao_resposta ORDER BY id_no_origem, ordem, id",
    )
    .fetch_all(&mut *conn)
    .await?;

    for opcao in opcoes {
        if let Some(no) = nos.iter_mut().find(|n| n.id == opcao.id_no_origem) {
            no.opcoes.push(opcao);
        }
    }

    let validacao = validar_atual(&mut conn).await?;
    Ok(Json(ArvoreAdmin { nos, validacao }))
}

/// GET /api/admin/triagem/validacao
pub async fn consultar_validacao(
    State(state): State<AppState>,
) -> Result<Json<Validacao>, ErroAdmin> {
    let mut conn = state.db.acquire().await?;
    Ok(Json(validar_atual(&mut conn).await?))
}

#[derive(sqlx::FromRow)]
struct AuditoriaLinha {
    id: i64,
    tabela: String,
    operacao: String,
    id_registro: i32,
    dados_anteriores: Option<String>,
    dados_novos: Option<String>,
    id_usuario: Option<i32>,
    nome_usuario: Option<String>,
    data_alteracao: NaiveDateTime,
}

/// GET /api/admin/triagem/auditoria?tabela=&idRegistro=&limite=
/// Histórico de alterações, da mais recente para a mais antiga.
pub async fn listar_auditoria(
    State(state): State<AppState>,
    Query(filtro): Query<FiltroAuditoria>,
) -> Result<Json<Vec<AuditoriaItem>>, ErroAdmin> {
    let limite = filtro.limite.unwrap_or(100).clamp(1, 500);

    let linhas = sqlx::query_as::<_, AuditoriaLinha>(
        "SELECT a.id, a.tabela, a.operacao, a.id_registro,
                a.dados_anteriores::text AS dados_anteriores,
                a.dados_novos::text      AS dados_novos,
                a.id_usuario, u.nome AS nome_usuario, a.data_alteracao
         FROM auditoria_arvore a
         LEFT JOIN usuario u ON u.id = a.id_usuario
         WHERE ($1::text IS NULL OR a.tabela = $1)
           AND ($2::int  IS NULL OR a.id_registro = $2)
         ORDER BY a.id DESC
         LIMIT $3",
    )
    .bind(filtro.tabela)
    .bind(filtro.id_registro)
    .bind(limite)
    .fetch_all(&state.db)
    .await?;

    let itens = linhas
        .into_iter()
        .map(|l| AuditoriaItem {
            id: l.id,
            tabela: l.tabela,
            operacao: l.operacao,
            id_registro: l.id_registro,
            dados_anteriores: l.dados_anteriores.and_then(|s| serde_json::from_str(&s).ok()),
            dados_novos: l.dados_novos.and_then(|s| serde_json::from_str(&s).ok()),
            id_usuario: l.id_usuario,
            nome_usuario: l.nome_usuario,
            data_alteracao: l.data_alteracao,
        })
        .collect();
    Ok(Json(itens))
}

// ---------------------------------------------------------------
// Nós
// ---------------------------------------------------------------

/// POST /api/admin/triagem/nos — cria um nó. Nasce inativo (rascunho), a menos
/// que `ativo: true` seja informado.
pub async fn criar_no(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(input): Json<NovoNoInput>,
) -> Result<(StatusCode, Json<Mutacao>), ErroAdmin> {
    let pergunta = texto_obrigatorio(&input.pergunta, "A pergunta", MAX_PERGUNTA)?;
    if !TIPOS.contains(&input.tipo_no.as_str()) {
        return Err(ErroAdmin::Invalido(
            "Tipo de nó inválido. Use pergunta, sugestao_solucao ou etapa_final.".into(),
        ));
    }
    let solucao = if input.tipo_no == TIPO_SUGESTAO {
        Some(texto_obrigatorio(
            input.solucao_sugerida.as_deref().unwrap_or(""),
            "A solução sugerida",
            MAX_SOLUCAO,
        )?)
    } else if input.solucao_sugerida.as_deref().is_some_and(|s| !s.trim().is_empty()) {
        return Err(ErroAdmin::Invalido(
            "Só sugestões de solução têm texto de solução.".into(),
        ));
    } else {
        None
    };

    let (mut tx, valida_antes) = abrir(&state, &claims).await?;
    let id: i32 = sqlx::query_scalar(
        "INSERT INTO no_decisao (pergunta, tipo_no, solucao_sugerida, ativo)
         VALUES ($1, $2, $3, $4) RETURNING id",
    )
    .bind(pergunta)
    .bind(&input.tipo_no)
    .bind(solucao)
    .bind(input.ativo.unwrap_or(false))
    .fetch_one(&mut *tx)
    .await?;
    let validacao = concluir(tx, valida_antes).await?;
    Ok((StatusCode::CREATED, Json(Mutacao::de(id, validacao))))
}

/// PUT /api/admin/triagem/nos/:id — edita pergunta, solução ou ativação.
/// O tipo do nó não muda depois de criado.
pub async fn editar_no(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
    Json(input): Json<EditarNoInput>,
) -> Result<Json<Mutacao>, ErroAdmin> {
    let nova_pergunta = input
        .pergunta
        .as_deref()
        .map(|p| texto_obrigatorio(p, "A pergunta", MAX_PERGUNTA))
        .transpose()?;

    let (mut tx, valida_antes) = abrir(&state, &claims).await?;

    let atual: Option<(String, String, Option<String>, bool)> = sqlx::query_as(
        "SELECT pergunta, tipo_no, solucao_sugerida, ativo
         FROM no_decisao WHERE id = $1 FOR UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;
    let (pergunta_atual, tipo_no, solucao_atual, ativo_atual) =
        atual.ok_or(ErroAdmin::NaoEncontrado("Nó não encontrado."))?;

    let nova_solucao = match input.solucao_sugerida.as_deref() {
        None => solucao_atual,
        Some(_) if tipo_no != TIPO_SUGESTAO => {
            return Err(ErroAdmin::Invalido(
                "Só sugestões de solução têm texto de solução.".into(),
            ))
        }
        Some(s) => Some(texto_obrigatorio(s, "A solução sugerida", MAX_SOLUCAO)?),
    };

    sqlx::query(
        "UPDATE no_decisao SET pergunta = $2, solucao_sugerida = $3, ativo = $4 WHERE id = $1",
    )
    .bind(id)
    .bind(nova_pergunta.unwrap_or(pergunta_atual))
    .bind(nova_solucao)
    .bind(input.ativo.unwrap_or(ativo_atual))
    .execute(&mut *tx)
    .await?;

    let validacao = concluir(tx, valida_antes).await?;
    Ok(Json(Mutacao::de(id, validacao)))
}

/// DELETE /api/admin/triagem/nos/:id — exclui um nó que nunca foi usado.
/// Nós já percorridos por triagens devem ser desativados, não excluídos.
pub async fn excluir_no(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
) -> Result<Json<Mutacao>, ErroAdmin> {
    let (mut tx, valida_antes) = abrir(&state, &claims).await?;

    let eh_raiz: Option<bool> = sqlx::query_scalar("SELECT eh_raiz FROM no_decisao WHERE id = $1")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?;
    match eh_raiz {
        None => return Err(ErroAdmin::NaoEncontrado("Nó não encontrado.")),
        Some(true) => {
            return Err(ErroAdmin::Conflito(
                "Este é o nó raiz (pergunta inicial). Defina outra raiz antes de excluí-lo.".into(),
            ))
        }
        Some(false) => {}
    }

    sqlx::query("DELETE FROM no_decisao WHERE id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    let validacao = concluir(tx, valida_antes).await?;
    Ok(Json(Mutacao::de(id, validacao)))
}

/// PUT /api/admin/triagem/nos/:id/raiz — define a pergunta inicial da triagem.
/// O nó escolhido é ativado junto com o seu ramo. A raiz anterior passa a ser um
/// nó comum: se a nova raiz chega até ela, continua no ar; senão ela e o que só
/// era alcançável por ela saem do ar (a resposta informa em `desativados`).
pub async fn definir_raiz(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
) -> Result<Json<Mutacao>, ErroAdmin> {
    let (mut tx, valida_antes) = abrir(&state, &claims).await?;

    let existe: Option<i32> = sqlx::query_scalar("SELECT id FROM no_decisao WHERE id = $1 FOR UPDATE")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?;
    if existe.is_none() {
        return Err(ErroAdmin::NaoEncontrado("Nó não encontrado."));
    }

    let (nos, arestas) = carregar_grafo(&mut tx).await?;
    let mut ativar = ramo_para_ativar(id, &nos, &arestas);
    if !ativar.contains(&id) {
        ativar.push(id);
    }

    // Primeiro tira a marca da raiz atual (só pode haver uma)
    sqlx::query("UPDATE no_decisao SET eh_raiz = false WHERE eh_raiz AND id <> $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE no_decisao SET eh_raiz = true WHERE id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE no_decisao SET ativo = true WHERE id = ANY($1)")
        .bind(&ativar)
        .execute(&mut *tx)
        .await?;

    // A raiz antiga e o que só era alcançável por ela saem do ar (senão ficariam órfãos)
    let (nos, arestas) = carregar_grafo(&mut tx).await?;
    let desativados = nos_inalcancaveis(&nos, &arestas);
    if !desativados.is_empty() {
        sqlx::query("UPDATE no_decisao SET ativo = false WHERE id = ANY($1)")
            .bind(&desativados)
            .execute(&mut *tx)
            .await?;
    }

    let validacao = concluir(tx, valida_antes).await?;
    let mut afetados = ativar;
    afetados.extend(desativados.iter().copied());
    Ok(Json(Mutacao { id, afetados, desativados, validacao }))
}

/// PUT /api/admin/triagem/nos/:id/ativar-ramo — publica um cenário: ativa o nó e
/// tudo que parte dele, de uma vez (a árvore é validada no final).
pub async fn ativar_ramo(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
) -> Result<Json<Mutacao>, ErroAdmin> {
    let (mut tx, valida_antes) = abrir(&state, &claims).await?;
    let (nos, arestas) = carregar_grafo(&mut tx).await?;
    if !nos.iter().any(|n| n.id == id) {
        return Err(ErroAdmin::NaoEncontrado("Nó não encontrado."));
    }
    let afetados = ramo_para_ativar(id, &nos, &arestas);
    sqlx::query("UPDATE no_decisao SET ativo = true WHERE id = ANY($1)")
        .bind(&afetados)
        .execute(&mut *tx)
        .await?;
    let validacao = concluir(tx, valida_antes).await?;
    Ok(Json(Mutacao { id, afetados, desativados: Vec::new(), validacao }))
}

/// PUT /api/admin/triagem/nos/:id/desativar-ramo — tira um cenário do ar: desativa
/// o nó e os descendentes que só eram alcançáveis por ele (para não deixar órfãos).
pub async fn desativar_ramo(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
) -> Result<Json<Mutacao>, ErroAdmin> {
    let (mut tx, valida_antes) = abrir(&state, &claims).await?;
    let (nos, arestas) = carregar_grafo(&mut tx).await?;
    if !nos.iter().any(|n| n.id == id) {
        return Err(ErroAdmin::NaoEncontrado("Nó não encontrado."));
    }
    let afetados = ramo_para_desativar(id, &nos, &arestas);
    sqlx::query("UPDATE no_decisao SET ativo = false WHERE id = ANY($1)")
        .bind(&afetados)
        .execute(&mut *tx)
        .await?;
    let validacao = concluir(tx, valida_antes).await?;
    Ok(Json(Mutacao { id, desativados: afetados.clone(), afetados, validacao }))
}

// ---------------------------------------------------------------
// Opções de resposta
// ---------------------------------------------------------------

async fn nos_existe(conn: &mut PgConnection, id: i32) -> Result<bool, sqlx::Error> {
    let r: Option<i32> = sqlx::query_scalar("SELECT id FROM no_decisao WHERE id = $1")
        .bind(id)
        .fetch_optional(conn)
        .await?;
    Ok(r.is_some())
}

/// POST /api/admin/triagem/opcoes — liga um nó a outro por uma resposta.
pub async fn criar_opcao(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(input): Json<NovaOpcaoInput>,
) -> Result<(StatusCode, Json<Mutacao>), ErroAdmin> {
    let texto = texto_obrigatorio(&input.texto, "O texto da resposta", MAX_TEXTO_OPCAO)?;
    if input.id_no_origem == input.id_no_destino {
        return Err(ErroAdmin::Invalido("Uma opção não pode levar ao próprio nó.".into()));
    }

    let (mut tx, valida_antes) = abrir(&state, &claims).await?;

    let tipo_origem: Option<String> =
        sqlx::query_scalar("SELECT tipo_no FROM no_decisao WHERE id = $1 FOR UPDATE")
            .bind(input.id_no_origem)
            .fetch_optional(&mut *tx)
            .await?;
    let tipo_origem = tipo_origem.ok_or(ErroAdmin::NaoEncontrado("Nó de origem não encontrado."))?;
    if tipo_origem == TIPO_ETAPA_FINAL {
        return Err(ErroAdmin::Invalido(
            "Uma etapa final não pode ter opções de resposta.".into(),
        ));
    }
    if !nos_existe(&mut tx, input.id_no_destino).await? {
        return Err(ErroAdmin::NaoEncontrado("Nó de destino não encontrado."));
    }

    let ordem = match input.ordem {
        Some(o) => o,
        None => sqlx::query_scalar::<_, i32>(
            "SELECT COALESCE(MAX(ordem), 0) + 1 FROM opcao_resposta WHERE id_no_origem = $1",
        )
        .bind(input.id_no_origem)
        .fetch_one(&mut *tx)
        .await?,
    };

    let id: i32 = sqlx::query_scalar(
        "INSERT INTO opcao_resposta (id_no_origem, tipo_no_origem, id_no_destino, texto, ordem)
         VALUES ($1, $2, $3, $4, $5) RETURNING id",
    )
    .bind(input.id_no_origem)
    .bind(tipo_origem)
    .bind(input.id_no_destino)
    .bind(texto)
    .bind(ordem)
    .fetch_one(&mut *tx)
    .await?;

    let validacao = concluir(tx, valida_antes).await?;
    Ok((StatusCode::CREATED, Json(Mutacao::de(id, validacao))))
}

/// PUT /api/admin/triagem/opcoes/:id — edita texto, ordem ou destino.
pub async fn editar_opcao(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
    Json(input): Json<EditarOpcaoInput>,
) -> Result<Json<Mutacao>, ErroAdmin> {
    let texto = input
        .texto
        .as_deref()
        .map(|t| texto_obrigatorio(t, "O texto da resposta", MAX_TEXTO_OPCAO))
        .transpose()?;

    let (mut tx, valida_antes) = abrir(&state, &claims).await?;

    let atual: Option<(i32, i32)> = sqlx::query_as(
        "SELECT id_no_origem, id_no_destino FROM opcao_resposta WHERE id = $1 FOR UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;
    let (origem, _) = atual.ok_or(ErroAdmin::NaoEncontrado("Opção não encontrada."))?;

    if let Some(destino) = input.id_no_destino {
        if destino == origem {
            return Err(ErroAdmin::Invalido("Uma opção não pode levar ao próprio nó.".into()));
        }
        if !nos_existe(&mut tx, destino).await? {
            return Err(ErroAdmin::NaoEncontrado("Nó de destino não encontrado."));
        }
    }

    sqlx::query(
        "UPDATE opcao_resposta
         SET texto = COALESCE($2, texto),
             ordem = COALESCE($3, ordem),
             id_no_destino = COALESCE($4, id_no_destino)
         WHERE id = $1",
    )
    .bind(id)
    .bind(texto)
    .bind(input.ordem)
    .bind(input.id_no_destino)
    .execute(&mut *tx)
    .await?;

    let validacao = concluir(tx, valida_antes).await?;
    Ok(Json(Mutacao::de(id, validacao)))
}

/// DELETE /api/admin/triagem/opcoes/:id
pub async fn excluir_opcao(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
) -> Result<Json<Mutacao>, ErroAdmin> {
    let (mut tx, valida_antes) = abrir(&state, &claims).await?;

    let apagada = sqlx::query("DELETE FROM opcao_resposta WHERE id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if apagada == 0 {
        return Err(ErroAdmin::NaoEncontrado("Opção não encontrada."));
    }

    let validacao = concluir(tx, valida_antes).await?;
    Ok(Json(Mutacao::de(id, validacao)))
}