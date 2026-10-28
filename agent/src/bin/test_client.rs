pub mod telemetria {
    tonic::include_proto!("telemetria");
}

use telemetria::{telemetria_service_client::TelemetriaServiceClient, TelemetriaRequest};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let url = std::env::var("AGENT_URL").unwrap_or_else(|_| "http://127.0.0.1:3000".to_string());
    println!("Conectando ao Agente via gRPC em {url}...");

    let mut client = TelemetriaServiceClient::connect(url).await?;

    let response = client
        .obter_telemetria(tonic::Request::new(TelemetriaRequest {
            incluir_processos: true,
            incluir_discos: true,
            top_n_processos: 5,
        }))
        .await?;

    let snap = response.into_inner();

    println!("\n=======================================================");
    println!("   DIAGNOSTICO DE TELEMETRIA RECEBIDO VIA gRPC");
    println!("=======================================================");
    println!("Machine UID : {}", snap.machine_uid);
    println!("Hostname    : {}", snap.hostname);
    println!("Usuario SO  : {}", snap.usuario_so);
    println!("Sistema Op. : {} ({})", snap.os_name, snap.os_version);
    println!("Processador : {} ({} nucleos)", snap.cpu_brand, snap.cpu_cores);
    println!("Uptime      : {} segundos (~{} min)", snap.uptime_seconds, snap.uptime_seconds / 60);
    println!("-------------------------------------------------------");
    println!("Uso de CPU  : {:.2}%", snap.cpu_usage_percent);
    println!(
        "Memoria RAM : {} MB / {} MB ({:.1}%)",
        snap.memoria_usada_mb, snap.memoria_total_mb, snap.memoria_uso_percent
    );
    println!(
        "Swap (Pag.) : {} MB / {} MB",
        snap.swap_usada_mb, snap.swap_total_mb
    );
    println!("-------------------------------------------------------");
    println!("Discos ({}):", snap.discos.len());
    for d in &snap.discos {
        println!(
            "  - {} ({}) -> {:.2} GB livres de {:.2} GB (Uso: {:.1}%)",
            d.ponto_montagem, d.sistema_arquivos, d.livre_gb, d.total_gb, d.uso_percent
        );
    }
    println!("-------------------------------------------------------");
    println!("Top {} Processos:", snap.top_processos.len());
    for p in &snap.top_processos {
        println!(
            "  - [PID {:>6}] {:<28} | RAM: {:>6} MB | CPU: {:>5.1}%",
            p.pid, p.nome, p.memoria_mb, p.cpu_usage_percent
        );
    }
    println!("=======================================================\n");

    Ok(())
}
