use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};

/// Usuario representa a entidade "Usuario" do diagrama relacional do TCC.
/// A senha nunca é serializada em respostas JSON — só existe no banco como hash.

#[derive(Debug, Serialize)]
pub struct Usuario {
    pub id: i32,
    #[serde(rename = "idCargo")]
    pub id_cargo: i32,
    pub nome: String,
    pub email: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub setor: Option<String>,
    #[serde(rename = "dataCadastro")]
    pub data_cadastro: NaiveDateTime,
    pub ativo: bool,
    pub cargo: String,
    #[serde(rename = "nivelAcesso")]
    pub nivel_acesso: i32,
}

/// Dados aceitos para a criação de uma nova conta.
#[derive(Debug, Deserialize)]
pub struct RegisterInput {
    pub nome: String,
    pub email: String,
    pub senha: String,
    #[serde(default)]
    pub setor: Option<String>,
    #[serde(rename = "idCargo", default)]
    pub id_cargo: Option<i32>,
}

/// Dados aceitos no formulário de login.
#[derive(Debug, Deserialize)]
pub struct LoginInput {
    pub email: String,
    pub senha: String,
}

/// Payload devolvido após login/registro bem-sucedidos.
#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub usuario: Usuario,
}

/// Formato padrão de erro devolvido pela API — o frontend lê o campo "erro".
#[derive(Debug, Serialize)]
pub struct ErroResposta {
    pub erro: String,
}

impl ErroResposta {
    pub fn new(mensagem: impl Into<String>) -> Self {
        Self { erro: mensagem.into() }
    }
}
