use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct Comentario {
    pub id: i32,
    pub id_chamado: i32,
    pub id_usuario: i32,
    pub texto: String,
    pub data_comentario: NaiveDateTime,
    pub privado: bool,
}