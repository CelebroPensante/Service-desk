use chrono::NaiveDateTime;
use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct MensagemChat {
    pub id: i32,
    pub id_chamado: i32,
    pub id_usuario: i32,
    pub nome_usuario: String,
    pub texto: String,
    pub data_envio: NaiveDateTime,
}