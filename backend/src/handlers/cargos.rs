use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};

use crate::{
    models::{CargoResumo, ErroResposta, NivelPermissao, NovoCargoInput, UpdateCargoInput},
    AppState,
};

pub async fn listar_cargos(State(state): State<AppState>) -> Response {
    let cargos = match sqlx::query_as!(
        CargoResumo,
        r#"
        SELECT c.id, c.id_permissao, c.cargo, np.nivel, np.descricao
        FROM cargo c
        JOIN nivel_permissao np ON c.id_permissao = np.id
        ORDER BY c.id
        "#
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(res) => res,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErroResposta::new(format!("erro ao buscar cargos: {}", e))),
            )
                .into_response();
        }
    };

    (StatusCode::OK, Json(cargos)).into_response()
}

pub async fn criar_cargo(
    State(state): State<AppState>,
    Json(input): Json<NovoCargoInput>,
) -> Response {
    let result = sqlx::query!(
        r#"
        INSERT INTO cargo (cargo, id_permissao)
        VALUES ($1, $2)
        RETURNING id
        "#,
        input.cargo,
        input.id_permissao
    )
    .fetch_one(&state.db)
    .await;

    match result {
        Ok(row) => (
            StatusCode::CREATED,
            Json(serde_json::json!({ "id": row.id, "mensagem": "Cargo criado com sucesso" })),
        )
            .into_response(),
        Err(sqlx::Error::Database(e)) if e.constraint() == Some("cargo_cargo_key") => (
            StatusCode::CONFLICT,
            Json(ErroResposta::new("já existe um cargo com este nome")),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErroResposta::new(format!("erro ao criar cargo: {}", e))),
        )
            .into_response(),
    }
}

pub async fn atualizar_cargo(
    State(state): State<AppState>,
    Path(id): Path<i32>,
    Json(input): Json<UpdateCargoInput>,
) -> Response {
    let result = sqlx::query!(
        r#"
        UPDATE cargo
        SET cargo = $1, id_permissao = $2
        WHERE id = $3
        "#,
        input.cargo,
        input.id_permissao,
        id
    )
    .execute(&state.db)
    .await;

    match result {
        Ok(res) if res.rows_affected() > 0 => {
            (StatusCode::OK, Json(serde_json::json!({ "mensagem": "Cargo atualizado" }))).into_response()
        }
        Ok(_) => (StatusCode::NOT_FOUND, Json(ErroResposta::new("cargo não encontrado"))).into_response(),
        Err(sqlx::Error::Database(e)) if e.constraint() == Some("cargo_cargo_key") => {
            (StatusCode::CONFLICT, Json(ErroResposta::new("já existe um cargo com este nome"))).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErroResposta::new(format!("erro ao atualizar cargo: {}", e))),
        ).into_response(),
    }
}

pub async fn deletar_cargo(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> Response {
    let result = sqlx::query!("DELETE FROM cargo WHERE id = $1", id)
        .execute(&state.db)
        .await;

    match result {
        Ok(res) if res.rows_affected() > 0 => {
            (StatusCode::OK, Json(serde_json::json!({ "mensagem": "Cargo removido" }))).into_response()
        }
        Ok(_) => (StatusCode::NOT_FOUND, Json(ErroResposta::new("cargo não encontrado"))).into_response(),
        Err(sqlx::Error::Database(e)) if e.constraint() == Some("usuario_id_cargo_fkey") => {
            (StatusCode::CONFLICT, Json(ErroResposta::new("não é possível remover o cargo pois existem usuários vinculados a ele"))).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErroResposta::new(format!("erro ao deletar cargo: {}", e))),
        ).into_response(),
    }
}

pub async fn listar_permissoes(State(state): State<AppState>) -> Response {
    let permissoes = match sqlx::query_as!(
        NivelPermissao,
        r#"
        SELECT id, nivel, descricao
        FROM nivel_permissao
        WHERE ativo = true
        ORDER BY nivel
        "#
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(res) => res,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErroResposta::new(format!("erro ao buscar permissões: {}", e))),
            )
                .into_response();
        }
    };

    (StatusCode::OK, Json(permissoes)).into_response()
}
