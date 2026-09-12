use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

/// Cria e valida um pool de conexões com o PostgreSQL.
pub async fn new_pool(database_url: &str) -> Result<PgPool, sqlx::Error> {
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(database_url)
        .await?;

    // Ping simples para falhar cedo caso a conexão esteja incorreta.
    sqlx::query("SELECT 1").fetch_one(&pool).await?;

    Ok(pool)
}
