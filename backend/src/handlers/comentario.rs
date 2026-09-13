use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;

use crate::{models::{Comentario, ErroResposta}, AppState};

fn erro(status: StatusCode, mensagem: impl Into<String>) -> Response {
    (status, Json(ErroResposta::new(mensagem))).into_response()
}

/// GET /api/chamados/:id/comentarios
pub async fn listar_comentarios(
    State(state): State<AppState>,
    Path(id_chamado): Path<i32>,
) -> Response {
    let resultado = sqlx::query_as::<_, Comentario>(
        "SELECT id, id_chamado, id_usuario, texto, data_comentario, privado
         FROM comentario
         WHERE id_chamado = $1
         ORDER BY data_comentario ASC",
    )
    .bind(id_chamado)
    .fetch_all(&state.db)
    .await;

    match resultado {
        Ok(comentarios) => (StatusCode::OK, Json(comentarios)).into_response(),
        Err(e) => {
            tracing::error!("erro ao listar comentários: {e}");
            erro(StatusCode::INTERNAL_SERVER_ERROR, "erro ao listar comentários")
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct NovoComentario {
    pub id_usuario: i32,
    pub texto: String,
    #[serde(default)]
    pub privado: bool,
}

/// POST /api/chamados/:id/comentarios
pub async fn criar_comentario(
    State(state): State<AppState>,
    Path(id_chamado): Path<i32>,
    Json(input): Json<NovoComentario>,
) -> Response {
    if input.texto.trim().is_empty() {
        return erro(StatusCode::BAD_REQUEST, "o comentário não pode estar vazio");
    }

    let resultado = sqlx::query_as::<_, Comentario>(
        "INSERT INTO comentario (id_chamado, id_usuario, texto, privado)
         VALUES ($1, $2, $3, $4)
         RETURNING id, id_chamado, id_usuario, texto, data_comentario, privado",
    )
    .bind(id_chamado)
    .bind(input.id_usuario)
    .bind(input.texto)
    .bind(input.privado)
    .fetch_one(&state.db)
    .await;

    match resultado {
        Ok(comentario) => (StatusCode::CREATED, Json(comentario)).into_response(),
        Err(e) => {
            tracing::error!("erro ao criar comentário: {e}");
            erro(StatusCode::INTERNAL_SERVER_ERROR, "erro ao criar comentário")
        }
    }
}