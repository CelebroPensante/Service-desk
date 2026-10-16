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
        StatusChamadoResumo, SetorResumo, TecnicoResumo,
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
        id_setor: linha.get("id_setor"),
        setor: linha.get("setor"),
        id_fluxo_triagem: linha.get("id_fluxo_triagem"),
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
            ch.data_atualizacao,
            ch.id_setor,
            st.nome AS setor,
            ft.id AS id_fluxo_triagem
        FROM chamado ch
        JOIN categoria c
            ON c.id = ch.id_categoria
        JOIN prioridade p
            ON p.id = ch.id_prioridade
        JOIN status_chamado s
            ON s.id = ch.id_status
        LEFT JOIN setor st
            ON st.id = ch.id_setor
        LEFT JOIN fluxo_triagem ft
            ON ft.id_chamado = ch.id
        WHERE ch.id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?;

    Ok(linha.map(chamado_da_linha))
}

/// Resultado da criação: id do chamado ou a resposta de erro já pronta.
async fn inserir_chamado(
    state: &AppState,
    claims: &Claims,
    input: &NovoChamadoInput,
) -> Result<i32, Response> {
    let interno = |contexto: &'static str| {
        move |e: sqlx::Error| {
            tracing::error!("{contexto}: {e}");
            erro(StatusCode::INTERNAL_SERVER_ERROR, "erro ao criar chamado")
        }
    };

    let tecnico = claims.nivel_acesso >= 2;
    let mut tx = state.db.begin().await.map_err(interno("abrir transação"))?;

    let mut id_categoria = input.id_categoria;
    let mut id_prioridade = input.id_prioridade;
    // Setor escolhido à mão só vale para técnico; solicitante comum não define.
    let mut id_setor: Option<i32> = if tecnico { input.id_setor } else { None };

    // US-23: chamado originado por uma triagem — a etapa final define a
    // classificação. Quem manda é o servidor; o formulário só exibe.
    if let Some(id_fluxo) = input.id_fluxo_triagem {
        let fluxo = sqlx::query(
            r#"
            SELECT f.id_chamado, f.concluido, n.tipo_no,
                   n.id_categoria, n.id_prioridade, n.id_setor
            FROM fluxo_triagem f
            JOIN no_decisao n ON n.id = f.no_atual
            WHERE f.id = $1 AND f.id_usuario = $2
            FOR UPDATE OF f
            "#,
        )
        .bind(id_fluxo)
        .bind(claims.user_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(interno("consultar triagem"))?
        .ok_or_else(|| erro(StatusCode::NOT_FOUND, "triagem não encontrada"))?;

        let ja_gerou: Option<i32> = fluxo.get("id_chamado");
        let concluido: bool = fluxo.get("concluido");
        let tipo_no: String = fluxo.get("tipo_no");

        if ja_gerou.is_some() {
            return Err(erro(StatusCode::CONFLICT, "esta triagem já gerou um chamado"));
        }
        if !concluido || tipo_no != "etapa_final" {
            return Err(erro(
                StatusCode::CONFLICT,
                "a triagem ainda não chegou à etapa final",
            ));
        }

        let no_categoria: Option<i32> = fluxo.get("id_categoria");
        let no_prioridade: Option<i32> = fluxo.get("id_prioridade");
        let no_setor: Option<i32> = fluxo.get("id_setor");

        if tecnico {
            // Técnico pode ajustar o que veio preenchido; sem ajuste, vale a triagem.
            id_setor = input.id_setor.or(no_setor);
        } else {
            // Solicitante: vale o que a triagem definiu. O que ela não define,
            // ele escolhe no formulário.
            id_categoria = no_categoria.unwrap_or(input.id_categoria);
            id_prioridade = no_prioridade.unwrap_or(input.id_prioridade);
            id_setor = no_setor;
        }
    }

    let linha = sqlx::query(
        r#"
        INSERT INTO chamado (
            id_usuario,
            id_categoria,
            id_prioridade,
            id_setor,
            id_status,
            titulo,
            descricao_detalhada
        )
        VALUES (
            $1,
            $2,
            $3,
            $4,
            (
                SELECT id
                FROM status_chamado
                WHERE status = 'Aberto'
                LIMIT 1
            ),
            $5,
            $6
        )
        RETURNING id
        "#,
    )
    .bind(claims.user_id)
    .bind(id_categoria)
    .bind(id_prioridade)
    .bind(id_setor)
    .bind(&input.titulo)
    .bind(&input.descricao_detalhada)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| match &e {
        sqlx::Error::Database(db) if db.code().as_deref() == Some("23503") => erro(
            StatusCode::BAD_REQUEST,
            "categoria, prioridade ou setor inválido",
        ),
        _ => {
            tracing::error!("erro ao criar chamado: {e}");
            erro(StatusCode::INTERNAL_SERVER_ERROR, "erro ao criar chamado")
        }
    })?;

    let id: i32 = linha.get("id");

    // US-23: liga a triagem ao chamado gerado (FluxoTriagem.idChamado).
    if let Some(id_fluxo) = input.id_fluxo_triagem {
        sqlx::query(
            "UPDATE fluxo_triagem
             SET id_chamado = $1,
                 historico = historico || $2 || E'\n'
             WHERE id = $3",
        )
        .bind(id)
        .bind(format!("Chamado aberto: CHM-{id:04}"))
        .bind(id_fluxo)
        .execute(&mut *tx)
        .await
        .map_err(interno("vincular triagem ao chamado"))?;
    }

    tx.commit().await.map_err(interno("confirmar transação"))?;
    Ok(id)
}

