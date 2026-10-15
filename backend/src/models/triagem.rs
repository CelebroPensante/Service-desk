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
    /// US-22: passo a passo da sugestão de solução (um passo por linha de
    /// `solucao_sugerida`). Não é coluna: é preenchido por `com_passos`.
    #[sqlx(skip)]
    pub passos: Vec<String>,
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

impl NoDecisao {
    pub fn com_passos(mut self) -> Self {
        if self.tipo_no == "sugestao_solucao" {
            if let Some(texto) = &self.solucao_sugerida {
                self.passos = dividir_passos(texto);
            }
        }
        self
    }
}

pub fn dividir_passos(texto: &str) -> Vec<String> {
    texto
        .lines()
        .map(|linha| remover_marcador(linha.trim()).to_string())
        .filter(|linha| !linha.is_empty())
        .collect()
}

fn remover_marcador(linha: &str) -> &str {
    let sem_digitos = linha.trim_start_matches(|c: char| c.is_ascii_digit());
    if sem_digitos.len() != linha.len() {
        if let Some(resto) = sem_digitos.strip_prefix('.').or_else(|| sem_digitos.strip_prefix(')')) {
            if resto.starts_with(char::is_whitespace) {
                return resto.trim_start();
            }
        }
        return linha;
    }
    for marcador in ["- ", "* ", "• "] {
        if let Some(resto) = linha.strip_prefix(marcador) {
            return resto.trim_start();
        }
    }
    linha
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn um_passo_por_linha() {
        let passos = dividir_passos("Ligue o cabo.\nTente ligar de novo.");
        assert_eq!(passos, vec!["Ligue o cabo.", "Tente ligar de novo."]);
    }

    #[test]
    fn remove_numeracao_e_marcadores_digitados() {
        let passos = dividir_passos("1. Um\n2) Dois\n- Três\n* Quatro\n• Cinco");
        assert_eq!(passos, vec!["Um", "Dois", "Três", "Quatro", "Cinco"]);
    }

    #[test]
    fn texto_sem_quebra_vira_um_unico_passo() {
        assert_eq!(dividir_passos("Conecte o cabo.").len(), 1);
    }
}