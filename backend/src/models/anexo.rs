use chrono::NaiveDateTime;
use serde::Serialize;
use sqlx::FromRow;

/// Representação pública do anexo (o que a API devolve).
/// `caminho` e `nome_armazenado` ficam de fora de propósito: são detalhe
/// interno de armazenamento, não devem vazar pro cliente.
#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Anexo {
    pub id: i32,
    pub id_chamado: i32,
    pub id_usuario: i32,
    pub nome_usuario: String,
    pub nome_original: String,
    pub tamanho_bytes: i64,
    pub tipo_mime: String,
    pub data_upload: NaiveDateTime,
    pub excluido: bool,
}

/// Uso interno do handler de download: dados físicos do arquivo no disco.
/// Nunca serializado / exposto via Json.
#[derive(Debug, FromRow)]
pub struct AnexoArquivo {
    pub nome_original: String,
    pub caminho: String,
    pub tipo_mime: String,
}