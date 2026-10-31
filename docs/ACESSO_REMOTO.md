# Acesso remoto — implementação e configuração

Implementado sobre `CelebroPensante/Service-desk`, branch `main`, commit base
`b23c19a04de0d0c9efaa1eb2f82b374e71fcec85`. Entrega de 31/10/2026.
O ZIP contém o projeto completo com alterações, sem dependências, executáveis,
segredos ou caches. Nenhuma alteração foi publicada no GitHub.

## O que foi feito

O detalhe do chamado agora contém um painel **Acesso remoto**. Um técnico
(nível de acesso >= 2) solicita uma sessão para um chamado aberto. O solicitante
vê a solicitação nesse mesmo chamado e escolhe se quer compartilhar a tela.
Depois disso, o técnico pode pedir controle de mouse e teclado. O solicitante
pode negar, autorizar ou revogar o controle. Os dois participantes podem encerrar
a sessão; o botão do navegador para parar o compartilhamento também encerra.

- **Go:** coordenação de sessões, sinalização WebRTC e eventos de entrada por
  WebSocket, autenticação pela API Rust existente, validação de participantes,
  consentimento e auditoria no PostgreSQL.
- **Rust:** extensão opcional do agente existente para executar apenas eventos
  de mouse e teclado permitidos. Mantém a telemetria existente.
- **React/TypeScript:** solicitação, consentimentos, vídeo WebRTC, entrada do
  técnico e histórico de ações dentro do chamado.
- **PostgreSQL:** migration `017_acesso_remoto.sql`, com eventos de solicitação,
  autorização, revogação, desconexão do agente e encerramento.

Não implementei um codec ou protocolo de desktop remoto do zero. Reutilizei
WebRTC/getDisplayMedia do navegador, Gorilla WebSocket já presente no servidor,
Tungstenite para o cliente WebSocket Rust e Enigo para entrada nativa. O agente
usa x11rb no Linux e windows-sys no Windows para verificar a configuração dos
monitores. Não há comandos de shell, execução arbitrária, transferência de
arquivos, áudio ou clipboard remoto.

## Diferença em relação ao documento do TCC

A seção 2.3.1 propõe captura de tela pelo agente Rust com bibliotecas nativas.
**Nesta implementação, a captura e a transmissão WebRTC são feitas pelo
navegador; o agente Rust executa a entrada nativa.** Essa escolha evita adicionar
capturador, encoder e stack WebRTC nativos e preserva a separação entre vídeo e
controle prevista no documento. Se a entrega acadêmica exigir captura dentro
do agente, essa parte ainda precisará ser substituída. O texto do TCC não foi
alterado.

O solicitante deve abrir o frontend no navegador para compartilhar. A API
`getDisplayMedia` exige HTTPS ou localhost e pode não estar disponível no WebView
do Tauri. A interface informa essa condição. O técnico pode visualizar onde
WebRTC estiver disponível; o ambiente Tauri específico precisa de validação.

## Como executar

### 1. Banco e API principal

Prepare o projeto como no README original. Em um banco que já possui as
migrations anteriores, aplique somente a nova:

```powershell
psql -U postgres -d servicedesk -f backend/migrations/017_acesso_remoto.sql
```

Não reaplique indiscriminadamente as migrations antigas sobre um banco existente.
Inicie a API Rust normalmente, na porta 8080. As novas rotas consultam
`/api/auth/me`, reutilizando validação JWT e o cargo/estado atual da conta.

### 2. Servidor Go

Em `server-go/.env`, mantenha a conexão com o mesmo PostgreSQL e configure:

```dotenv
API_BASE_URL=http://127.0.0.1:8080
REMOTE_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://tauri.localhost,tauri://localhost
REMOTE_ICE_SERVERS=[]
```

```powershell
cd server-go
go run ./cmd/server
```

Go 1.27 ou superior, conforme o `go.mod` já existente. As rotas novas usam a
mesma porta HTTP 8081. O acesso remoto exige PostgreSQL disponível e a migration
017 aplicada; ele não oferece fallback sem auditoria. A telemetria mantém seu
comportamento anterior.

### 3. Agente na máquina do solicitante

Em `agent/.env`:

```dotenv
REMOTE_CONTROL_ENABLED=true
SERVER_GO_REMOTE_WS_URL=ws://127.0.0.1:8081/api/remoto/agente/ws
```

```powershell
cd agent
cargo run
```

O agente imprime um código aleatório local de 32 caracteres. Ele vale por dois
minutos enquanto não utilizado e é consumido no pareamento. Ao expirar ou após
a revogação, o agente reconecta e imprime outro código. O solicitante digita o
código no próprio chamado **apenas ao autorizar o controle**. Para apenas
visualizar a tela não é necessário ativar o controle no agente.

