use chrono::NaiveDateTime;
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

impl NoDecisao {
    /// Separa `solucao_sugerida` em passos. Só vale para sugestão de solução;
    /// nos demais tipos de nó a lista fica vazia.
    pub fn com_passos(mut self) -> Self {
        if self.tipo_no == "sugestao_solucao" {
            if let Some(texto) = &self.solucao_sugerida {
                self.passos = dividir_passos(texto);
            }
        }
        self
    }
}

/// Divide o texto de uma solução em passos: um por linha, ignorando linhas
/// vazias e removendo numeração/marcadores digitados à mão ("1.", "2)", "-"),
/// já que a tela numera os passos sozinha.
pub fn dividir_passos(texto: &str) -> Vec<String> {
    texto
        .lines()
        .map(|linha| remover_marcador(linha.trim()).to_string())
        .filter(|linha| !linha.is_empty())
        .collect()
}

fn remover_marcador(linha: &str) -> &str {
    // "1. texto", "2) texto"
    let sem_digitos = linha.trim_start_matches(|c: char| c.is_ascii_digit());
    if sem_digitos.len() != linha.len() {
        if let Some(resto) = sem_digitos.strip_prefix('.').or_else(|| sem_digitos.strip_prefix(')')) {
            if resto.starts_with(char::is_whitespace) {
                return resto.trim_start();
            }
        }
        return linha;
    }
    // "- texto", "* texto", "• texto"
    for marcador in ["- ", "* ", "• "] {
        if let Some(resto) = linha.strip_prefix(marcador) {
            return resto.trim_start();
        }
    }
    linha
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
    /// US-23: como o chamado será preenchido (só na etapa final).
    pub preenchimento: Option<PreenchimentoChamado>,
}

/// US-23: categoria, prioridade e setor definidos pela etapa final da árvore.
/// Cada campo é nulo quando a etapa final não o define.
#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PreenchimentoChamado {
    pub id_categoria: Option<i32>,
    pub categoria: Option<String>,
    pub id_prioridade: Option<i32>,
    pub prioridade: Option<String>,
    pub id_setor: Option<i32>,
    pub setor: Option<String>,
}

/// US-24: um passo do percurso (pergunta apresentada + resposta selecionada).
#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PassoTriagem {
    pub ordem: i32,
    pub pergunta: String,
    pub resposta: String,
    pub data_resposta: NaiveDateTime,
}

/// US-24: percurso completo de uma triagem, em ordem.
/// `historico` é o mesmo percurso em texto (coluna fluxo_triagem.historico).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PercursoTriagem {
    pub id_fluxo: i32,
    pub concluido: bool,
    pub passos: Vec<PassoTriagem>,
    pub historico: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponderInput {
    pub id_opcao: i32,
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
    fn ignora_linhas_vazias_e_espacos() {
        let passos = dividir_passos("  Primeiro  \n\n   \r\nSegundo\r\n");
        assert_eq!(passos, vec!["Primeiro", "Segundo"]);
    }

    #[test]
    fn remove_numeracao_e_marcadores_digitados() {
        let passos = dividir_passos("1. Um\n2) Dois\n- Três\n* Quatro\n• Cinco");
        assert_eq!(passos, vec!["Um", "Dois", "Três", "Quatro", "Cinco"]);
    }

    #[test]
    fn nao_confunde_numero_no_inicio_do_texto_com_numeracao() {
        let passos = dividir_passos("3 cabos precisam estar conectados\n2.5 metros de cabo");
        assert_eq!(
            passos,
            vec!["3 cabos precisam estar conectados", "2.5 metros de cabo"]
        );
    }

    #[test]
    fn texto_sem_quebra_vira_um_unico_passo() {
        let passos = dividir_passos("Conecte o cabo e tente ligar novamente.");
        assert_eq!(passos.len(), 1);
    }

    fn no(tipo: &str, solucao: Option<&str>) -> NoDecisao {
        NoDecisao {
            id: 1,
            pergunta: "x".into(),
            tipo_no: tipo.into(),
            solucao_sugerida: solucao.map(String::from),
            passos: Vec::new(),
        }
    }

    #[test]
    fn so_sugestao_de_solucao_tem_passos() {
        assert_eq!(no("sugestao_solucao", Some("A\nB")).com_passos().passos.len(), 2);
        assert!(no("pergunta", Some("A\nB")).com_passos().passos.is_empty());
        assert!(no("etapa_final", None).com_passos().passos.is_empty());
    }
}
