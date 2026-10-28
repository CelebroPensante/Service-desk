# ServiceDesk Agent (Rust + gRPC)

Agente local de monitoramento e autoavaliação da máquina construído em **Rust**, utilizando **Tokio**, **Tonic (gRPC)** e **sysinfo**.

## Responsabilidades

1. **Coleta de Métricas do Sistema Operacional e Hardware**:
   - Identificação da máquina (`machine_uid`, `hostname`, usuário do SO, versão do SO, modelo e núcleos da CPU, `uptime`).
   - Utilização global de CPU (`%`).
   - Memória RAM total, utilizada (`MB`) e percentual de uso.
   - Memória Swap / paginação em disco total e utilizada (`MB`).
   - Discos montados (capacidade total, espaço livre em `GB` e percentual de ocupação).
   - Top processos em execução ordenados por consumo de memória e CPU.
2. **Transmissão em Tempo Real (`StreamTelemetria`)**:
   - Conecta ao Servidor Coordenador On-Premise em Go (`SERVER_GO_GRPC_URL`, padrão `http://127.0.0.1:50051`) e envia snapshots contínuos via stream gRPC com reconexão automática.
3. **Sinalização de Conectividade (`EnviarHeartbeat`)**:
   - Envia sinais periódicos de *heartbeat* para que o servidor central monitore o status *online/offline* da estação.
4. **Diagnóstico Local Sob Demanda (`ObterTelemetria`)**:
   - Expõe um servidor gRPC local na porta `3000` (`AGENT_LOCAL_ADDR`) para que o aplicativo Desktop/Tauri na estação do usuário possa requisitar uma autoavaliação instantânea ao abrir um chamado.

## Como Executar

```powershell
cd agent
cp .env.example .env
cargo run
```

## Como Testar a Coleta via gRPC

Com o agente rodando em um terminal (`cargo run`), abra **outro terminal** na pasta `agent` e execute o cliente de teste gRPC incluído:

```powershell
cd agent
cargo run --bin test_client
```

Ele fará uma chamada gRPC real (`ObterTelemetria`) na porta `3000` e exibirá no terminal todas as métricas coletadas da sua máquina (CPU, RAM, Swap, Discos e Top 5 Processos).
