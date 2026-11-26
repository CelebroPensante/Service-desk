# ==============================================================================
# ServiceDesk Telemetria & Coordenador On-Premise (Go) - Multi-Stage Dockerfile
# ==============================================================================

# --- Estágio 1: Build ---
FROM golang:1.23-alpine AS builder

WORKDIR /usr/src/app

# Instala certificados e git se necessário
RUN apk add --no-cache git ca-certificates

# Copia arquivos de dependências
COPY go.mod go.sum ./
RUN go mod download

# Copia código-fonte
COPY cmd/ ./cmd/
COPY internal/ ./internal/

# Compila o executável com otimizações de tamanho (stripping symbols)
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags="-s -w" \
    -o /app/server-go ./cmd/server

# --- Estágio 2: Runtime Minimalista ---
FROM alpine:3.20 AS runtime

WORKDIR /app

# Adiciona certificados SSL para chamadas HTTPS/TLS e utilitários de checagem
RUN apk add --no-cache ca-certificates tzdata curl

# Copia o binário a partir do builder
COPY --from=builder /app/server-go /app/server-go

ENV HTTP_PORT=8081
ENV GRPC_PORT=50051

EXPOSE 8081
EXPOSE 50051

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8081/maquinas/atual || exit 0

ENTRYPOINT ["/app/server-go"]
