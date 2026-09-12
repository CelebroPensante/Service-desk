use axum::{
    extract::{Request, State},
    http::{header, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};

use crate::{auth::Claims, models::ErroResposta, AppState};

/// Exige um Bearer token JWT válido no cabeçalho Authorization.
/// Em caso de sucesso, injeta as Claims nas extensions da requisição,
/// disponíveis nos handlers via `Extension<Claims>`.
pub async fn require_auth(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Response {
    let header_valor = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());

    let token = match header_valor.and_then(|v| v.strip_prefix("Bearer ")) {
        Some(t) => t,
        None => {
            return erro_resposta(
                StatusCode::UNAUTHORIZED,
                "token de autenticação ausente",
            )
        }
    };

    match state.token_manager.validar(token) {
        Ok(claims) => {
            req.extensions_mut().insert(claims);
            next.run(req).await
        }
        Err(_) => erro_resposta(
            StatusCode::UNAUTHORIZED,
            "sessão expirada, faça login novamente",
        ),
    }
}

fn erro_resposta(status: StatusCode, mensagem: &str) -> Response {
    (status, Json(ErroResposta::new(mensagem))).into_response()
}

/// Fábrica de middleware para proteger rotas por nível mínimo de permissão
/// (RBAC), ex.: painel do técnico, gestão de cargos. Deve ser aplicado
/// DEPOIS de `require_auth`, pois depende das Claims já estarem na requisição.
///
/// Uso: `.layer(from_fn(move |req, next| require_nivel_minimo(3, req, next)))`
pub async fn require_nivel_minimo(nivel_minimo: i32, req: Request, next: Next) -> Response {
    let claims = req.extensions().get::<Claims>().cloned();

    match claims {
        Some(c) if c.nivel_acesso >= nivel_minimo => next.run(req).await,
        Some(_) => erro_resposta(
            StatusCode::FORBIDDEN,
            "seu cargo não tem permissão para esta ação",
        ),
        None => erro_resposta(StatusCode::UNAUTHORIZED, "não autenticado"),
    }
}
