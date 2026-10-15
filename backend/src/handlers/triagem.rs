use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use sqlx::{PgConnection, PgPool};

use crate::{
    auth::Claims,
    models::{
        triagem::{EstadoTriagem, NoDecisao, OpcaoResposta, ResponderInput},
        ErroResposta,
    },
    AppState,
};

const TIPO_ETAPA_FINAL: &str = "etapa_final";
const TIPO_SUGESTAO: &str = "sugestao_solucao";

/// Erros do motor de triagem, convertidos em resposta HTTP.
pub enum ErroTriagem {
    NaoEncontrado(&'static str),
    Conflito(&'static str),
    Invalido(&'static str),
    Banco(sqlx::Error),
}

impl From<sqlx::Error> for ErroTriagem {
    fn from(e: sqlx::Error) -> Self {
        ErroTriagem::Banco(e)
    }
}

impl IntoResponse for ErroTriagem {
    fn into_response(self) -> Response {
        let (status, mensagem) = match self {
            ErroTriagem::NaoEncontrado(m) => (StatusCode::NOT_FOUND, m),
            ErroTriagem::Conflito(m) => (StatusCode::CONFLICT, m),
            ErroTriagem::Invalido(m) => (StatusCode::BAD_REQUEST, m),
            ErroTriagem::Banco(e) => {
                tracing::error!("erro no motor de triagem: {e}");
                (StatusCode::INTERNAL_SERVER_ERROR, "erro ao processar a triagem")
            }
        };
        (status, Json(ErroResposta::new(mensagem))).into_response()
    }
}

/// Linha de fluxo_triagem lida pelo motor.
#[derive(sqlx::FromRow)]
struct FluxoRow {
    no_atual: i32,
    concluido: bool,
}

/// US-22: registra que uma sugestão de solução foi exibida nesta triagem.
/// Base da análise de eficiência (vw_eficiencia_sugestao).
async fn registrar_exibicao(
    conn: &mut PgConnection,
    id_fluxo: i32,
    id_no: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO sugestao_triagem (id_fluxo, id_no) VALUES ($1, $2)")
        .bind(id_fluxo)
        .bind(id_no)
        .execute(conn)
        .await?;
    Ok(())
}

/// US-22: registra a resposta do usuário à sugestão de solução exibida
/// (`resolveu` = true quando confirmou que resolveu; false quando seguiu em
/// frente). Se não houver exibição pendente (ex.: triagem iniciada antes desta
/// funcionalidade existir), registra a sugestão já com a resposta.
async fn registrar_resposta(
    conn: &mut PgConnection,
    id_fluxo: i32,
    id_no: i32,
    resolveu: bool,
) -> Result<(), sqlx::Error> {
    let atualizadas = sqlx::query(
        "UPDATE sugestao_triagem
         SET resolveu = $2, data_resposta = NOW()
         WHERE id_fluxo = $1 AND resolveu IS NULL",
    )
    .bind(id_fluxo)
    .bind(resolveu)
    .execute(&mut *conn)
    .await?
    .rows_affected();

    if atualizadas == 0 {
        sqlx::query(
            "INSERT INTO sugestao_triagem (id_fluxo, id_no, resolveu, data_resposta)
             VALUES ($1, $2, $3, NOW())",
        )
        .bind(id_fluxo)
        .bind(id_no)
        .bind(resolveu)
        .execute(conn)
        .await?;
    }
    Ok(())
}

/// Monta a resposta da API: o nó corrente + opções de resposta lidas do banco.
/// Opções cujo destino está inativo não são oferecidas.
async fn montar_estado(
    db: &PgPool,
    id_fluxo: i32,
    id_no: i32,
    concluido: bool,
) -> Result<EstadoTriagem, ErroTriagem> {
    let no = sqlx::query_as::<_, NoDecisao>(
        "SELECT id, pergunta, tipo_no, solucao_sugerida FROM no_decisao WHERE id = $1",
    )
    .bind(id_no)
    .fetch_one(db)
    .await?
    .com_passos();

    let opcoes = if concluido {
        Vec::new()
    } else {
        sqlx::query_as::<_, OpcaoResposta>(
            "SELECT o.id, o.texto
             FROM opcao_resposta o
             JOIN no_decisao d ON d.id = o.id_no_destino
             WHERE o.id_no_origem = $1 AND d.ativo = true
             ORDER BY o.ordem, o.id",
        )
        .bind(id_no)
        .fetch_all(db)
        .await?
    };

    let resultado = if concluido {
        Some(if no.tipo_no == TIPO_ETAPA_FINAL {
            "abrir_chamado"
        } else {
            "resolvido"
        })
    } else {
        None
    };
    let pode_resolver = !concluido && no.tipo_no == TIPO_SUGESTAO;

    Ok(EstadoTriagem {
        id_fluxo,
        concluido,
        resultado,
        no_atual: no,
        opcoes,
        pode_resolver,
    })
}

/// POST /api/triagem/iniciar
/// Cria uma triagem para o usuário logado, posicionada na pergunta principal
/// (nó raiz) da árvore.
pub async fn iniciar_triagem(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<(StatusCode, Json<EstadoTriagem>), ErroTriagem> {
    let raiz = sqlx::query_as::<_, NoDecisao>(
        "SELECT id, pergunta, tipo_no, solucao_sugerida
         FROM no_decisao
         WHERE eh_raiz = true AND ativo = true",
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or(ErroTriagem::NaoEncontrado(
        "nenhuma árvore de triagem cadastrada",
    ))?;

    let concluido = raiz.tipo_no == TIPO_ETAPA_FINAL;

    let mut tx = state.db.begin().await?;

    let id_fluxo: i32 = sqlx::query_scalar(
        "INSERT INTO fluxo_triagem (id_usuario, no_atual, concluido)
         VALUES ($1, $2, $3)
         RETURNING id",
    )
    .bind(claims.user_id)
    .bind(raiz.id)
    .bind(concluido)
    .fetch_one(&mut *tx)
    .await?;

    // Árvore cuja raiz já é uma sugestão de solução (caso de borda).
    if raiz.tipo_no == TIPO_SUGESTAO {
        registrar_exibicao(&mut tx, id_fluxo, raiz.id).await?;
    }

    tx.commit().await?;

    let estado = montar_estado(&state.db, id_fluxo, raiz.id, concluido).await?;
    Ok((StatusCode::CREATED, Json(estado)))
}

/// GET /api/triagem/:id
/// Devolve a pergunta corrente e as opções de resposta (permite retomar a
/// triagem). Só o dono da triagem acessa.
pub async fn consultar_triagem(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id_fluxo): Path<i32>,
) -> Result<Json<EstadoTriagem>, ErroTriagem> {
    let fluxo = sqlx::query_as::<_, FluxoRow>(
        "SELECT no_atual, concluido FROM fluxo_triagem WHERE id = $1 AND id_usuario = $2",
    )
    .bind(id_fluxo)
    .bind(claims.user_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(ErroTriagem::NaoEncontrado("triagem não encontrada"))?;

    let estado = montar_estado(&state.db, id_fluxo, fluxo.no_atual, fluxo.concluido).await?;
    Ok(Json(estado))
}

/// POST /api/triagem/:id/responder   { "idOpcao": 3 }
/// Resolve o próximo nó a partir da opção escolhida, lida do banco, e avança
/// a triagem. Ao chegar numa etapa final a triagem é concluída.
pub async fn responder_triagem(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id_fluxo): Path<i32>,
    Json(input): Json<ResponderInput>,
) -> Result<Json<EstadoTriagem>, ErroTriagem> {
    let mut tx = state.db.begin().await?;

    // FOR UPDATE: duas respostas simultâneas à mesma triagem não se atropelam.
    let fluxo = sqlx::query_as::<_, FluxoRow>(
        "SELECT no_atual, concluido FROM fluxo_triagem
         WHERE id = $1 AND id_usuario = $2
         FOR UPDATE",
    )
    .bind(id_fluxo)
    .bind(claims.user_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(ErroTriagem::NaoEncontrado("triagem não encontrada"))?;

    if fluxo.concluido {
        return Err(ErroTriagem::Conflito("a triagem já foi concluída"));
    }

    // A opção precisa sair do nó em que a triagem está agora e levar a um nó ativo.
    let (id_destino, tipo_destino, tipo_origem): (i32, String, String) = sqlx::query_as(
        "SELECT d.id, d.tipo_no, o.tipo_no_origem
         FROM opcao_resposta o
         JOIN no_decisao d ON d.id = o.id_no_destino
         WHERE o.id = $1 AND o.id_no_origem = $2 AND d.ativo = true",
    )
    .bind(input.id_opcao)
    .bind(fluxo.no_atual)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(ErroTriagem::Invalido(
        "opção inválida para a pergunta atual",
    ))?;

    let concluido = tipo_destino == TIPO_ETAPA_FINAL;

    // US-22: sair de uma sugestão por uma opção ("Não resolveu") significa que
    // ela não resolveu; chegar a uma sugestão registra que ela foi exibida.
    if tipo_origem == TIPO_SUGESTAO {
        registrar_resposta(&mut tx, id_fluxo, fluxo.no_atual, false).await?;
    }
    if tipo_destino == TIPO_SUGESTAO {
        registrar_exibicao(&mut tx, id_fluxo, id_destino).await?;
    }

    sqlx::query("UPDATE fluxo_triagem SET no_atual = $1, concluido = $2 WHERE id = $3")
        .bind(id_destino)
        .bind(concluido)
        .bind(id_fluxo)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    let estado = montar_estado(&state.db, id_fluxo, id_destino, concluido).await?;
    Ok(Json(estado))
}

/// POST /api/triagem/:id/resolver
/// O usuário confirma que a solução sugerida resolveu o problema: a triagem
/// termina sem abrir chamado. Só vale quando o nó atual é uma sugestão de solução.
pub async fn resolver_triagem(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id_fluxo): Path<i32>,
) -> Result<Json<EstadoTriagem>, ErroTriagem> {
    let mut tx = state.db.begin().await?;

    let fluxo = sqlx::query_as::<_, FluxoRow>(
        "SELECT no_atual, concluido FROM fluxo_triagem
         WHERE id = $1 AND id_usuario = $2
         FOR UPDATE",
    )
    .bind(id_fluxo)
    .bind(claims.user_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(ErroTriagem::NaoEncontrado("triagem não encontrada"))?;

    if fluxo.concluido {
        return Err(ErroTriagem::Conflito("a triagem já foi concluída"));
    }

    let tipo_atual: String = sqlx::query_scalar("SELECT tipo_no FROM no_decisao WHERE id = $1")
        .bind(fluxo.no_atual)
        .fetch_one(&mut *tx)
        .await?;

    if tipo_atual != TIPO_SUGESTAO {
        return Err(ErroTriagem::Conflito(
            "só é possível confirmar a resolução em uma sugestão de solução",
        ));
    }

    // US-22: a resolução na triagem fica registrada para a análise de eficiência.
    registrar_resposta(&mut tx, id_fluxo, fluxo.no_atual, true).await?;

    sqlx::query("UPDATE fluxo_triagem SET concluido = true WHERE id = $1")
        .bind(id_fluxo)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    let estado = montar_estado(&state.db, id_fluxo, fluxo.no_atual, true).await?;
    Ok(Json(estado))
}