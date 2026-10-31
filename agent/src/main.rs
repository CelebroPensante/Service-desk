pub mod telemetria {
    tonic::include_proto!("telemetria");
}

mod collector;
mod remote;

use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use sysinfo::System;
use tokio::time;
use tokio_stream::StreamExt;
use tonic::{transport::Server, Request, Response, Status, Streaming};

use collector::{build_heartbeat, collect_snapshot, now_unix_ms, MachineMetadata};
use telemetria::{
    telemetria_service_client::TelemetriaServiceClient,
    telemetria_service_server::{TelemetriaService, TelemetriaServiceServer},
    HeartbeatRequest, HeartbeatResponse, StreamControl, TelemetriaRequest, TelemetriaSnapshot,
};

type SharedSystem = Arc<Mutex<System>>;

#[derive(Clone)]
struct AgentLocalGrpcService {
    system: SharedSystem,
    metadata: MachineMetadata,
    default_top_processes: usize,
}

#[tonic::async_trait]
impl TelemetriaService for AgentLocalGrpcService {
    async fn obter_telemetria(
        &self,
        request: Request<TelemetriaRequest>,
    ) -> Result<Response<TelemetriaSnapshot>, Status> {
        let req = request.into_inner();
        let incluir_discos = if !req.incluir_discos && !req.incluir_processos && req.top_n_processos == 0 {
            // Chamada simples sem parâmetros (compatível com o protótipo): retorna tudo por padrão
            true
        } else {
            req.incluir_discos
        };
        let incluir_processos = if !req.incluir_discos && !req.incluir_processos && req.top_n_processos == 0 {
            true
        } else {
            req.incluir_processos
        };
        let top_n = if req.top_n_processos > 0 {
            req.top_n_processos as usize
        } else {
            self.default_top_processes
        };

        let mut system = self
            .system
            .lock()
            .map_err(|_| Status::internal("falha ao bloquear estado do coletor de sistema"))?;

        let snapshot = collect_snapshot(
            &mut system,
            &self.metadata,
            incluir_discos,
            incluir_processos,
            top_n,
        );

        Ok(Response::new(snapshot))
    }

    async fn enviar_heartbeat(
        &self,
        _request: Request<HeartbeatRequest>,
    ) -> Result<Response<HeartbeatResponse>, Status> {
        Ok(Response::new(HeartbeatResponse {
            ok: true,
            server_timestamp_unix_ms: now_unix_ms(),
            intervalo_segundos: 5,
        }))
    }

    async fn stream_telemetria(
        &self,
        request: Request<Streaming<TelemetriaSnapshot>>,
    ) -> Result<Response<StreamControl>, Status> {
        let mut stream = request.into_inner();
        while let Some(frame) = stream.next().await {
            let _ = frame?;
        }
        Ok(Response::new(StreamControl {
            aceito: true,
            mensagem: "Stream encerrado com sucesso".to_string(),
            intervalo_segundos: 2,
        }))
    }
}

/// Tarefa assíncrona que envia sinais periódicos de Heartbeat ao Servidor Go On-Premise.
async fn loop_heartbeat_remoto(
    server_url: String,
    metadata: MachineMetadata,
    intervalo_secs: u64,
) {
    let mut ticker = time::interval(Duration::from_secs(intervalo_secs.max(1)));
    loop {
        ticker.tick().await;
        match TelemetriaServiceClient::connect(server_url.clone()).await {
            Ok(mut client) => {
                let req = build_heartbeat(&metadata);
                if let Err(e) = client.enviar_heartbeat(Request::new(req)).await {
                    tracing::debug!("falha ao enviar heartbeat para {server_url}: {e}");
                }
            }
            Err(e) => {
                tracing::debug!("servidor Go ({server_url}) indisponível para heartbeat: {e}");
            }
        }
    }
}

