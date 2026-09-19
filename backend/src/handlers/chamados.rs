use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};

use sqlx::Row;

use crate::{
    auth::Claims,
    models::{
        AtribuirAtendenteInput, AtualizarChamadoInput, AtualizarStatusChamadoInput,
        CategoriaResumo, Chamado, ErroResposta, NovoChamadoInput, PrioridadeResumo,
        StatusChamadoResumo, TecnicoResumo,
    },
    AppState,
};

fn erro(status: StatusCode, mensagem: impl Into<String>) -> Response {
    (status, Json(ErroResposta::new(mensagem))).into_response()
}

fn chamado_da_linha(linha: sqlx::postgres::PgRow) -> Chamado {
    Chamado {
        id: linha.get("id"),
        id_usuario: linha.get("id_usuario"),
        id_atendente: linha.get("id_atendente"),
        id_categoria: linha.get("id_categoria"),
        id_prioridade: linha.get("id_prioridade"),
        id_status: linha.get("id_status"),
        titulo: linha.get("titulo"),
        descricao_detalhada: linha.get("descricao_detalhada"),
        categoria: linha.get("categoria"),
        prioridade: linha.get("prioridade"),
        status: linha.get("status"),
        data_abertura: linha.get("data_abertura"),
        data_resolucao: linha.get("data_resolucao"),
        data_atualizacao: linha.get("data_atualizacao"),
    }
}

