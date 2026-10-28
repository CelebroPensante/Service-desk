# ServiceDesk Telemetry Server (Go + gRPC + PostgreSQL + WebSocket)

Servidor Coordenador On-Premise desenvolvido em **Go** responsável por receber os streams gRPC de telemetria e sinais de *heartbeat* dos agentes locais em Rust, gerenciar o estado *online/offline* das estações, armazenar os relatórios técnicos automatizados no **PostgreSQL** e transmitir métricas ao vivo via **WebSocket/REST** para o Painel do Técnico.

## Arquitetura Interna

- `internal/pb/`: Código Go e gRPC gerado a partir de [`../proto/telemetria.proto`](../proto/telemetria.proto).
- `internal/grpcserver/`: Implementação do servidor gRPC (`StreamTelemetria`, `EnviarHeartbeat`, `ObterTelemetria`) na porta `50051`.
- `internal/hub/`: Hub concorrente em memória com Pub/Sub para WebSockets e *Watchdog* de *Heartbeat* (classifica máquinas como `offline` após a janela de tolerância).
- `internal/storage/`: Persistência no PostgreSQL (`pgx/v5`) para as tabelas `maquina_monitorada` e `relatorio_autoavaliacao`.
- `internal/httpapi/`: API HTTP e WebSocket na porta `8081` para integração com o Frontend/Tauri.

## Endpoints HTTP / WebSocket (Porta `8081`)

| Método | Rota | Descrição |
| :--- | :--- | :--- |
| `GET` | `/health` | Health check do servidor Go |
| `GET` | `/api/telemetria/maquinas` | Lista todas as máquinas monitoradas e seu último snapshot |
| `GET` | `/api/telemetria/maquinas/{machine_uid}` | Retorna a telemetria atual de uma máquina (ou `atual` para a máquina ativa) |
| `GET` | `/api/telemetria/ws` | Stream WebSocket em tempo real de todas as máquinas |
| `GET` | `/api/telemetria/maquinas/{machine_uid}/ws` | Stream WebSocket em tempo real de uma máquina específica |
| `POST` | `/api/telemetria/chamados/{id}/relatorio` | Gera e salva no PostgreSQL o Relatório Técnico de Autoavaliação vinculado ao chamado |
| `GET` | `/api/telemetria/chamados/{id}/relatorio` | Lista os relatórios de autoavaliação anexados a um chamado |

## Como Executar

```powershell
cd server-go
cp .env.example .env
go run ./cmd/server
```
