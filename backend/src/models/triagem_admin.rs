//! US-25: modelos da gestão dos fluxos de triagem e validação de consistência
//! da árvore (sem nós órfãos, sem ciclos, sem perguntas sem saída).

use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::FromRow;
use std::collections::{HashMap, HashSet};

// ---------------------------------------------------------------
// Resposta da API de gestão
// ---------------------------------------------------------------

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct OpcaoAdmin {
    pub id: i32,
    #[serde(skip)]
    pub id_no_origem: i32,
    pub texto: String,
    pub ordem: i32,
    pub id_no_destino: i32,
    pub versao: i32,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct NoAdmin {
    pub id: i32,
    pub pergunta: String,
    pub tipo_no: String,
    pub solucao_sugerida: Option<String>,
    pub eh_raiz: bool,
    pub ativo: bool,
    pub versao: i32,
    /// Preenchido pelo handler a partir de opcao_resposta
    #[sqlx(skip)]
    pub opcoes: Vec<OpcaoAdmin>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Problema {
    /// "erro" invalida a árvore; "aviso" só chama atenção
    pub gravidade: &'static str,
    pub codigo: &'static str,
    pub mensagem: String,
    pub id_no: Option<i32>,
    pub id_opcao: Option<i32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Validacao {
    /// true quando não há nenhum problema de gravidade "erro"
    pub valida: bool,
    pub problemas: Vec<Problema>,
}

impl Validacao {
    pub fn de(problemas: Vec<Problema>) -> Self {
        Validacao {
            valida: !problemas.iter().any(|p| p.gravidade == "erro"),
            problemas,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct ArvoreAdmin {
    pub nos: Vec<NoAdmin>,
    pub validacao: Validacao,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditoriaItem {
    pub id: i64,
    pub tabela: String,
    pub operacao: String,
    pub id_registro: i32,
    pub dados_anteriores: Option<Value>,
    pub dados_novos: Option<Value>,
    pub id_usuario: Option<i32>,
    pub nome_usuario: Option<String>,
    pub data_alteracao: NaiveDateTime,
}

// ---------------------------------------------------------------
// Entradas
// ---------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NovoNoInput {
    pub pergunta: String,
    pub tipo_no: String,
    #[serde(default)]
    pub solucao_sugerida: Option<String>,
    /// Padrão false: o nó nasce como rascunho e só entra no fluxo quando ativado.
    #[serde(default)]
    pub ativo: Option<bool>,
}

/// O tipo do nó não pode ser alterado depois de criado (há registros de
/// triagens e sugestões que dependem dele): para mudar, crie um novo nó.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditarNoInput {
    #[serde(default)]
    pub pergunta: Option<String>,
    #[serde(default)]
    pub solucao_sugerida: Option<String>,
    #[serde(default)]
    pub ativo: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NovaOpcaoInput {
    pub id_no_origem: i32,
    pub id_no_destino: i32,
    pub texto: String,
    #[serde(default)]
    pub ordem: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditarOpcaoInput {
    #[serde(default)]
    pub texto: Option<String>,
    #[serde(default)]
    pub ordem: Option<i32>,
    #[serde(default)]
    pub id_no_destino: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FiltroAuditoria {
    pub tabela: Option<String>,
    pub id_registro: Option<i32>,
    pub limite: Option<i64>,
}

// ---------------------------------------------------------------
// Validação de consistência da árvore
// ---------------------------------------------------------------

/// Nó como a validação enxerga (só o que importa para o grafo).
#[derive(Debug, Clone, FromRow)]
pub struct NoGrafo {
    pub id: i32,
    pub pergunta: String,
    pub tipo_no: String,
    pub eh_raiz: bool,
    pub ativo: bool,
}

/// Opção de resposta como aresta do grafo.
#[derive(Debug, Clone, FromRow)]
pub struct ArestaGrafo {
    pub id: i32,
    pub id_no_origem: i32,
    pub id_no_destino: i32,
}

fn resumo(texto: &str) -> String {
    const MAX: usize = 60;
    if texto.chars().count() <= MAX {
        format!("\"{texto}\"")
    } else {
        let corte: String = texto.chars().take(MAX).collect();
        format!("\"{corte}…\"")
    }
}

/// Arestas entre nós ativos, por origem (o que o motor realmente oferece).
fn mapa_saidas(nos: &[NoGrafo], arestas: &[ArestaGrafo]) -> HashMap<i32, Vec<i32>> {
    let ativos: HashSet<i32> = nos.iter().filter(|n| n.ativo).map(|n| n.id).collect();
    let mut saidas: HashMap<i32, Vec<i32>> = HashMap::new();
    for a in arestas {
        if ativos.contains(&a.id_no_origem) && ativos.contains(&a.id_no_destino) {
            saidas.entry(a.id_no_origem).or_default().push(a.id_no_destino);
        }
    }
    saidas
}

/// Nós alcançáveis a partir de `inicio`; `ignorar` é um nó pelo qual não se passa.
fn alcancar(inicio: i32, saidas: &HashMap<i32, Vec<i32>>, ignorar: Option<i32>) -> HashSet<i32> {
    let mut vistos: HashSet<i32> = HashSet::new();
    let mut pilha = vec![inicio];
    while let Some(u) = pilha.pop() {
        if Some(u) == ignorar || !vistos.insert(u) {
            continue;
        }
        if let Some(proximos) = saidas.get(&u) {
            pilha.extend(proximos.iter().copied());
        }
    }
    vistos
}

/// Nós ativos que não são alcançáveis a partir da raiz ativa (órfãos).
pub fn nos_inalcancaveis(nos: &[NoGrafo], arestas: &[ArestaGrafo]) -> Vec<i32> {
    let Some(raiz) = nos.iter().find(|n| n.ativo && n.eh_raiz) else {
        return Vec::new();
    };
    let alcancaveis = alcancar(raiz.id, &mapa_saidas(nos, arestas), None);
    let mut ids: Vec<i32> = nos
        .iter()
        .filter(|n| n.ativo && !alcancaveis.contains(&n.id))
        .map(|n| n.id)
        .collect();
    ids.sort();
    ids
}

/// Valida a árvore **ativa** (nós inativos são rascunhos e ficam de fora).
///
/// Erros:
///   SEM_RAIZ            não há nó raiz ativo
///   NO_ORFAO            nó ativo que não pode ser alcançado a partir da raiz
///   CICLO               o fluxo volta a um nó anterior (a triagem nunca terminaria)
///   PERGUNTA_SEM_OPCAO  pergunta ativa sem nenhuma opção que leve a um nó ativo
/// Avisos:
///   SUGESTAO_SEM_SAIDA     sugestão sem opção: só dá para confirmar que resolveu
///   OPCAO_PARA_NO_INATIVO  opção de um nó ativo que leva a um nó inativo (fica oculta)
pub fn validar_arvore(nos: &[NoGrafo], arestas: &[ArestaGrafo]) -> Vec<Problema> {
    let mut problemas = Vec::new();
    let por_id: HashMap<i32, &NoGrafo> = nos.iter().map(|n| (n.id, n)).collect();
    let ativos: Vec<&NoGrafo> = nos.iter().filter(|n| n.ativo).collect();

    // Arestas entre nós ativos (o que o motor realmente oferece ao usuário)
    let mut saidas: HashMap<i32, Vec<i32>> = HashMap::new();
    for n in &ativos {
        saidas.entry(n.id).or_default();
    }
    for a in arestas {
        let (Some(o), Some(d)) = (por_id.get(&a.id_no_origem), por_id.get(&a.id_no_destino)) else {
            continue;
        };
        if o.ativo && d.ativo {
            saidas.entry(o.id).or_default().push(d.id);
        } else if o.ativo && !d.ativo {
            problemas.push(Problema {
                gravidade: "aviso",
                codigo: "OPCAO_PARA_NO_INATIVO",
                mensagem: format!(
                    "Uma opção de {} leva ao nó inativo {}; ela fica oculta para o usuário.",
                    resumo(&o.pergunta),
                    resumo(&d.pergunta)
                ),
                id_no: Some(o.id),
                id_opcao: Some(a.id),
            });
        }
    }

    // 1) Raiz
    let raiz = ativos.iter().find(|n| n.eh_raiz);
    match raiz {
        None => {
            let inativa = nos.iter().any(|n| n.eh_raiz && !n.ativo);
            problemas.push(Problema {
                gravidade: "erro",
                codigo: "SEM_RAIZ",
                mensagem: if inativa {
                    "O nó raiz (pergunta inicial) está inativo: a triagem não consegue começar.".into()
                } else {
                    "Não há nó raiz: defina a pergunta inicial da triagem.".into()
                },
                id_no: None,
                id_opcao: None,
            });
        }
        Some(r) => {
            // 2) Órfãos: nós ativos inalcançáveis a partir da raiz
            let vistos = alcancar(r.id, &saidas, None);
            for n in &ativos {
                if !vistos.contains(&n.id) {
                    problemas.push(Problema {
                        gravidade: "erro",
                        codigo: "NO_ORFAO",
                        mensagem: format!(
                            "O nó {} está ativo, mas nenhuma resposta leva até ele a partir da pergunta inicial.",
                            resumo(&n.pergunta)
                        ),
                        id_no: Some(n.id),
                        id_opcao: None,
                    });
                }
            }
        }
    }

    // 3) Ciclos (componentes fortemente conexos com mais de um nó, ou com laço)
    for grupo in componentes_ciclicos(&ativos, &saidas) {
        let nomes: Vec<String> = grupo
            .iter()
            .filter_map(|id| por_id.get(id).map(|n| resumo(&n.pergunta)))
            .collect();
        problemas.push(Problema {
            gravidade: "erro",
            codigo: "CICLO",
            mensagem: format!(
                "O fluxo volta a um nó anterior (ciclo): {}.",
                nomes.join(" → ")
            ),
            id_no: grupo.first().copied(),
            id_opcao: None,
        });
    }

    // 4) Becos sem saída
    for n in &ativos {
        let sem_saida = saidas.get(&n.id).map_or(true, |s| s.is_empty());
        if !sem_saida {
            continue;
        }
        match n.tipo_no.as_str() {
            "pergunta" => problemas.push(Problema {
                gravidade: "erro",
                codigo: "PERGUNTA_SEM_OPCAO",
                mensagem: format!(
                    "A pergunta {} não tem nenhuma opção de resposta ativa: o usuário ficaria sem saída.",
                    resumo(&n.pergunta)
                ),
                id_no: Some(n.id),
                id_opcao: None,
            }),
            "sugestao_solucao" => problemas.push(Problema {
                gravidade: "aviso",
                codigo: "SUGESTAO_SEM_SAIDA",
                mensagem: format!(
                    "A sugestão {} não tem opções: se não resolver, o usuário não tem para onde seguir (por exemplo, abrir chamado).",
                    resumo(&n.pergunta)
                ),
                id_no: Some(n.id),
                id_opcao: None,
            }),
            _ => {}
        }
    }

    problemas
}

/// Nós inativos do ramo que começa em `id` (o próprio nó e tudo que é alcançável
/// a partir dele, ativo ou não). Ativar um ramo inteiro de uma vez é a única forma
/// de publicar um cenário novo: ativar nó a nó deixaria cada um órfão ou sem saída
/// no meio do caminho.
pub fn ramo_para_ativar(id: i32, nos: &[NoGrafo], arestas: &[ArestaGrafo]) -> Vec<i32> {
    let ativo: HashMap<i32, bool> = nos.iter().map(|n| (n.id, n.ativo)).collect();
    let mut saidas: HashMap<i32, Vec<i32>> = HashMap::new();
    for a in arestas {
        saidas.entry(a.id_no_origem).or_default().push(a.id_no_destino);
    }
    let mut vistos: HashSet<i32> = HashSet::new();
    let mut pilha = vec![id];
    while let Some(u) = pilha.pop() {
        if !ativo.contains_key(&u) || !vistos.insert(u) {
            continue;
        }
        if let Some(proximos) = saidas.get(&u) {
            pilha.extend(proximos.iter().copied());
        }
    }
    let mut ids: Vec<i32> = vistos.into_iter().filter(|u| !ativo[u]).collect();
    ids.sort();
    ids
}

/// Nós que devem ser desativados junto com `id` para não deixar órfãos: o próprio
/// nó e os descendentes ativos que só eram alcançáveis passando por ele.
/// Descendentes que continuam alcançáveis por outro caminho a partir da raiz ficam.
pub fn ramo_para_desativar(id: i32, nos: &[NoGrafo], arestas: &[ArestaGrafo]) -> Vec<i32> {
    let ativos: HashSet<i32> = nos.iter().filter(|n| n.ativo).map(|n| n.id).collect();
    let saidas = mapa_saidas(nos, arestas);

    // O que continua alcançável a partir da raiz sem passar por `id`
    let alcancaveis = match nos.iter().find(|n| n.ativo && n.eh_raiz) {
        Some(raiz) => alcancar(raiz.id, &saidas, Some(id)),
        None => HashSet::new(),
    };

    let mut ids: Vec<i32> = alcancar(id, &saidas, None)
        .into_iter()
        .filter(|u| *u == id || (ativos.contains(u) && !alcancaveis.contains(u)))
        .collect();
    ids.sort();
    ids
}

/// Tarjan: devolve os grupos de nós que formam ciclo, cada um na ordem do caminho.
fn componentes_ciclicos(ativos: &[&NoGrafo], saidas: &HashMap<i32, Vec<i32>>) -> Vec<Vec<i32>> {
    struct Estado<'a> {
        saidas: &'a HashMap<i32, Vec<i32>>,
        indice: HashMap<i32, usize>,
        baixo: HashMap<i32, usize>,
        na_pilha: HashSet<i32>,
        pilha: Vec<i32>,
        contador: usize,
        grupos: Vec<Vec<i32>>,
    }

    fn visitar(e: &mut Estado, u: i32) {
        e.indice.insert(u, e.contador);
        e.baixo.insert(u, e.contador);
        e.contador += 1;
        e.pilha.push(u);
        e.na_pilha.insert(u);

        let proximos = e.saidas.get(&u).cloned().unwrap_or_default();
        for v in proximos {
            if !e.indice.contains_key(&v) {
                visitar(e, v);
                let b = e.baixo[&u].min(e.baixo[&v]);
                e.baixo.insert(u, b);
            } else if e.na_pilha.contains(&v) {
                let b = e.baixo[&u].min(e.indice[&v]);
                e.baixo.insert(u, b);
            }
        }

        if e.baixo[&u] == e.indice[&u] {
            let mut grupo = Vec::new();
            while let Some(w) = e.pilha.pop() {
                e.na_pilha.remove(&w);
                grupo.push(w);
                if w == u {
                    break;
                }
            }
            let tem_laco = grupo.len() == 1
                && e.saidas.get(&u).is_some_and(|s| s.contains(&u));
            if grupo.len() > 1 || tem_laco {
                grupo.reverse();
                e.grupos.push(grupo);
            }
        }
    }

    let mut estado = Estado {
        saidas,
        indice: HashMap::new(),
        baixo: HashMap::new(),
        na_pilha: HashSet::new(),
        pilha: Vec::new(),
        contador: 0,
        grupos: Vec::new(),
    };
    for n in ativos {
        if !estado.indice.contains_key(&n.id) {
            visitar(&mut estado, n.id);
        }
    }
    estado.grupos
}

#[cfg(test)]
mod testes {
    use super::*;

    fn no(id: i32, tipo: &str, raiz: bool, ativo: bool) -> NoGrafo {
        NoGrafo {
            id,
            pergunta: format!("nó {id}"),
            tipo_no: tipo.into(),
            eh_raiz: raiz,
            ativo,
        }
    }

    fn aresta(id: i32, o: i32, d: i32) -> ArestaGrafo {
        ArestaGrafo { id, id_no_origem: o, id_no_destino: d }
    }

    fn codigos(p: &[Problema]) -> Vec<&'static str> {
        let mut c: Vec<_> = p.iter().map(|x| x.codigo).collect();
        c.sort();
        c
    }

    /// Mesmo formato do seed: raiz -> pergunta -> sugestão/finais.
    fn arvore_valida() -> (Vec<NoGrafo>, Vec<ArestaGrafo>) {
        (
            vec![
                no(1, "pergunta", true, true),
                no(2, "pergunta", false, true),
                no(3, "sugestao_solucao", false, true),
                no(4, "etapa_final", false, true),
            ],
            vec![aresta(1, 1, 2), aresta(2, 1, 4), aresta(3, 2, 3), aresta(4, 2, 4), aresta(5, 3, 4)],
        )
    }

    #[test]
    fn arvore_valida_nao_tem_problemas() {
        let (n, a) = arvore_valida();
        assert!(validar_arvore(&n, &a).is_empty());
    }

    #[test]
    fn detecta_no_orfao() {
        let (mut n, a) = arvore_valida();
        n.push(no(9, "etapa_final", false, true));
        let p = validar_arvore(&n, &a);
        assert_eq!(codigos(&p), vec!["NO_ORFAO"]);
        assert_eq!(p[0].id_no, Some(9));
    }

    #[test]
    fn no_inativo_nao_conta_como_orfao() {
        let (mut n, a) = arvore_valida();
        n.push(no(9, "etapa_final", false, false));
        assert!(validar_arvore(&n, &a).is_empty());
    }

    #[test]
    fn detecta_ciclo() {
        let (n, mut a) = arvore_valida();
        a.push(aresta(6, 3, 1)); // sugestão volta para a raiz
        let p = validar_arvore(&n, &a);
        assert_eq!(codigos(&p), vec!["CICLO"]);
        assert!(p[0].mensagem.contains("nó 1") && p[0].mensagem.contains("nó 3"));
    }

    #[test]
    fn detecta_laco_em_um_unico_no() {
        let (n, mut a) = arvore_valida();
        a.push(aresta(6, 2, 2));
        assert!(codigos(&validar_arvore(&n, &a)).contains(&"CICLO"));
    }

    #[test]
    fn ciclo_so_entre_nos_inativos_e_ignorado() {
        let (mut n, mut a) = arvore_valida();
        n.push(no(8, "pergunta", false, false));
        n.push(no(9, "pergunta", false, false));
        a.push(aresta(6, 8, 9));
        a.push(aresta(7, 9, 8));
        assert!(validar_arvore(&n, &a).is_empty());
    }

    #[test]
    fn detecta_falta_de_raiz() {
        let (mut n, a) = arvore_valida();
        n[0].eh_raiz = false;
        assert!(codigos(&validar_arvore(&n, &a)).contains(&"SEM_RAIZ"));
    }

    #[test]
    fn raiz_inativa_e_erro() {
        let (mut n, a) = arvore_valida();
        n[0].ativo = false;
        let p = validar_arvore(&n, &a);
        assert!(p.iter().any(|x| x.codigo == "SEM_RAIZ" && x.mensagem.contains("inativo")));
    }

    #[test]
    fn pergunta_sem_opcao_e_erro_e_sugestao_sem_opcao_e_aviso() {
        let (n, a) = arvore_valida();
        // tira as opções da pergunta 2 e da sugestão 3
        let a: Vec<_> = a.into_iter().filter(|x| x.id_no_origem != 2 && x.id_no_origem != 3).collect();
        let p = validar_arvore(&n, &a);
        assert!(p.iter().any(|x| x.codigo == "PERGUNTA_SEM_OPCAO" && x.gravidade == "erro"));
        // com a pergunta 2 sem saída, 3 vira órfã
        assert!(p.iter().any(|x| x.codigo == "NO_ORFAO" && x.id_no == Some(3)));
        assert!(p.iter().any(|x| x.codigo == "SUGESTAO_SEM_SAIDA" && x.gravidade == "aviso"));
    }

    #[test]
    fn opcao_para_no_inativo_e_so_aviso() {
        let (mut n, a) = arvore_valida();
        n[2].ativo = false; // sugestão inativa; a pergunta 2 ainda tem a opção para o nó 4
        let p = validar_arvore(&n, &a);
        assert_eq!(codigos(&p), vec!["OPCAO_PARA_NO_INATIVO"]);
        assert!(Validacao::de(p).valida);
    }

    #[test]
    fn valida_reflete_apenas_os_erros() {
        let (n, a) = arvore_valida();
        assert!(Validacao::de(validar_arvore(&n, &a)).valida);
        let (mut n2, a2) = arvore_valida();
        n2.push(no(9, "etapa_final", false, true));
        assert!(!Validacao::de(validar_arvore(&n2, &a2)).valida);
    }

    #[test]
    fn ativar_ramo_pega_o_no_e_todos_os_descendentes_inativos() {
        let (mut n, mut a) = arvore_valida();
        // cenário novo, todo inativo: 10 -> 11 -> 12 e 10 -> 12
        n.push(no(10, "pergunta", false, false));
        n.push(no(11, "sugestao_solucao", false, false));
        n.push(no(12, "etapa_final", false, false));
        a.push(aresta(10, 10, 11));
        a.push(aresta(11, 10, 12));
        a.push(aresta(12, 11, 12));
        // liga o cenário à árvore ativa
        a.push(aresta(13, 2, 10));
        assert_eq!(ramo_para_ativar(10, &n, &a), vec![10, 11, 12]);
        // nós já ativos não entram na lista
        assert_eq!(ramo_para_ativar(2, &n, &a), vec![10, 11, 12]);
    }

    #[test]
    fn ativar_ramo_resolve_o_impasse_de_publicar_um_cenario_novo() {
        let (mut n, mut a) = arvore_valida();
        n.push(no(10, "pergunta", false, false));
        n.push(no(11, "etapa_final", false, false));
        a.push(aresta(10, 10, 11));
        a.push(aresta(11, 2, 10)); // pergunta 2 aponta para o cenário novo (inativo)
        // ativar só o nó 10 deixa uma pergunta ativa sem opção ativa
        n[4].ativo = true;
        assert!(!Validacao::de(validar_arvore(&n, &a)).valida);
        // ativando o ramo inteiro a árvore fica válida
        n[4].ativo = false;
        for id in ramo_para_ativar(10, &n, &a) {
            n.iter_mut().find(|x| x.id == id).unwrap().ativo = true;
        }
        assert!(Validacao::de(validar_arvore(&n, &a)).valida);
    }

    #[test]
    fn desativar_ramo_leva_so_quem_ficaria_orfao() {
        // raiz 1 -> 2 -> 3(final); 1 -> 4(final); 2 -> 4
        let n = vec![
            no(1, "pergunta", true, true),
            no(2, "pergunta", false, true),
            no(3, "etapa_final", false, true),
            no(4, "etapa_final", false, true),
        ];
        let a = vec![aresta(1, 1, 2), aresta(2, 1, 4), aresta(3, 2, 3), aresta(4, 2, 4)];
        // 3 só é alcançável por 2; 4 continua alcançável direto da raiz
        assert_eq!(ramo_para_desativar(2, &n, &a), vec![2, 3]);
    }

    #[test]
    fn desativar_folha_leva_so_a_folha() {
        let (n, a) = arvore_valida();
        assert_eq!(ramo_para_desativar(4, &n, &a), vec![4]);
    }

    #[test]
    fn trocar_a_raiz_deixa_a_raiz_antiga_e_seu_ramo_inalcancaveis() {
        // raiz nova 20 (ativa) sem ligação com a árvore antiga (1..4)
        let (mut n, mut a) = arvore_valida();
        n.push(no(20, "pergunta", true, true));
        n.push(no(21, "etapa_final", false, true));
        a.push(aresta(20, 20, 21));
        n[0].eh_raiz = false; // a raiz antiga deixa de ser raiz
        assert_eq!(nos_inalcancaveis(&n, &a), vec![1, 2, 3, 4]);
        // se a nova raiz alcança a antiga, ninguém fica inalcançável
        a.push(aresta(21, 20, 1));
        assert!(nos_inalcancaveis(&n, &a).is_empty());
    }
}