async fn buscar_chamado(state: &AppState, id: i32) -> Result<Option<Chamado>, sqlx::Error> {
    let linha = sqlx::query(
        r#"
        SELECT
            ch.id,
            ch.id_usuario,
            ch.id_atendente,
            ch.id_categoria,
            ch.id_prioridade,
            ch.id_status,
            ch.titulo,
            ch.descricao_detalhada,
            c.categoria,
            p.prioridade,
            s.status,
            ch.data_abertura,
            ch.data_resolucao,
            ch.data_atualizacao
        FROM chamado ch
        JOIN categoria c
            ON c.id = ch.id_categoria
        JOIN prioridade p
            ON p.id = ch.id_prioridade
        JOIN status_chamado s
            ON s.id = ch.id_status
        WHERE ch.id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?;

    Ok(linha.map(chamado_da_linha))
}

/// POST /api/chamados
///
/// Cria um chamado pertencente ao usuário autenticado.
/// O status inicial é sempre "Aberto".
pub async fn criar_chamado(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(mut input): Json<NovoChamadoInput>,
) -> Response {
    input.titulo = input.titulo.trim().to_string();
    input.descricao_detalhada = input.descricao_detalhada.trim().to_string();

    if input.titulo.is_empty() {
        return erro(StatusCode::BAD_REQUEST, "título é obrigatório");
    }

    if input.descricao_detalhada.is_empty() {
        return erro(StatusCode::BAD_REQUEST, "descrição é obrigatória");
    }

    let resultado = sqlx::query(
        r#"
        INSERT INTO chamado (
            id_usuario,
            id_categoria,
            id_prioridade,
            id_status,
            titulo,
            descricao_detalhada
        )
        VALUES (
            $1,
            $2,
            $3,
            (
                SELECT id
                FROM status_chamado
                WHERE status = 'Aberto'
                LIMIT 1
            ),
            $4,
            $5
        )
        RETURNING id
        "#,
    )
    .bind(claims.user_id)
    .bind(input.id_categoria)
    .bind(input.id_prioridade)
    .bind(&input.titulo)
    .bind(&input.descricao_detalhada)
    .fetch_one(&state.db)
    .await;

    let id: i32 = match resultado {
        Ok(linha) => linha.get("id"),

        Err(sqlx::Error::Database(e)) if e.code().as_deref() == Some("23503") => {
            return erro(StatusCode::BAD_REQUEST, "categoria ou prioridade inválida");
        }

        Err(e) => {
            tracing::error!("erro ao criar chamado: {e}");

            return erro(StatusCode::INTERNAL_SERVER_ERROR, "erro ao criar chamado");
        }
    };

    match buscar_chamado(&state, id).await {
        Ok(Some(chamado)) => (StatusCode::CREATED, Json(chamado)).into_response(),

        Ok(None) => erro(
            StatusCode::INTERNAL_SERVER_ERROR,
            "chamado criado, mas não foi possível carregá-lo",
        ),

        Err(e) => {
            tracing::error!("erro ao carregar chamado criado: {e}");

            erro(
                StatusCode::INTERNAL_SERVER_ERROR,
                "erro ao carregar chamado",
            )
        }
    }
}

/// GET /api/chamados
///
/// Usuário comum vê apenas os próprios chamados.
///
/// Níveis técnicos e administrativos podem consultar todos os
/// chamados, o que permitirá ao futuro painel técnico reutilizar
/// este endpoint.
pub async fn listar_chamados(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Response {
    let resultado = if claims.nivel_acesso >= 2 {
        sqlx::query(
            r#"
            SELECT
                ch.id,
                ch.id_usuario,
                ch.id_atendente,
                ch.id_categoria,
                ch.id_prioridade,
                ch.id_status,
                ch.titulo,
                ch.descricao_detalhada,
                c.categoria,
                p.prioridade,
                s.status,
                ch.data_abertura,
                ch.data_resolucao,
                ch.data_atualizacao
            FROM chamado ch
            JOIN categoria c
                ON c.id = ch.id_categoria
            JOIN prioridade p
                ON p.id = ch.id_prioridade
            JOIN status_chamado s
                ON s.id = ch.id_status
            ORDER BY ch.data_abertura DESC
            "#,
        )
        .fetch_all(&state.db)
        .await
    } else {
        sqlx::query(
            r#"
            SELECT
                ch.id,
                ch.id_usuario,
                ch.id_atendente,
                ch.id_categoria,
                ch.id_prioridade,
                ch.id_status,
                ch.titulo,
                ch.descricao_detalhada,
                c.categoria,
                p.prioridade,
                s.status,
                ch.data_abertura,
                ch.data_resolucao,
                ch.data_atualizacao
            FROM chamado ch
            JOIN categoria c
                ON c.id = ch.id_categoria
            JOIN prioridade p
                ON p.id = ch.id_prioridade
            JOIN status_chamado s
                ON s.id = ch.id_status
            WHERE ch.id_usuario = $1
            ORDER BY ch.data_abertura DESC
            "#,
        )
        .bind(claims.user_id)
        .fetch_all(&state.db)
        .await
    };

    let linhas = match resultado {
        Ok(linhas) => linhas,

        Err(e) => {
            tracing::error!("erro ao listar chamados: {e}");

            return erro(StatusCode::INTERNAL_SERVER_ERROR, "erro ao listar chamados");
        }
    };

    let chamados: Vec<Chamado> = linhas.into_iter().map(chamado_da_linha).collect();

    (StatusCode::OK, Json(chamados)).into_response()
}

/// GET /api/chamados/:id
pub async fn consultar_chamado(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
) -> Response {
    let chamado = match buscar_chamado(&state, id).await {
        Ok(Some(chamado)) => chamado,

        Ok(None) => return erro(StatusCode::NOT_FOUND, "chamado não encontrado"),

        Err(e) => {
            tracing::error!("erro ao consultar chamado: {e}");

            return erro(
                StatusCode::INTERNAL_SERVER_ERROR,
                "erro ao consultar chamado",
            );
        }
    };

    if claims.nivel_acesso < 2 && chamado.id_usuario != claims.user_id {
        return erro(
            StatusCode::FORBIDDEN,
            "você não tem permissão para visualizar este chamado",
        );
    }

    (StatusCode::OK, Json(chamado)).into_response()
}

/// PUT /api/chamados/:id
///
/// Para o CRUD inicial:
/// - usuário comum pode editar seus próprios chamados;
/// - níveis técnicos podem editar qualquer chamado.
pub async fn atualizar_chamado(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
    Json(mut input): Json<AtualizarChamadoInput>,
) -> Response {
    input.titulo = input.titulo.trim().to_string();
    input.descricao_detalhada = input.descricao_detalhada.trim().to_string();

    if input.titulo.is_empty() {
        return erro(StatusCode::BAD_REQUEST, "título é obrigatório");
    }

    if input.descricao_detalhada.is_empty() {
        return erro(StatusCode::BAD_REQUEST, "descrição é obrigatória");
    }

    let existente = match buscar_chamado(&state, id).await {
        Ok(Some(chamado)) => chamado,

        Ok(None) => return erro(StatusCode::NOT_FOUND, "chamado não encontrado"),

        Err(e) => {
            tracing::error!("erro ao consultar chamado antes da atualização: {e}");

            return erro(
                StatusCode::INTERNAL_SERVER_ERROR,
                "erro ao consultar chamado",
            );
        }
    };

    if claims.nivel_acesso < 2 && existente.id_usuario != claims.user_id {
        return erro(
            StatusCode::FORBIDDEN,
            "você não tem permissão para editar este chamado",
        );
    }

    let resultado = sqlx::query(
        r#"
        UPDATE chamado
        SET
            titulo = $1,
            descricao_detalhada = $2,
            id_categoria = $3,
            id_prioridade = $4,
            data_atualizacao = NOW()
        WHERE id = $5
        "#,
    )
    .bind(&input.titulo)
    .bind(&input.descricao_detalhada)
    .bind(input.id_categoria)
    .bind(input.id_prioridade)
    .bind(id)
    .execute(&state.db)
    .await;

    match resultado {
        Ok(_) => {}

        Err(sqlx::Error::Database(e)) if e.code().as_deref() == Some("23503") => {
            return erro(StatusCode::BAD_REQUEST, "categoria ou prioridade inválida");
        }

        Err(e) => {
            tracing::error!("erro ao atualizar chamado: {e}");

            return erro(
                StatusCode::INTERNAL_SERVER_ERROR,
                "erro ao atualizar chamado",
            );
        }
    }

    match buscar_chamado(&state, id).await {
        Ok(Some(chamado)) => (StatusCode::OK, Json(chamado)).into_response(),

        Ok(None) => erro(StatusCode::NOT_FOUND, "chamado não encontrado"),

        Err(e) => {
            tracing::error!("erro ao carregar chamado atualizado: {e}");

            erro(
                StatusCode::INTERNAL_SERVER_ERROR,
                "erro ao carregar chamado",
            )
        }
    }
}

/// DELETE /api/chamados/:id
pub async fn deletar_chamado(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
) -> Response {
    let chamado = match buscar_chamado(&state, id).await {
        Ok(Some(chamado)) => chamado,

        Ok(None) => return erro(StatusCode::NOT_FOUND, "chamado não encontrado"),

        Err(e) => {
            tracing::error!("erro ao consultar chamado antes da exclusão: {e}");

            return erro(
                StatusCode::INTERNAL_SERVER_ERROR,
                "erro ao consultar chamado",
            );
        }
    };

    if claims.nivel_acesso < 2 && chamado.id_usuario != claims.user_id {
        return erro(
            StatusCode::FORBIDDEN,
            "você não tem permissão para excluir este chamado",
        );
    }

    let resultado = sqlx::query("DELETE FROM chamado WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await;

    match resultado {
        Ok(resultado) if resultado.rows_affected() > 0 => (
            StatusCode::OK,
            Json(serde_json::json!({
                "mensagem": "Chamado removido com sucesso"
            })),
        )
            .into_response(),

        Ok(_) => erro(StatusCode::NOT_FOUND, "chamado não encontrado"),

        Err(e) => {
            tracing::error!("erro ao deletar chamado: {e}");

            erro(StatusCode::INTERNAL_SERVER_ERROR, "erro ao deletar chamado")
        }
    }
}

/// GET /api/chamados/categorias
pub async fn listar_categorias(State(state): State<AppState>) -> Response {
    let resultado = sqlx::query(
        r#"
        SELECT id, categoria
        FROM categoria
        WHERE ativo = TRUE
        ORDER BY categoria
        "#,
    )
    .fetch_all(&state.db)
    .await;

    let linhas = match resultado {
        Ok(linhas) => linhas,

        Err(e) => {
            tracing::error!("erro ao listar categorias: {e}");

            return erro(
                StatusCode::INTERNAL_SERVER_ERROR,
                "erro ao listar categorias",
            );
        }
    };

    let categorias: Vec<CategoriaResumo> = linhas
        .into_iter()
        .map(|linha| CategoriaResumo {
            id: linha.get("id"),
            categoria: linha.get("categoria"),
        })
        .collect();

    (StatusCode::OK, Json(categorias)).into_response()
}

/// GET /api/chamados/prioridades
pub async fn listar_prioridades(State(state): State<AppState>) -> Response {
    let resultado = sqlx::query(
        r#"
        SELECT id, nivel, prioridade
        FROM prioridade
        WHERE ativo = TRUE
        ORDER BY nivel
        "#,
    )
    .fetch_all(&state.db)
    .await;

    let linhas = match resultado {
        Ok(linhas) => linhas,

        Err(e) => {
            tracing::error!("erro ao listar prioridades: {e}");

            return erro(
                StatusCode::INTERNAL_SERVER_ERROR,
                "erro ao listar prioridades",
            );
        }
    };

    let prioridades: Vec<PrioridadeResumo> = linhas
        .into_iter()
        .map(|linha| PrioridadeResumo {
            id: linha.get("id"),
            nivel: linha.get("nivel"),
            prioridade: linha.get("prioridade"),
        })
        .collect();

    (StatusCode::OK, Json(prioridades)).into_response()
}

/// GET /api/chamados/status
pub async fn listar_status(State(state): State<AppState>) -> Response {
    let resultado = sqlx::query(
        r#"
        SELECT id, status
        FROM status_chamado
        WHERE ativo = TRUE
        ORDER BY id
        "#,
    )
    .fetch_all(&state.db)
    .await;

    let linhas = match resultado {
        Ok(linhas) => linhas,

        Err(e) => {
            tracing::error!("erro ao listar status: {e}");

            return erro(StatusCode::INTERNAL_SERVER_ERROR, "erro ao listar status");
        }
    };

    let status: Vec<StatusChamadoResumo> = linhas
        .into_iter()
        .map(|linha| StatusChamadoResumo {
            id: linha.get("id"),
            status: linha.get("status"),
        })
        .collect();

    (StatusCode::OK, Json(status)).into_response()
}

/// GET /api/tecnicos
pub async fn listar_tecnicos(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Response {
    if claims.nivel_acesso < 2 {
        return erro(StatusCode::FORBIDDEN, "você não tem permissão para listar técnicos");
    }

    let resultado = sqlx::query(
        r#"
        SELECT a.id, u.nome
        FROM atendente a
        JOIN usuario u ON u.id = a.id_usuario
        WHERE a.ativo = TRUE AND u.ativo = TRUE
        ORDER BY u.nome
        "#,
    )
    .fetch_all(&state.db)
    .await;

    match resultado {
        Ok(linhas) => {
            let tecnicos: Vec<TecnicoResumo> = linhas
                .into_iter()
                .map(|linha| TecnicoResumo {
                    id: linha.get("id"),
                    nome: linha.get("nome"),
                })
                .collect();
            (StatusCode::OK, Json(tecnicos)).into_response()
        }
        Err(e) => {
            tracing::error!("erro ao listar técnicos: {e}");
            erro(StatusCode::INTERNAL_SERVER_ERROR, "erro ao listar técnicos")
        }
    }
}

/// PUT /api/chamados/:id/status
pub async fn atualizar_status(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
    Json(input): Json<AtualizarStatusChamadoInput>,
) -> Response {
    if claims.nivel_acesso < 2 {
        return erro(StatusCode::FORBIDDEN, "você não tem permissão para atualizar o status");
    }

    let resultado = sqlx::query(
        r#"
        UPDATE chamado
        SET id_status = $1, data_atualizacao = NOW()
        WHERE id = $2
        "#,
    )
    .bind(input.id_status)
    .bind(id)
    .execute(&state.db)
    .await;

    match resultado {
        Ok(resultado) if resultado.rows_affected() > 0 => {}
        Ok(_) => return erro(StatusCode::NOT_FOUND, "chamado não encontrado"),
        Err(sqlx::Error::Database(e)) if e.code().as_deref() == Some("23503") => {
            return erro(StatusCode::BAD_REQUEST, "status inválido");
        }
        Err(e) => {
            tracing::error!("erro ao atualizar status do chamado: {e}");
            return erro(StatusCode::INTERNAL_SERVER_ERROR, "erro ao atualizar status");
        }
    }

    match buscar_chamado(&state, id).await {
        Ok(Some(chamado)) => (StatusCode::OK, Json(chamado)).into_response(),
        Ok(None) => erro(StatusCode::NOT_FOUND, "chamado não encontrado"),
        Err(e) => {
            tracing::error!("erro ao carregar chamado atualizado: {e}");
            erro(StatusCode::INTERNAL_SERVER_ERROR, "erro ao carregar chamado")
        }
    }
}

/// PUT /api/chamados/:id/atendente
pub async fn atualizar_atendente(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
    Json(input): Json<AtribuirAtendenteInput>,
) -> Response {
    if claims.nivel_acesso < 2 {
        return erro(StatusCode::FORBIDDEN, "você não tem permissão para atribuir técnicos");
    }

    let resultado = sqlx::query(
        r#"
        UPDATE chamado
        SET id_atendente = $1, data_atualizacao = NOW()
        WHERE id = $2
        "#,
    )
    .bind(input.id_atendente)
    .bind(id)
    .execute(&state.db)
    .await;

    match resultado {
        Ok(resultado) if resultado.rows_affected() > 0 => {}
        Ok(_) => return erro(StatusCode::NOT_FOUND, "chamado não encontrado"),
        Err(sqlx::Error::Database(e)) if e.code().as_deref() == Some("23503") => {
            return erro(StatusCode::BAD_REQUEST, "técnico inválido");
        }
        Err(e) => {
            tracing::error!("erro ao atribuir técnico: {e}");
            return erro(StatusCode::INTERNAL_SERVER_ERROR, "erro ao atribuir técnico");
        }
    }

    match buscar_chamado(&state, id).await {
        Ok(Some(chamado)) => (StatusCode::OK, Json(chamado)).into_response(),
        Ok(None) => erro(StatusCode::NOT_FOUND, "chamado não encontrado"),
        Err(e) => {
            tracing::error!("erro ao carregar chamado atualizado: {e}");
            erro(StatusCode::INTERNAL_SERVER_ERROR, "erro ao carregar chamado")
        }
    }
}