O agente funciona na sessão gráfica do usuário. No Windows, use o terminal do
usuário conectado; não é um serviço para controlar a tela de login. No Linux,
a entrada requer X11, RandR 1.5, extensão XTest e as bibliotecas de runtime
`libxkbcommon`/`libxkbcommon-x11` (por exemplo, pacotes `libxkbcommon0` e
`libxkbcommon-x11-0` no Ubuntu). Rust recente é necessário para as dependências.

### 4. Frontend

```powershell
cd app-desktop
npm ci
npm run dev
```

Use duas contas e abra o mesmo chamado: a do solicitante e uma conta técnica.
O solicitante precisa manter o detalhe do chamado aberto para ver o pedido.

1. Técnico: **Solicitar acesso remoto**.
2. Solicitante: **Autorizar e compartilhar tela** e escolher o conteúdo no diálogo
   do navegador. Para controle, escolher o monitor inteiro.
3. Técnico: **Solicitar controle de mouse e teclado**.
4. Solicitante: informar o código local e **Autorizar controle** ou **Negar controle**.
5. Técnico: clicar no vídeo para enviar mouse/teclado. **Esc** revoga o controle.
6. Qualquer participante: **Encerrar sessão**. O solicitante também pode usar
   **Revogar controle** mantendo somente o compartilhamento.

Por segurança de coordenadas, o agente aceita controle apenas com **um monitor
ativo na origem (0,0)**. Múltiplos monitores permitem visualização, mas o controle
é recusado. A configuração é verificada novamente antes de cada evento.

## Duas máquinas / rede da organização

`localhost` em cada máquina aponta para ela mesma. Nos clientes, altere os
endereços para o host do servidor:

- `agent/.env`: `SERVER_GO_GRPC_URL` e `SERVER_GO_REMOTE_WS_URL`.
- `app-desktop/.env`: `VITE_API_URL` e `VITE_TELEMETRIA_API_URL`; reinicie o Vite
  ou gere novamente o build após mudar essas variáveis.
- `server-go/.env`: `REMOTE_ALLOWED_ORIGINS` deve conter a origem exata do frontend.
  O CORS da API Rust também precisa permitir essa origem.

Em rede, exponha frontend/API/WebSocket por HTTPS/WSS, normalmente com proxy
reverso e certificado confiável. HTTP em IP de rede não libera captura de tela
no navegador. Os servidores existentes continuam escutando HTTP internamente.
O proxy precisa encaminhar Upgrade de WebSocket e aceitar conexões longas.

Em LAN, `REMOTE_ICE_SERVERS=[]` pode bastar. Entre redes diferentes, configure
STUN/TURN da organização, por exemplo:

```dotenv
REMOTE_ICE_SERVERS=[{"urls":["stun:turn.exemplo.org:3478"]},{"urls":["turn:turn.exemplo.org:3478"],"username":"usuario-configurado","credential":"credencial-configurada"}]
```

O servidor retorna a configuração ICE apenas a usuários autenticados. Este
projeto não instala nem administra um servidor TURN. As credenciais TURN acima
são configuração de implantação, não credenciais reais incluídas na entrega.

## Regras de sessão e segurança

- Técnico e solicitante precisam estar autenticados. Acesso a outro solicitante
  ou a outro técnico concorrente é recusado. O solicitante pode compartilhar
  independentemente de seu nível de cargo; o técnico não pode controlar a si
  próprio neste fluxo.
- Tela e controle têm consentimentos independentes. O código local vincula o
  agente escolhido à autorização. O agente não abre porta de controle na LAN:
  inicia uma conexão de saída para o coordenador.
- Go e Rust validam tipos/limites dos eventos. O agente verifica o identificador
  da sessão antes de executar cada entrada.
- Revogação, erro e desconexão liberam teclas/botões mantidos pressionados. Uma
  perda silenciosa de rede pode levar até 30–45 segundos para ser detectada;
  nesse intervalo não há novos eventos entregues pela conexão interrompida.
- O pedido expira em 2 minutos; após compartilhar, a sessão tem limite de 1 hora.
  O JWT continua limitando a conexão à sua expiração, normalmente 15 minutos no
  backend atual. Após expirar, faça login novamente e inicie outra sessão.
- Uma conexão por participante e uma sessão por chamado. Recarregar/sair da tela
  ou perder WebRTC encerra a sessão; permissões não são restauradas automaticamente.
- Sessões ativas ficam em memória em um único coordenador. Reiniciar o Go encerra
  conexões e permissões. A auditoria permanece no banco; não há failover de sessão.
- A auditoria guarda IDs, ações e horários. Não grava vídeo, conteúdo digitado,
  tokens nem códigos. O identificador histórico do chamado permanece após sua
  exclusão, sem impedir a exclusão normal implementada na API existente.
