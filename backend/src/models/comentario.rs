use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct Comentario {
    pub id: i32,
    #[serde(rename = "idChamado")]
    pub id_chamado: i32,
    #[serde(rename = "idUsuario")]
    pub id_usuario: i32,
    pub texto: String,
    #[serde(rename = "dataComentario")]
    pub data_comentario: NaiveDateTime,
    pub privado: bool,
    pub editado_em: Option<NaiveDateTime>, 
    pub excluido: bool, 
}