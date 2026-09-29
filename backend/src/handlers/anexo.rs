use axum::{
    body::Body,
    extract::{Extension, Multipart, Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use tokio::fs;
use tokio_util::io::ReaderStream;
use uuid::Uuid;

use crate::{auth::jwt::Claims, models::Anexo, models::anexo::AnexoArquivo, AppState};

/// Tipos MIME aceitos. Ajuste aqui se o time decidir liberar mais formatos.
const TIPOS_PERMITIDOS: &[&str] = &[
    "image/png",
    "image/jpeg",
    "image/gif",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain",
    "application/zip",
];

/// POST /api/chamados/:id/anexos
/// multipart/form-data com um campo de arquivo chamado "arquivo".
///
/// IMPORTANTE: o Axum aplica por padrão um DefaultBodyLimit de 2MB em cima
/// do extractor Multipart, independente do MAX_ANEXO_MB. A rota precisa
/// receber uma layer DefaultBodyLimit::max(...) maior — ver main.rs.
pub async fn upload_anexo(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id_chamado): Path<i32>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<Anexo>), (StatusCode, String)> {
    let existe = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM chamado WHERE id = $1)",
    )
    .bind(id_chamado)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if !existe {
        return Err((StatusCode::NOT_FOUND, "chamado não encontrado".into()));
    }

    // TODO: verificar se este usuário pode acessar este chamado
    // (mesma pendência já registrada em comentario/chat).

    let max_bytes = state.config.max_anexo_mb * 1024 * 1024;

    let campo = multipart
        .next_field()
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?
        .ok_or((StatusCode::BAD_REQUEST, "nenhum arquivo enviado".into()))?;

    let nome_original = campo
        .file_name()
        .map(|s| s.to_string())
        .ok_or((StatusCode::BAD_REQUEST, "arquivo sem nome".into()))?;

    let tipo_mime = campo
        .content_type()
        .map(|s| s.to_string())
        .unwrap_or_else(|| "application/octet-stream".to_string());

    if !TIPOS_PERMITIDOS.contains(&tipo_mime.as_str()) {
        return Err((
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            format!("tipo de arquivo não permitido: {tipo_mime}"),
        ));
    }

    let bytes = campo
        .bytes()
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

    if bytes.len() as u64 > max_bytes {
        return Err((
            StatusCode::PAYLOAD_TOO_LARGE,
            format!("arquivo excede o limite de {}MB", state.config.max_anexo_mb),
        ));
    }

    // Nome físico único no disco: evita colisão e não expõe o nome original no path.
    let extensao = std::path::Path::new(&nome_original)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    let nome_armazenado = if extensao.is_empty() {
        Uuid::new_v4().to_string()
    } else {
        format!("{}.{extensao}", Uuid::new_v4())
    };

    fs::create_dir_all(&state.config.upload_dir)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let caminho = format!("{}/{}", state.config.upload_dir, nome_armazenado);
    fs::write(&caminho, &bytes)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let salvo = sqlx::query_as::<_, Anexo>(
        "WITH novo AS (
            INSERT INTO anexo (id_chamado, id_usuario, nome_original, nome_armazenado, caminho, tamanho_bytes, tipo_mime)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id, id_chamado, id_usuario, nome_original, tamanho_bytes, tipo_mime, data_upload, excluido
        )
        SELECT n.id, n.id_chamado, n.id_usuario, u.nome AS nome_usuario,
            n.nome_original, n.tamanho_bytes, n.tipo_mime, n.data_upload, n.excluido
        FROM novo n
        JOIN usuario u ON u.id = n.id_usuario",
    )
    .bind(id_chamado)
    .bind(claims.user_id)
    .bind(&nome_original)
    .bind(&nome_armazenado)
    .bind(&caminho)
    .bind(bytes.len() as i64)
    .bind(&tipo_mime)
    .fetch_one(&state.db)
    .await;

    match salvo {
        Ok(anexo) => Ok((StatusCode::CREATED, Json(anexo))),
        Err(e) => {
            // Se salvar no banco falhar, remove o arquivo órfão do disco.
            let _ = fs::remove_file(&caminho).await;
            tracing::error!("erro ao salvar anexo: {e}");
            Err((StatusCode::INTERNAL_SERVER_ERROR, "erro ao salvar anexo".into()))
        }
    }
}

/// GET /api/chamados/:id/anexos
// listar_anexos — troca o SELECT por este:
pub async fn listar_anexos(
    State(state): State<AppState>,
    Path(id_chamado): Path<i32>,
) -> Result<Json<Vec<Anexo>>, StatusCode> {
    sqlx::query_as::<_, Anexo>(
        "SELECT a.id, a.id_chamado, a.id_usuario, u.nome AS nome_usuario,
                a.nome_original, a.tamanho_bytes, a.tipo_mime, a.data_upload, a.excluido
         FROM anexo a
         JOIN usuario u ON u.id = a.id_usuario
         WHERE a.id_chamado = $1 AND a.excluido = false
         ORDER BY a.data_upload DESC",
    )
    .bind(id_chamado)
    .fetch_all(&state.db)
    .await
    .map(Json)
    .map_err(|e| {
        tracing::error!("erro ao listar anexos do chamado {id_chamado}: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })
}

/// DELETE /api/chamados/:id/anexos/:id_anexo
pub async fn excluir_anexo(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((id_chamado, id_anexo)): Path<(i32, i32)>,
) -> Result<StatusCode, (StatusCode, String)> {
    let resultado = sqlx::query(
        "UPDATE anexo
         SET excluido = true, excluido_em = now()
         WHERE id = $1 AND id_chamado = $2 AND id_usuario = $3 AND excluido = false",
    )
    .bind(id_anexo)
    .bind(id_chamado)
    .bind(claims.user_id)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if resultado.rows_affected() == 1 {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err((
            StatusCode::FORBIDDEN,
            "anexo nao encontrado ou sem permissao para excluir".into(),
        ))
    }
}

/// GET /api/chamados/:id/anexos/:id_anexo/download
pub async fn download_anexo(
    State(state): State<AppState>,
    Path((id_chamado, id_anexo)): Path<(i32, i32)>,
) -> Result<Response, StatusCode> {
    let info = sqlx::query_as::<_, AnexoArquivo>(
        "SELECT nome_original, caminho, tipo_mime
         FROM anexo WHERE id = $1 AND id_chamado = $2",
    )
    .bind(id_anexo)
    .bind(id_chamado)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("erro ao buscar anexo {id_anexo}: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?
    .ok_or(StatusCode::NOT_FOUND)?;

    // TODO: verificar se este usuário pode acessar este chamado (mesma pendência de sempre).

    let arquivo = fs::File::open(&info.caminho)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    let stream = ReaderStream::new(arquivo);
    let body = Body::from_stream(stream);

    let disposicao = format!(
        "attachment; filename=\"{}\"",
        info.nome_original.replace('"', "")
    );

    Ok(Response::builder()
        .header(header::CONTENT_TYPE, info.tipo_mime)
        .header(header::CONTENT_DISPOSITION, disposicao)
        .body(body)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .into_response())
}