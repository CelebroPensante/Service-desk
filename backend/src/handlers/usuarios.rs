use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};

use crate::{
    models::{AtribuirCargoInput, ErroResposta, UsuarioResumo},
    AppState,
};

pub async fn listar_usuarios(State(state): State<AppState>) -> Response {
    let usuarios = match sqlx::query_as!(
        UsuarioResumo,
        r#"
        SELECT u.id, u.nome, u.email, c.cargo, u.id_cargo, u.ativo
        FROM usuario u
        JOIN cargo c ON u.id_cargo = c.id
        ORDER BY u.id
        "#
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(res) => res,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErroResposta::new(format!("erro ao buscar usuários: {}", e))),
            )
                .into_response();
        }
    };

    (StatusCode::OK, Json(usuarios)).into_response()
}

pub async fn atribuir_cargo(
    State(state): State<AppState>,
    Path(id): Path<i32>,
    Json(input): Json<AtribuirCargoInput>,
) -> Response {
    let result = sqlx::query!(
        r#"
        UPDATE usuario
        SET id_cargo = $1
        WHERE id = $2
        "#,
        input.id_cargo,
        id
    )
    .execute(&state.db)
    .await;

    match result {
        Ok(res) if res.rows_affected() > 0 => {
            (StatusCode::OK, Json(serde_json::json!({ "mensagem": "Cargo do usuário atualizado" }))).into_response()
        }
        Ok(_) => (StatusCode::NOT_FOUND, Json(ErroResposta::new("usuário não encontrado"))).into_response(),
        Err(sqlx::Error::Database(e)) if e.constraint() == Some("usuario_id_cargo_fkey") => {
            (StatusCode::BAD_REQUEST, Json(ErroResposta::new("cargo inválido"))).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErroResposta::new(format!("erro ao atualizar cargo do usuário: {}", e))),
        ).into_response(),
    }
}
