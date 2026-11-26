# ==============================================================================
# ServiceDesk Backend API (Rust / Axum) - Multi-Stage Dockerfile
# ==============================================================================

# --- Estágio 1: Build ---
FROM rust:1.80-slim AS builder

WORKDIR /usr/src/app

# Instala dependências necessárias para compilação
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copia manifestos de dependências
COPY Cargo.toml Cargo.lock ./

# Copia código fonte e migrations
COPY src ./src
COPY migrations ./migrations

# Compila o binário em modo release otimizado
RUN cargo build --release --bin servicedesk-api

# --- Estágio 2: Runtime Minimalista ---
FROM debian:bookworm-slim AS runtime

WORKDIR /app

# Instala ca-certificates e curl para healthchecks
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Copia binário e migrations a partir do builder
COPY --from=builder /usr/src/app/target/release/servicedesk-api /app/servicedesk-api
COPY --from=builder /usr/src/app/migrations /app/migrations

# Diretório padrão para upload de anexos de chamados
RUN mkdir -p /app/uploads && chmod 777 /app/uploads

ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/api/auth/me || exit 0

ENTRYPOINT ["/app/servicedesk-api"]
