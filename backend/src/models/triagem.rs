use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Nó da árvore de decisão (tabela no_decisao): pergunta, sugestão de solução
/// ou etapa final.
#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct NoDecisao {
    pub id: i32,
    pub pergunta: String,
    pub tipo_no: String,
    pub solucao_sugerida: Option<String>,
}

/// Opção de resposta exibida ao usuário (tabela opcao_resposta). O destino não
/// é exposto: quem decide o próximo nó é o backend.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct OpcaoResposta {
    pub id: i32,
    pub texto: String,
}

/// Estado atual de uma triagem: a pergunta corrente e as opções de resposta.
///
/// `resultado` só vem preenchido quando a triagem termina:
///   - "abrir_chamado": chegou a uma etapa final (o frontend segue para a abertura do chamado)
///   - "resolvido":     o usuário confirmou que a solução sugerida resolveu
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EstadoTriagem {
    pub id_fluxo: i32,
    pub concluido: bool,
    pub resultado: Option<&'static str>,
    pub no_atual: NoDecisao,
    pub opcoes: Vec<OpcaoResposta>,
    pub pode_resolver: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponderInput {
    pub id_opcao: i32,
}