/// POST /api/chamados
///
/// Cria um chamado pertencente ao usuário autenticado.
/// O status inicial é sempre "Aberto".
///
/// US-23: se vier `idFluxoTriagem`, categoria, prioridade e setor são
/// definidos pela etapa final da triagem (o técnico pode ajustá-los) e a
/// triagem fica vinculada ao chamado.
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

    let id = match inserir_chamado(&state, &claims, &input).await {
        Ok(id) => id,
        Err(resposta) => return resposta,
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
                ch.data_atualizacao,
                ch.id_setor,
                st.nome AS setor,
                ft.id AS id_fluxo_triagem
            FROM chamado ch
            JOIN categoria c
                ON c.id = ch.id_categoria
            JOIN prioridade p
                ON p.id = ch.id_prioridade
            JOIN status_chamado s
                ON s.id = ch.id_status
            LEFT JOIN setor st
                ON st.id = ch.id_setor
            LEFT JOIN fluxo_triagem ft
                ON ft.id_chamado = ch.id
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
                ch.data_atualizacao,
                ch.id_setor,
                st.nome AS setor,
                ft.id AS id_fluxo_triagem
            FROM chamado ch
            JOIN categoria c
                ON c.id = ch.id_categoria
            JOIN prioridade p
                ON p.id = ch.id_prioridade
            JOIN status_chamado s
                ON s.id = ch.id_status
            LEFT JOIN setor st
                ON st.id = ch.id_setor
            LEFT JOIN fluxo_triagem ft
                ON ft.id_chamado = ch.id
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

    // US-23: chamado classificado pela triagem só é reclassificado por técnico
    // (nível >= 2). Para o solicitante, categoria e prioridade ficam como estão.
    // O setor também só muda por técnico.
    let tecnico = claims.nivel_acesso >= 2;
    let travar_classificacao = !tecnico && existente.id_fluxo_triagem.is_some();
    let id_categoria = if travar_classificacao {
        existente.id_categoria
    } else {
        input.id_categoria
    };
    let id_prioridade = if travar_classificacao {
        existente.id_prioridade
    } else {
        input.id_prioridade
    };
    let id_setor = if tecnico {
        input.id_setor.or(existente.id_setor)
    } else {
        existente.id_setor
    };

    let resultado = sqlx::query(
        r#"
        UPDATE chamado
        SET
            titulo = $1,
            descricao_detalhada = $2,
            id_categoria = $3,
            id_prioridade = $4,
            id_setor = $5,
            data_atualizacao = NOW()
        WHERE id = $6
        "#,
    )
    .bind(&input.titulo)
    .bind(&input.descricao_detalhada)
    .bind(id_categoria)
    .bind(id_prioridade)
    .bind(id_setor)
    .bind(id)
    .execute(&state.db)
    .await;

    match resultado {
        Ok(_) => {}

        Err(sqlx::Error::Database(e)) if e.code().as_deref() == Some("23503") => {
            return erro(StatusCode::BAD_REQUEST, "categoria, prioridade ou setor inválido");
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

/// GET /api/chamados/setores
/// US-23: setores (equipes de atendimento) ativos.
pub async fn listar_setores(State(state): State<AppState>) -> Response {
    let resultado = sqlx::query("SELECT id, nome FROM setor WHERE ativo = TRUE ORDER BY nome")
        .fetch_all(&state.db)
        .await;

    match resultado {
        Ok(linhas) => {
            let setores: Vec<SetorResumo> = linhas
                .into_iter()
                .map(|linha| SetorResumo {
                    id: linha.get("id"),
                    nome: linha.get("nome"),
                })
                .collect();
            (StatusCode::OK, Json(setores)).into_response()
        }
        Err(e) => {
            tracing::error!("erro ao listar setores: {e}");
            erro(StatusCode::INTERNAL_SERVER_ERROR, "erro ao listar setores")
        }
    }
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
        SELECT a.id, u.nome, a.id_setor
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
                    id_setor: linha.get("id_setor"),
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
