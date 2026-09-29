use std::env;
use std::time::Duration;

/// Config concentra todas as variáveis de ambiente usadas pela API.
#[derive(Clone)]
pub struct Config {
    pub port: String,
    pub database_url: String,
    pub jwt_secret: String,
    pub access_token_ttl: Duration,
    pub allowed_origin: String,
    pub max_anexo_mb: u64,
    pub upload_dir: String,
}

impl Config {
    pub fn load() -> Self {
        let _ = dotenvy::dotenv();

        let jwt_secret = env::var("JWT_SECRET").unwrap_or_default();
        if jwt_secret.trim().is_empty() {
            eprintln!(
                "JWT_SECRET não definido. Configure a variável de ambiente antes de iniciar a API."
            );
            std::process::exit(1);
        }

        Config {
            port: env::var("PORT").unwrap_or_else(|_| "8080".to_string()),
            database_url: env::var("DATABASE_URL").unwrap_or_else(|_| {
                "postgres://postgres:postgres@localhost:5432/servicedesk?sslmode=disable"
                    .to_string()
            }),
            jwt_secret,
            access_token_ttl: Duration::from_secs(15 * 60),
            allowed_origin: env::var("ALLOWED_ORIGIN")
                .unwrap_or_else(|_| "http://localhost:5173".to_string()),
            max_anexo_mb: env::var("MAX_ANEXO_MB")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(10),
            upload_dir: env::var("UPLOAD_DIR").unwrap_or_else(|_| "uploads".to_string()),
        }
    }
}