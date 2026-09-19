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
        Self {
            erro: mensagem.into(),
        }
    }
}

// --- Gestão de Cargos e Permissões ---

#[derive(Debug, Serialize)]
pub struct CargoResumo {
    pub id: i32,
    #[serde(rename = "idPermissao")]
    pub id_permissao: i32,
    pub cargo: String,
    pub nivel: i32,
    pub descricao: String,
}

#[derive(Debug, Deserialize)]
pub struct NovoCargoInput {
    pub cargo: String,
    #[serde(rename = "idPermissao")]
    pub id_permissao: i32,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCargoInput {
    pub cargo: String,
    #[serde(rename = "idPermissao")]
    pub id_permissao: i32,
}

#[derive(Debug, Serialize)]
pub struct NivelPermissao {
    pub id: i32,
    pub nivel: i32,
    pub descricao: String,
}

// --- Gestão de Usuários ---

#[derive(Debug, Serialize)]
pub struct UsuarioResumo {
    pub id: i32,
    pub nome: String,
    pub email: String,
    pub cargo: String,
    #[serde(rename = "idCargo")]
    pub id_cargo: i32,
    pub ativo: bool,
}

#[derive(Debug, Deserialize)]
pub struct AtribuirCargoInput {
    #[serde(rename = "idCargo")]
    pub id_cargo: i32,
}

// --- Gestão de Chamados ---

#[derive(Debug, Serialize)]
pub struct Chamado {
    pub id: i32,

    #[serde(rename = "idUsuario")]
    pub id_usuario: i32,

    #[serde(rename = "idAtendente")]
    pub id_atendente: Option<i32>,

    #[serde(rename = "idCategoria")]
    pub id_categoria: i32,

    #[serde(rename = "idPrioridade")]
    pub id_prioridade: i32,

    #[serde(rename = "idStatus")]
    pub id_status: i32,

    pub titulo: String,

    #[serde(rename = "descricaoDetalhada")]
    pub descricao_detalhada: String,

    pub categoria: String,
    pub prioridade: String,
    pub status: String,

    #[serde(rename = "dataAbertura")]
    pub data_abertura: NaiveDateTime,

    #[serde(rename = "dataResolucao")]
    pub data_resolucao: Option<NaiveDateTime>,

    #[serde(rename = "dataAtualizacao")]
    pub data_atualizacao: NaiveDateTime,
}

#[derive(Debug, Deserialize)]
pub struct NovoChamadoInput {
    pub titulo: String,

    #[serde(rename = "descricaoDetalhada")]
    pub descricao_detalhada: String,

    #[serde(rename = "idCategoria")]
    pub id_categoria: i32,

    #[serde(rename = "idPrioridade")]
    pub id_prioridade: i32,
}

#[derive(Debug, Deserialize)]
pub struct AtualizarChamadoInput {
    pub titulo: String,

    #[serde(rename = "descricaoDetalhada")]
    pub descricao_detalhada: String,

    #[serde(rename = "idCategoria")]
    pub id_categoria: i32,

    #[serde(rename = "idPrioridade")]
    pub id_prioridade: i32,
}

#[derive(Debug, Serialize)]
pub struct CategoriaResumo {
    pub id: i32,
    pub categoria: String,
}

#[derive(Debug, Serialize)]
pub struct PrioridadeResumo {
    pub id: i32,
    pub nivel: i32,
    pub prioridade: String,
}

#[derive(Debug, Serialize)]
pub struct StatusChamadoResumo {
    pub id: i32,
    pub status: String,
}