/// Tarefa assíncrona que mantém um stream gRPC contínuo de telemetria com o Servidor Go On-Premise.
async fn loop_stream_telemetria_remoto(
    server_url: String,
    system: SharedSystem,
    metadata: MachineMetadata,
    intervalo_secs: u64,
    top_n_processos: usize,
) {
    loop {
        match TelemetriaServiceClient::connect(server_url.clone()).await {
            Ok(mut client) => {
                tracing::info!(
                    "conectado ao servidor Go de telemetria em {} (machine_uid={})",
                    server_url,
                    metadata.machine_uid
                );

                let sys_clone = system.clone();
                let meta_clone = metadata.clone();
                let dur = Duration::from_secs(intervalo_secs.max(1));

                let outbound = async_stream_snapshots(sys_clone, meta_clone, dur, top_n_processos);

                match client.stream_telemetria(Request::new(outbound)).await {
                    Ok(resp) => {
                        tracing::info!(
                            "stream gRPC finalizado pelo servidor: {}",
                            resp.into_inner().mensagem
                        );
                    }
                    Err(e) => {
                        tracing::warn!("stream gRPC interrompido ({e}); reconectando em 5s...");
                    }
                }
            }
            Err(e) => {
                tracing::debug!(
                    "aguardando servidor Go em {} ({e}); nova tentativa em 5s...",
                    server_url
                );
            }
        }

        time::sleep(Duration::from_secs(5)).await;
    }
}

fn async_stream_snapshots(
    system: SharedSystem,
    metadata: MachineMetadata,
    intervalo: Duration,
    top_n_processos: usize,
) -> impl tokio_stream::Stream<Item = TelemetriaSnapshot> {
    let ticker = time::interval(intervalo);
    tokio_stream::wrappers::IntervalStream::new(ticker).filter_map(move |_| {
        let mut sys = system.lock().ok()?;
        Some(collect_snapshot(&mut sys, &metadata, true, true, top_n_processos))
    })
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let _ = dotenvy::dotenv();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "servicedesk_agent=info".into()),
        )
        .init();

    let local_addr_str =
        std::env::var("AGENT_LOCAL_ADDR").unwrap_or_else(|_| "0.0.0.0:3000".to_string());
    let server_go_url = std::env::var("SERVER_GO_GRPC_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:50051".to_string());
    let telemetry_interval_secs: u64 = std::env::var("TELEMETRY_INTERVAL_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(2);
    let heartbeat_interval_secs: u64 = std::env::var("HEARTBEAT_INTERVAL_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(5);
    let top_processes_limit: usize = std::env::var("TOP_PROCESSES_LIMIT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(5);

    let metadata = MachineMetadata::detect();
    let mut sys = System::new_all();
    sys.refresh_all();
    let shared_sys: SharedSystem = Arc::new(Mutex::new(sys));

    tracing::info!(
        "Agente ServiceDesk iniciado | machine_uid={} | hostname={} | SO={} {}",
        metadata.machine_uid,
        metadata.hostname,
        metadata.os_name,
        metadata.os_version
    );

    remote::start();

    // 1. Inicia envio periódico de Heartbeat ao servidor Go
    tokio::spawn(loop_heartbeat_remoto(
        server_go_url.clone(),
        metadata.clone(),
        heartbeat_interval_secs,
    ));

    // 2. Inicia stream contínuo de Telemetria em tempo real ao servidor Go
    tokio::spawn(loop_stream_telemetria_remoto(
        server_go_url.clone(),
        shared_sys.clone(),
        metadata.clone(),
        telemetry_interval_secs,
        top_processes_limit,
    ));

    // 3. Mantém servidor gRPC local ativo na porta 3000 para autoavaliação local / Tauri
    let addr = local_addr_str.parse()?;
    let service = AgentLocalGrpcService {
        system: shared_sys,
        metadata,
        default_top_processes: top_processes_limit,
    };

    tracing::info!(
        "Endpoint gRPC local do agente escutando em {} | Servidor central alvo: {}",
        local_addr_str,
        server_go_url
    );

    Server::builder()
        .add_service(TelemetriaServiceServer::new(service))
        .serve(addr)
        .await?;

    Ok(())
}
