# ServiceDesk API (Rust) — Autenticação

Backend em Rust responsável pelo módulo de login, cadastro e autenticação do
sistema ServiceDesk, conforme especificado no TCC (seção 2.1.1). Reimplementa
com a mesma API HTTP e o mesmo schema de banco da versão anterior em Go —
o frontend não precisa de nenhuma alteração.

## Stack

- **Axum** (framework web) sobre **Tokio** (runtime assíncrono) — a mesma
  combinação já justificada no TCC (seção 2.2.3.3) para o agente local, agora
  também usada no servidor central.
- **SQLx** para acesso ao PostgreSQL (queries verificadas em tempo de execução).
- **jsonwebtoken** para autenticação stateless via JWT.
- **bcrypt** para hashing de senhas.

## Como rodar

1. Suba um PostgreSQL local e crie o banco:
   ```bash
   createdb servicedesk
   ```

2. Aplique a migration inicial (idêntica à versão em Go):
   ```bash
   psql -d servicedesk -f migrations/001_init_auth.sql
   ```

3. Copie o arquivo de ambiente e ajuste os valores (principalmente `JWT_SECRET`):
   ```bash
   cp .env.example .env
   ```
   No Windows, evite editar o `.env` pelo Bloco de Notas (ele pode salvar com
   um BOM que quebra a leitura do arquivo). Prefira recriar pelo PowerShell:
   ```powershell
   Set-Content -Encoding ascii .env "PORT=8080"
   Add-Content -Encoding ascii .env "DATABASE_URL=postgres://postgres:SUASENHA@localhost:5432/servicedesk?sslmode=disable"
   Add-Content -Encoding ascii .env "JWT_SECRET=minhaChaveDeDesenvolvimento123"
   Add-Content -Encoding ascii .env "ALLOWED_ORIGIN=http://localhost:5173"
   ```

4. Compile e rode a API:
   ```bash
   cargo run
   ```
   A primeira compilação baixa e compila todas as dependências — pode levar
   alguns minutos. As próximas rodam bem mais rápido.

A API sobe por padrão em `http://localhost:8080`.

## Endpoints

Idênticos à versão em Go:

| Método | Rota                  | Auth | Descrição                                        |
|--------|-----------------------|------|---------------------------------------------------|
| POST   | `/api/auth/register`  | Não  | Cria uma nova conta (cargo "Default" por padrão)   |
| POST   | `/api/auth/login`     | Não  | Autentica e retorna um token JWT                   |
| GET    | `/api/auth/me`        | Sim  | Retorna os dados do usuário autenticado            |
| GET    | `/health`             | Não  | Health check                                       |

### Exemplo — cadastro

```bash
curl -X POST http://localhost:8080/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"nome":"Ana Pereira","email":"ana.pereira@empresa.com","senha":"minhaSenhaForte123"}'
```

### Exemplo — login

```bash
curl -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ana.pereira@empresa.com","senha":"minhaSenhaForte123"}'
```

A resposta inclui `token` (JWT) e os dados do `usuario`, incluindo `cargo` e
`nivelAcesso` — o formato JSON é byte-a-byte igual ao da versão em Go, então o
frontend em React funciona sem nenhuma alteração.

## Decisões de segurança

- Senhas nunca são armazenadas em texto puro — apenas o hash bcrypt.
- A mensagem de erro de login é genérica ("e-mail ou senha incorretos") para
  não revelar se um e-mail está ou não cadastrado.
- O token JWT carrega `cargo` e `nivelAcesso` para permitir autorização (RBAC)
  em outros módulos sem consultas extras ao banco a cada requisição.
- `require_nivel_minimo` no middleware permite proteger rotas futuras (ex.:
  gerenciamento de cargos, painel do técnico) por nível mínimo de permissão.

## Diferenças em relação à versão em Go

- Nenhuma na API pública — endpoints, formatos de request/response e códigos
  de status são os mesmos.
- Internamente, o pool de conexões é do SQLx em vez do pgx, e o roteamento
  HTTP usa Axum em vez do chi.