- Se uma gravação necessária de auditoria falhar, o acesso não é habilitado ou a
  sessão é encerrada. Uma falha do banco no encerramento é registrada no log do
  servidor; nesse caso não é possível garantir persistência desse último evento.

## Arquivos principais

| Arquivo | Responsabilidade |
|---|---|
| `server-go/internal/remote/server.go` | Sessões, consentimentos, WebSockets e pareamento |
| `server-go/internal/remote/protocol.go` | Mensagens e validação de entrada |
| `server-go/internal/remote/auth.go` | Validação pela API de autenticação existente |
| `server-go/internal/remote/cors.go` | Origens explícitas para as rotas novas |
| `server-go/internal/storage/remote.go` | Consulta do chamado e auditoria PostgreSQL |
| `server-go/cmd/server/main.go` | Registro das rotas no servidor existente |
| `backend/migrations/017_acesso_remoto.sql` | Tabela e índice da auditoria |
| `agent/src/remote.rs` | Pareamento e entrada nativa com Enigo |
| `app-desktop/src/components/chamados/AcessoRemoto.tsx` | Painel integrado ao chamado |
| `app-desktop/src/components/chamados/useRemoteAccess.ts` | Sessão do cliente e WebRTC |
| `app-desktop/src/components/chamados/remoteInput.ts` | Coordenadas e teclas do vídeo |
| `app-desktop/src/utils/data.ts` | URLs configuráveis por ambiente |

Os contratos de telemetria/gRPC não foram alterados.

## Verificação realizada

- `server-go`: `go test -race ./...` e `go vet ./...` passaram. Os testes novos
  exercitam RBAC, isolamento entre participantes, consentimento, pareamento,
  códigos expirados/consumidos, revogação, desconexão, falha de auditoria,
  validação de entrada, espera pela conexão do técnico e preservação de zeros/valores false no protocolo.
- `agent`: `cargo test` passou, com 7 testes; `cargo build` passou no Linux.
  `cargo check --target x86_64-pc-windows-gnu` passou; isso valida compilação,
  não a execução nativa no Windows.
- Entrada nativa verificada com **agente Rust real + coordenador Go real + X11
  virtual**: pareamento, movimento para o centro do monitor, Shift e botão do
  mouse pressionados, liberação de ambos ao revogar e encerramento da sessão.
- `app-desktop`: build de produção, lint dos três arquivos novos de implementação
  e testes de coordenadas/teclas passaram. Comando dos testes utilitários:
  `node --experimental-strip-types --test tests/remoteInput.test.ts` (Node 24).
- A migration e a consulta de status foram executadas em PostgreSQL via PGlite,
  incluindo chamados Fechado/Resolvido sem data de resolução e preservação da
  auditoria após excluir o chamado. Não foi executado teste pgx contra um
  PostgreSQL externo neste ambiente.
- A revisão de código foi feita por um segundo agente. Foram corrigidos os
  problemas de status terminal, expiração/consumo de pareamento, monitores e
  exclusão de chamados encontrados na revisão.

**Ainda requer validação real:** compartilhamento completo entre dois navegadores,
entrada em Windows, comportamento no WebView Tauri e redes que exijam TURN.
A execução do navegador automatizado neste ambiente foi bloqueada pela restrição
local de sockets do Chromium; não considero isso um teste WebRTC aprovado.

## Checklist para validar a entrega no seu ambiente

- [ ] Criar chamado e abrir seu detalhe nas contas do solicitante e técnico.
- [ ] Antes de autorizar, confirmar que nenhuma tela ou entrada é recebida.
- [ ] Autorizar a tela e confirmar vídeo/atualizações no outro computador.
- [ ] Negar controle e confirmar que só a visualização continua.
- [ ] Autorizar controle com código atual e testar clique, arraste, roda,
      letras, setas, Shift e um atalho simples no sistema alvo.
- [ ] Revogar com tecla/botão pressionado e confirmar que foram liberados.
- [ ] Parar a captura no navegador, desconectar o agente e fechar cada participante.
- [ ] Conferir o histórico e tentar reutilizar um código já consumido/expirado.
- [ ] Confirmar que chamados Resolvido/Fechado recusam novas sessões.
- [ ] Validar HTTPS/WSS, proxy e TURN na rede que será usada na apresentação.

## Limites desta entrega

Controle nativo é direcionado a Windows e Linux X11 com um monitor. Wayland,
macOS, múltiplos monitores para controle, tela de login, UAC/telas elevadas,
Ctrl+Alt+Del, atalhos reservados pelo navegador e composição IME não são
prometidos. O teclado segue as APIs do Enigo e o layout do sistema alvo;
composição de caracteres e atalhos devem ser conferidos no ambiente final.
O compartilhamento pode continuar disponível onde o controle nativo não é.
