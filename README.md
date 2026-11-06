# ServiceDesk — Plataforma de Suporte Técnico, Telemetria e Conexão Remota

Plataforma completa de **Service Desk** desenvolvida para centralizar e padronizar o gerenciamento de chamados de suporte técnico, integrando **triagem inteligente baseada em árvore de decisão**, **monitoramento e autoavaliação da máquina em tempo real (Agente local em Rust via gRPC)**, **servidor coordenador on-premise em Go** e **acesso remoto nativo**.

---

## Arquitetura e Módulos do Sistema

O projeto é organizado em formato **Monorepo**, estruturado em quatro camadas integradas:

```text
Service-desk/
├── proto/          # Contratos Protocol Buffers (.proto) compartilhados (gRPC)
├── agent/          # Agente local em Rust (coleta de métricas do SO, stream gRPC e acesso remoto)
├── server-go/      # Servidor On-Premise em Go (coordenador gRPC, Heartbeat, persistência e tempo real)
├── backend/        # API Central em Rust/Axum (Autenticação JWT, RBAC, Chamados, Chat WS e Árvore de Triagem)
├── app-desktop/    # Aplicação Desktop/Web em React + TypeScript + Tailwind CSS + Tauri
└── setup-env.ps1   # Script automatizado de preparação do ambiente de desenvolvimento (Windows)
```

### Principais Funcionalidades

* **Autenticação e Controle de Acesso (RBAC)**: Login, cadastro, gestão de usuários, cargos customizáveis e níveis de permissão granulares.
* **Gerenciamento Completo de Chamados**: Abertura, acompanhamento, atribuição de técnicos, categorização, definição de prioridade/setor, histórico auditável, comentários e upload de anexos.
* **Chat em Tempo Real**: Comunicação instantânea dentro de cada chamado entre solicitante e técnico via WebSockets.
* **Sistema de Triagem por Árvore de Decisão**: Fluxo interativo guiado na abertura do chamado que sugere soluções imediatas, registra o percurso de decisão do usuário e preenche automaticamente categoria, prioridade e setor responsável. Inclui painel administrativo visual para gestão e validação da árvore.
* **Módulo de Autoavaliação e Telemetria em Tempo Real**:
  * **Agente Local (Rust + Tokio + Tonic)**: Executado em segundo plano na estação do usuário com consumo mínimo de recursos, coletando métricas de CPU, memória RAM, paginação (Swap), armazenamento em disco e processos.
  * **Servidor Coordenador On-Premise (Go + gRPC)**: Recebe os streams de telemetria e sinais periódicos de *heartbeat* dos agentes, detecta disponibilidade (*online/offline*), armazena relatórios técnicos automatizados no PostgreSQL e transmite métricas ao vivo para o Painel do Técnico.
* **Módulo de Acesso Remoto Nativo**: Compartilhamento de tela e controle remoto mediante autorização explícita do usuário solicitante durante o atendimento.

---

## Tecnologias Utilizadas

| Camada | Tecnologias |
| :--- | :--- |
| **Frontend & Desktop** | React 19, TypeScript, Tailwind CSS 4, Vite, Tauri 2, Lucide Icons |
| **API de Gestão e Triagem** | Rust, Axum, Tokio, SQLx, JWT (`jsonwebtoken`), Bcrypt |
| **Servidor de Telemetria & Coordenação** | Go (Golang), gRPC (`google.golang.org/grpc`), Protocol Buffers, `pgx` |
| **Agente de Monitoramento Local** | Rust, Tokio, Tonic (gRPC), Prost, `sysinfo`, FFI C / APIs Nativas |
| **Banco de Dados** | PostgreSQL 18 (ACID, Integridade Referencial, Auditoria) |

---

## Pré-requisitos e Configuração Rápida do Ambiente (Windows)

Para instalar automaticamente todas as dependências necessárias no Windows (**Node.js LTS**, **PostgreSQL 18**, **Rust/Rustup**, **Go**, **Protocol Buffers (`protoc`) + plugins gRPC**, **VS 2022 C++ Build Tools** e **Edge WebView2**), execute o PowerShell como **Administrador** na raiz do repositório e rode:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\setup-env.ps1
```

> **Dica:** Para apenas verificar se todas as ferramentas já estão instaladas na sua máquina sem instalar nada, execute `.\setup-env.ps1 -CheckOnly`.

---

## Como Executar o Projeto

### 1. Banco de Dados (PostgreSQL)

Crie o banco de dados `servicedesk` e aplique as migrations localizadas em `backend/migrations/`:

```powershell
createdb -U postgres servicedesk

# Aplique as migrations em ordem numérica:
Get-ChildItem backend\migrations\*.sql | Sort-Object Name | ForEach-Object {
    psql -U postgres -d servicedesk -f $_.FullName
}
```

### 2. Backend Principal (API de Chamados, Auth e Triagem)

```powershell
cd backend
cp .env.example .env
# Ajuste a senha do PostgreSQL em .env (DATABASE_URL)
cargo run
```
A API principal estará disponível em `http://localhost:8080`.

### 3. Servidor On-Premise de Telemetria (Go)

```powershell
cd server-go
go run ./cmd/server
```
O servidor gRPC escutará por padrão na porta `50051` e a API/WebSocket de telemetria na porta `8081`.

### 4. Agente de Monitoramento Local (Rust)

```powershell
cd agent
cargo run
```

### 5. Aplicação Desktop / Web (React + Tauri)

```powershell
cd app-desktop
npm install

# Para rodar no navegador (modo desenvolvimento web):
npm run dev

# Para rodar como aplicação nativa Desktop (Tauri):
npx tauri dev
```

---

## Fluxo de Trabalho (Git & Versionamento)

* **`main`**: Branch principal estável, protegida por Pull Requests.
* **Branches de Funcionalidade**: Seguem o padrão `feature/<escopo>` ou `<modulo>` (ex.: `feature/contrato-proto-e-banco`, `feature/agente-telemetria-rust`, `feature/servidor-go-grpc`, `feature/painel-telemetria-front`).
* **Commits**: Referenciam a User Story correspondente (`US-XX — Descrição da entrega`) ou seguem *Conventional Commits* (`feat:`, `fix:`, `chore:`, `docs:`).

## Acesso remoto

Implementação, configuração, diferenças em relação ao TCC e testes em [docs/ACESSO_REMOTO.md](docs/ACESSO_REMOTO.md).
