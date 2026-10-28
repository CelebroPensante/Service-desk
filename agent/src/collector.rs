use std::time::{SystemTime, UNIX_EPOCH};
use sysinfo::{Disks, ProcessesToUpdate, System};

use crate::telemetria::{DiscoInfo, HeartbeatRequest, ProcessoInfo, TelemetriaSnapshot};

const BYTES_PER_MB: u64 = 1024 * 1024;
const BYTES_PER_GB: f64 = 1024.0 * 1024.0 * 1024.0;

#[derive(Clone, Debug)]
pub struct MachineMetadata {
    pub machine_uid: String,
    pub hostname: String,
    pub usuario_so: String,
    pub os_name: String,
    pub os_version: String,
}

impl MachineMetadata {
    pub fn detect() -> Self {
        let hostname = System::host_name().unwrap_or_else(|| "estacao-desconhecida".to_string());
        let os_name = System::name().unwrap_or_else(|| std::env::consts::OS.to_string());
        let os_version = System::os_version().unwrap_or_else(|| "N/A".to_string());
        let usuario_so = std::env::var("USERNAME")
            .or_else(|_| std::env::var("USER"))
            .unwrap_or_else(|_| "usuario".to_string());

        let configured_uid = std::env::var("MACHINE_UID")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let machine_uid = configured_uid.unwrap_or_else(|| {
            format!(
                "{}-{}",
                hostname.to_lowercase(),
                std::env::consts::OS.to_lowercase()
            )
        });

        Self {
            machine_uid,
            hostname,
            usuario_so,
            os_name,
            os_version,
        }
    }
}

pub fn now_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn build_heartbeat(meta: &MachineMetadata) -> HeartbeatRequest {
    HeartbeatRequest {
        machine_uid: meta.machine_uid.clone(),
        hostname: meta.hostname.clone(),
        usuario_so: meta.usuario_so.clone(),
        timestamp_unix_ms: now_unix_ms(),
    }
}

pub fn collect_snapshot(
    sys: &mut System,
    meta: &MachineMetadata,
    incluir_discos: bool,
    incluir_processos: bool,
    top_n_processos: usize,
) -> TelemetriaSnapshot {
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    let cpus = sys.cpus();
    let cpu_cores = cpus.len() as u32;
    let cpu_brand = cpus
        .first()
        .map(|c| c.brand().trim().to_string())
        .filter(|b| !b.is_empty())
        .unwrap_or_else(|| "CPU Genérica".to_string());

    let cpu_usage_percent = sys.global_cpu_usage();

    // No sysinfo >= 0.30, total_memory() e used_memory() retornam bytes
    let memoria_total_mb = sys.total_memory() / BYTES_PER_MB;
    let memoria_usada_mb = sys.used_memory() / BYTES_PER_MB;
    let memoria_uso_percent = if sys.total_memory() > 0 {
        ((sys.used_memory() as f64 / sys.total_memory() as f64) * 100.0) as f32
    } else {
        0.0
    };

    let swap_total_mb = sys.total_swap() / BYTES_PER_MB;
    let swap_usada_mb = sys.used_swap() / BYTES_PER_MB;

    let discos = if incluir_discos {
        let disks = Disks::new_with_refreshed_list();
        disks
            .list()
            .iter()
            .map(|d| {
                let total_bytes = d.total_space();
                let avail_bytes = d.available_space();
                let used_bytes = total_bytes.saturating_sub(avail_bytes);
                let total_gb = (total_bytes as f64) / BYTES_PER_GB;
                let livre_gb = (avail_bytes as f64) / BYTES_PER_GB;
                let uso_percent = if total_bytes > 0 {
                    ((used_bytes as f64 / total_bytes as f64) * 100.0) as f32
                } else {
                    0.0
                };

                DiscoInfo {
                    ponto_montagem: d.mount_point().to_string_lossy().to_string(),
                    sistema_arquivos: d.file_system().to_string_lossy().to_string(),
                    total_gb: (total_gb * 100.0).round() / 100.0,
                    livre_gb: (livre_gb * 100.0).round() / 100.0,
                    uso_percent,
                }
            })
            .collect()
    } else {
        Vec::new()
    };

    let top_processos = if incluir_processos && top_n_processos > 0 {
        sys.refresh_processes(ProcessesToUpdate::All, true);
        let num_cores = cpu_cores.max(1) as f32;
        let mut lista: Vec<ProcessoInfo> = sys
            .processes()
            .values()
            .map(|p| ProcessoInfo {
                pid: p.pid().as_u32(),
                nome: p.name().to_string_lossy().to_string(),
                cpu_usage_percent: (p.cpu_usage() / num_cores).min(100.0),
                memoria_mb: p.memory() / BYTES_PER_MB,
            })
            .collect();

        // Ordena por maior consumo de memória e desempata por uso de CPU
        lista.sort_by(|a, b| {
            b.memoria_mb.cmp(&a.memoria_mb).then_with(|| {
                b.cpu_usage_percent
                    .partial_cmp(&a.cpu_usage_percent)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
        });
        lista.truncate(top_n_processos);
        lista
    } else {
        Vec::new()
    };

    TelemetriaSnapshot {
        machine_uid: meta.machine_uid.clone(),
        hostname: meta.hostname.clone(),
        usuario_so: meta.usuario_so.clone(),
        os_name: meta.os_name.clone(),
        os_version: meta.os_version.clone(),
        cpu_brand,
        cpu_cores,
        uptime_seconds: System::uptime(),
        cpu_usage_percent,
        memoria_total_mb,
        memoria_usada_mb,
        memoria_uso_percent,
        swap_total_mb,
        swap_usada_mb,
        discos,
        top_processos,
        coletado_em_unix_ms: now_unix_ms(),
    }
}
