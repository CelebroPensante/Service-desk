mod auth;
mod config;
mod db;
mod handlers;
mod middleware;
mod models;

use axum::{
    http::{HeaderValue, Method},
    middleware::{from_fn, from_fn_with_state},
    routing::{get, patch, post, put},
    Router,
};
use sqlx::PgPool;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

use auth::TokenManager;
use config::Config;

use std::{collections::HashMap, sync::{Arc, Mutex}};
use tokio::sync::broadcast;

/// Estado compartilhado entre todos os handlers: pool de conexões e gerador de tokens.
#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub token_manager: TokenManager,
    pub chat_rooms: Arc<Mutex<HashMap<i32, broadcast::Sender<String>>>>,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let cfg = Config::load();

    let pool = match db::new_pool(&cfg.database_url).await {
        Ok(p) => {
            tracing::info!("conectado ao PostgreSQL com sucesso");
            p
        }
        Err(e) => {
            eprintln!("falha ao conectar ao banco de dados: {e}");
            std::process::exit(1);
        }
    };

    let state = AppState {
        db: pool,
        token_manager: TokenManager::new(cfg.jwt_secret.clone(), cfg.access_token_ttl),
        chat_rooms: Arc::new(Mutex::new(HashMap::new())),
    };

    let cors = CorsLayer::new()
        .allow_origin(
            cfg.allowed_origin
                .parse::<HeaderValue>()
                .expect("ALLOWED_ORIGIN inválida"),
        )
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::PATCH, Method::DELETE])
        .allow_headers([axum::http::header::CONTENT_TYPE, axum::http::header::AUTHORIZATION])
        .allow_credentials(true);

    // Rotas protegidas: exigem Bearer token válido via middleware require_auth.
    let rotas_protegidas = Router::new()
        .route("/me", get(handlers::auth::me))
        .layer(from_fn_with_state(state.clone(), middleware::require_auth));

    let rotas_auth = Router::new()
        .route("/register", post(handlers::auth::register))
        .route("/login", post(handlers::auth::login))
        .merge(rotas_protegidas);

    let rotas_chamados = Router::new()
        .route(
            "/:id/comentarios",
            get(handlers::comentario::listar_comentarios)
                .post(handlers::comentario::criar_comentario),
        )
        .route(
            "/:id/comentarios/:comentario_id",
            patch(handlers::comentario::editar_comentario)
                .delete(handlers::comentario::excluir_comentario),
        )
        .route("/:id/chat/mensagens", get(handlers::chat::listar_mensagens))
        .layer(from_fn_with_state(state.clone(), middleware::require_auth))
        .route("/:id/chat/ws", get(handlers::chat::chat_ws));

    let app = Router::new()
        .route("/health", get(|| async { r#"{"status":"ok"}"# }))
        .nest("/api/auth", rotas_auth)
        .nest("/api/chamados", rotas_chamados)
        .nest(
            "/api/admin",
            Router::new()
                .route("/cargos", get(handlers::cargos::listar_cargos).post(handlers::cargos::criar_cargo))
                .route("/cargos/:id", put(handlers::cargos::atualizar_cargo).delete(handlers::cargos::deletar_cargo))
                .route("/cargos/permissoes", get(handlers::cargos::listar_permissoes))
                .route("/usuarios", get(handlers::usuarios::listar_usuarios))
                .route("/usuarios/:id/cargo", patch(handlers::usuarios::atribuir_cargo))
                .layer(from_fn(|req, next| middleware::require_nivel_minimo(5, req, next)))
                .layer(from_fn_with_state(state.clone(), middleware::require_auth)),
        )
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let endereco = format!("0.0.0.0:{}", cfg.port);
    let listener = tokio::net::TcpListener::bind(&endereco)
        .await
        .unwrap_or_else(|e| panic!("não foi possível abrir a porta {endereco}: {e}"));

    tracing::info!("ServiceDesk API rodando na porta {}", cfg.port);
    axum::serve(listener, app)
        .await
        .expect("erro ao iniciar o servidor");
}