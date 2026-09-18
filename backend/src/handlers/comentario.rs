use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;

use crate::{auth::Claims, models::{Comentario, ErroResposta}, AppState};

fn erro(status: StatusCode, mensagem: impl Into<String>) -> Response {
    (status, Json(ErroResposta::new(mensagem))).into_response()
}

/// GET /api/chamados/:id/comentarios
pub async fn listar_comentarios(
    State(state): State<AppState>,
    Path(id_chamado): Path<i32>,
) -> Response {
    let resultado = sqlx::query_as::<_, Comentario>(
        "SELECT id, id_chamado, id_usuario, texto, data_comentario, privado, editado_em, excluido 
         FROM comentario
         WHERE id_chamado = $1 AND excluido = false
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
    pub texto: String,
    #[serde(default)]
    pub privado: bool,
}

/// POST /api/chamados/:id/comentarios
pub async fn criar_comentario(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id_chamado): Path<i32>,
    Json(input): Json<NovoComentario>,
) -> Response {
    if input.texto.trim().is_empty() {
        return erro(StatusCode::BAD_REQUEST, "o comentário não pode estar vazio");
    }

    let resultado = sqlx::query_as::<_, Comentario>(
        "INSERT INTO comentario (id_chamado, id_usuario, texto, privado)
         VALUES ($1, $2, $3, $4)
         RETURNING id, id_chamado, id_usuario, texto, data_comentario, privado, editado_em, excluido",
    )
    .bind(id_chamado)
    .bind(claims.user_id)
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

#[derive(Debug, Deserialize)]
pub struct EdicaoComentario {
    pub texto: String,
}

/// PATCH /api/chamados/:id/comentarios/:comentario_id
pub async fn editar_comentario(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((_id_chamado, comentario_id)): Path<(i32, i32)>,
    Json(input): Json<EdicaoComentario>,
) -> Response {
    if input.texto.trim().is_empty() {
        return erro(StatusCode::BAD_REQUEST, "o comentário não pode estar vazio");
    }

    let resultado = sqlx::query_as::<_, Comentario>(
        "UPDATE comentario
         SET texto = $1, editado_em = now()
         WHERE id = $2 AND id_usuario = $3 AND excluido = false
         RETURNING id, id_chamado, id_usuario, texto, data_comentario, privado, editado_em, excluido",
    )
    .bind(input.texto)
    .bind(comentario_id)
    .bind(claims.user_id)
    .fetch_optional(&state.db)
    .await;

    match resultado {
        Ok(Some(comentario)) => (StatusCode::OK, Json(comentario)).into_response(),
        Ok(None) => erro(StatusCode::FORBIDDEN, "comentario nao encontrado ou sem permissao para editar"),
        Err(e) => {
            tracing::error!("erro ao editar comentario: {e}");
            erro(StatusCode::INTERNAL_SERVER_ERROR, "erro ao editar comentario")
        }
    }
}

/// DELETE /api/chamados/:id/comentarios/:comentario_id
pub async fn excluir_comentario(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((_id_chamado, comentario_id)): Path<(i32, i32)>,
) -> Response {
    let resultado = sqlx::query(
        "UPDATE comentario
         SET excluido = true, excluido_em = now()
         WHERE id = $1 AND id_usuario = $2 AND excluido = false",
    )
    .bind(comentario_id)
    .bind(claims.user_id)
    .execute(&state.db)
    .await;

    match resultado {
        Ok(r) if r.rows_affected() == 1 => StatusCode::NO_CONTENT.into_response(),
        Ok(_) => erro(StatusCode::FORBIDDEN, "comentario nao encontrado ou sem permissao para excluir"),
        Err(e) => {
            tracing::error!("erro ao excluir comentario: {e}");
            erro(StatusCode::INTERNAL_SERVER_ERROR, "erro ao excluir comentario")
        }
    }
}