import { useEffect, useState } from "react";
import {
  Activity,
  Cpu,
  FileText,
  HardDrive,
  MemoryStick,
  Monitor,
  RefreshCw,
  Wifi,
  WifiOff,
} from "lucide-react";
import type { MachineTelemetry, RelatorioAutoavaliacao } from "../../types";
import { TELEMETRIA_API_URL, TELEMETRIA_WS_URL as WS_BASE_URL } from "../../utils/data";

interface TelemetriaChamadoCardProps {
  idChamado: number;
}

function formatarUptime(segundos: number) {
  const horas = Math.floor(segundos / 3600);
  const minutos = Math.floor((segundos % 3600) / 60);
  if (horas > 0) return `${horas}h ${minutos}min`;
  return `${minutos} min`;
}

function formatarDataHora(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function corBarra(percent: number) {
  if (percent >= 85) return "bg-red-500";
  if (percent >= 65) return "bg-amber-500";
  return "bg-emerald-500";
}

export default function TelemetriaChamadoCard({ idChamado }: TelemetriaChamadoCardProps) {
  const [aba, setAba] = useState<"relatorio" | "tempo_real">("relatorio");
  const [relatorios, setRelatorios] = useState<RelatorioAutoavaliacao[]>([]);
  const [carregandoRelatorio, setCarregandoRelatorio] = useState(true);
  const [gerandoRelatorio, setGerandoRelatorio] = useState(false);
  const [erroRelatorio, setErroRelatorio] = useState<string | null>(null);

  const [telemetriaAoVivo, setTelemetriaAoVivo] = useState<MachineTelemetry | null>(null);
  const [wsConectado, setWsConectado] = useState(false);

  const relatorioMaisRecente = relatorios[0] ?? null;
  const machineUidAlvo = relatorioMaisRecente?.machineUid ?? "atual";

  async function carregarRelatorios() {
    setCarregandoRelatorio(true);
    setErroRelatorio(null);
    try {
      const resp = await fetch(`${TELEMETRIA_API_URL}/api/telemetria/chamados/${idChamado}/relatorio`);
      if (!resp.ok) throw new Error(`Status ${resp.status}`);
      const lista = (await resp.json()) as RelatorioAutoavaliacao[];
      setRelatorios(Array.isArray(lista) ? lista : []);
    } catch {
      setRelatorios([]);
    } finally {
      setCarregandoRelatorio(false);
    }
  }

  async function capturarNovoRelatorio() {
    setGerandoRelatorio(true);
    setErroRelatorio(null);
    try {
      const resp = await fetch(`${TELEMETRIA_API_URL}/api/telemetria/chamados/${idChamado}/relatorio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          machineUid: relatorioMaisRecente?.machineUid ?? "",
        }),
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => null);
        throw new Error(
          errData?.erro ?? "Não foi possível capturar o diagnóstico. Verifique se o Agente Rust está ativo.",
        );
      }
      await carregarRelatorios();
      setAba("relatorio");
    } catch (e) {
      setErroRelatorio(e instanceof Error ? e.message : "Erro ao gerar relatório técnico.");
    } finally {
      setGerandoRelatorio(false);
    }
  }

  useEffect(() => {
    void carregarRelatorios();
  }, [idChamado]);

  // Conexão em tempo real via WebSocket + fallback inicial via HTTP
  useEffect(() => {
    let cancelado = false;
    let ws: WebSocket | null = null;

    async function buscarSnapshotInicial() {
      try {
        const endpoint =
          machineUidAlvo && machineUidAlvo !== "atual"
            ? `${TELEMETRIA_API_URL}/api/telemetria/maquinas/${encodeURIComponent(machineUidAlvo)}`
            : `${TELEMETRIA_API_URL}/api/telemetria/maquinas/atual`;
        const resp = await fetch(endpoint);
        if (resp.ok && !cancelado) {
          const data = (await resp.json()) as MachineTelemetry;
          setTelemetriaAoVivo(data);
        }
      } catch {
        // Ignorado se servidor Go estiver desligado
      }
    }

    void buscarSnapshotInicial();

    try {
      const wsPath =
        machineUidAlvo && machineUidAlvo !== "atual"
          ? `${WS_BASE_URL}/api/telemetria/maquinas/${encodeURIComponent(machineUidAlvo)}/ws`
          : `${WS_BASE_URL}/api/telemetria/ws`;

      ws = new WebSocket(wsPath);
      ws.onopen = () => {
        if (!cancelado) setWsConectado(true);
      };
      ws.onmessage = (event) => {
        if (cancelado) return;
        try {
          const frame = JSON.parse(event.data) as MachineTelemetry;
          setTelemetriaAoVivo(frame);
        } catch {
          // Ignora frame malformado
        }
      };
      ws.onclose = () => {
        if (!cancelado) setWsConectado(false);
      };
      ws.onerror = () => {
        if (!cancelado) setWsConectado(false);
      };
    } catch {
      setWsConectado(false);
    }

    return () => {
      cancelado = true;
      if (ws) ws.close();
    };
  }, [machineUidAlvo]);

  const onlineAoVivo =
    telemetriaAoVivo?.statusConexao === "online" && wsConectado;

  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <Monitor size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900">
                Diagnóstico e Telemetria da Máquina
              </h2>
              {telemetriaAoVivo ? (
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium border ${
                    onlineAoVivo
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-red-50 text-red-700 border-red-200"
                  }`}
                >
                  {onlineAoVivo ? <Wifi size={12} /> : <WifiOff size={12} />}
                  {onlineAoVivo ? "Estação Online" : "Estação Offline"}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                  Sem conexão ao vivo
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500">
              Métricas coletadas pelo Agente Local em Rust via gRPC e coordenadas pelo Servidor Go.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            <button
              type="button"
              onClick={() => setAba("relatorio")}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                aba === "relatorio"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <FileText size={13} />
              Relatório de Autoavaliação ({relatorios.length})
            </button>
            <button
              type="button"
              onClick={() => setAba("tempo_real")}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                aba === "tempo_real"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Activity size={13} />
              Tempo Real (Ao Vivo)
            </button>
          </div>

          <button
            type="button"
            onClick={() => void capturarNovoRelatorio()}
            disabled={gerandoRelatorio}
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 disabled:opacity-50"
          >
            <RefreshCw size={13} className={gerandoRelatorio ? "animate-spin" : ""} />
            {gerandoRelatorio ? "Capturando..." : "Capturar novo diagnóstico"}
          </button>
        </div>
      </div>

      {erroRelatorio && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
          {erroRelatorio}
        </p>
      )}

      {aba === "relatorio" && (
        <div className="mt-4">
          {carregandoRelatorio ? (
            <p className="py-6 text-center text-sm text-slate-500">
              Carregando relatório de autoavaliação...
            </p>
          ) : !relatorioMaisRecente ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
              <p className="text-sm font-medium text-slate-700">
                Nenhum relatório de autoavaliação foi anexado a este chamado ainda.
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Clique em <strong>"Capturar novo diagnóstico"</strong> acima para coletar e salvar o estado atual da máquina.
              </p>
            </div>
          ) : (
            <PainelMetricas
              hostname={relatorioMaisRecente.hostname}
              machineUid={relatorioMaisRecente.machineUid}
              usuarioSo={relatorioMaisRecente.usuarioSo}
              osInfo={`${relatorioMaisRecente.sistemaOperacional} ${relatorioMaisRecente.versaoSo}`}
              cpuBrand={relatorioMaisRecente.modeloCpu}
              cpuCores={relatorioMaisRecente.nucleosCpu}
              uptimeSegundos={relatorioMaisRecente.uptimeSegundos}
              cpuUsagePercent={relatorioMaisRecente.cpuUsagePercent}
              memoriaUsadaMb={relatorioMaisRecente.memoriaUsadaMb}
              memoriaTotalMb={relatorioMaisRecente.memoriaTotalMb}
              memoriaUsoPercent={relatorioMaisRecente.memoriaUsoPercent}
              swapUsadaMb={relatorioMaisRecente.swapUsadaMb}
              swapTotalMb={relatorioMaisRecente.swapTotalMb}
              discos={relatorioMaisRecente.discos}
              topProcessos={relatorioMaisRecente.topProcessos}
              rotuloData={`Relatório registrado em ${formatarDataHora(relatorioMaisRecente.coletadoEm)}`}
            />
          )}
        </div>
      )}

      {aba === "tempo_real" && (
        <div className="mt-4">
          {!telemetriaAoVivo ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
              <p className="text-sm font-medium text-slate-700">
                Aguardando stream de telemetria em tempo real...
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Certifique-se de que o Servidor Go (`porta 8081/50051`) e o Agente Rust estão em execução.
              </p>
            </div>
          ) : (
            <PainelMetricas
              hostname={telemetriaAoVivo.hostname}
              machineUid={telemetriaAoVivo.machineUid}
              usuarioSo={telemetriaAoVivo.usuarioSo}
              osInfo={`${telemetriaAoVivo.osName} ${telemetriaAoVivo.osVersion}`}
              cpuBrand={telemetriaAoVivo.cpuBrand}
              cpuCores={telemetriaAoVivo.cpuCores}
              uptimeSegundos={telemetriaAoVivo.uptimeSeconds}
              cpuUsagePercent={telemetriaAoVivo.cpuUsagePercent}
              memoriaUsadaMb={telemetriaAoVivo.memoriaUsadaMb}
              memoriaTotalMb={telemetriaAoVivo.memoriaTotalMb}
              memoriaUsoPercent={telemetriaAoVivo.memoriaUsoPercent}
              swapUsadaMb={telemetriaAoVivo.swapUsadaMb}
              swapTotalMb={telemetriaAoVivo.swapTotalMb}
              discos={telemetriaAoVivo.discos}
              topProcessos={telemetriaAoVivo.topProcessos}
              rotuloData={`Último Heartbeat: ${formatarDataHora(telemetriaAoVivo.ultimoHeartbeat)}`}
            />
          )}
        </div>
      )}
    </div>
  );
}

interface PainelMetricasProps {
  hostname: string;
  machineUid: string;
  usuarioSo: string;
  osInfo: string;
  cpuBrand: string;
  cpuCores: number;
  uptimeSegundos: number;
  cpuUsagePercent: number;
  memoriaUsadaMb: number;
  memoriaTotalMb: number;
  memoriaUsoPercent: number;
  swapUsadaMb: number;
  swapTotalMb: number;
  discos: MachineTelemetry["discos"];
  topProcessos: MachineTelemetry["topProcessos"];
  rotuloData: string;
}

function PainelMetricas({
  hostname,
  machineUid,
  usuarioSo,
  osInfo,
  cpuBrand,
  cpuCores,
  uptimeSegundos,
  cpuUsagePercent,
  memoriaUsadaMb,
  memoriaTotalMb,
  memoriaUsoPercent,
  swapUsadaMb,
  swapTotalMb,
  discos,
  topProcessos,
  rotuloData,
}: PainelMetricasProps) {
  const swapPercent = swapTotalMb > 0 ? (swapUsadaMb / swapTotalMb) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-4 py-2.5 text-xs text-slate-600">
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          <span>
            Host: <strong className="text-slate-900">{hostname}</strong> ({machineUid})
          </span>
          <span>
            Usuário SO: <strong className="text-slate-900">{usuarioSo || "—"}</strong>
          </span>
          <span>
            SO: <strong className="text-slate-900">{osInfo}</strong>
          </span>
          <span>
            CPU: <strong className="text-slate-900">{cpuBrand}</strong> ({cpuCores} núcleos)
          </span>
          <span>
            Uptime: <strong className="text-slate-900">{formatarUptime(uptimeSegundos)}</strong>
          </span>
        </div>
        <span className="text-[11px] text-slate-500">{rotuloData}</span>
      </div>

      {/* Cards de CPU, RAM e Swap */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
              <Cpu size={15} className="text-blue-600" /> Uso de CPU
            </span>
            <span className="text-base font-bold text-slate-900">
              {cpuUsagePercent.toFixed(1)}%
            </span>
          </div>
          <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full transition-all duration-300 ${corBarra(cpuUsagePercent)}`}
              style={{ width: `${Math.min(100, Math.max(0, cpuUsagePercent))}%` }}
            />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
              <MemoryStick size={15} className="text-indigo-600" /> Memória RAM
            </span>
            <span className="text-base font-bold text-slate-900">
              {memoriaUsadaMb} / {memoriaTotalMb} MB ({memoriaUsoPercent.toFixed(0)}%)
            </span>
          </div>
          <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full transition-all duration-300 ${corBarra(memoriaUsoPercent)}`}
              style={{ width: `${Math.min(100, Math.max(0, memoriaUsoPercent))}%` }}
            />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
              <HardDrive size={15} className="text-amber-600" /> Paginação (Swap)
            </span>
            <span className="text-base font-bold text-slate-900">
              {swapUsadaMb} / {swapTotalMb} MB
            </span>
          </div>
          <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full transition-all duration-300 ${corBarra(swapPercent)}`}
              style={{ width: `${Math.min(100, Math.max(0, swapPercent))}%` }}
            />
          </div>
        </div>
      </div>

      {/* Discos e Top Processos */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
            Unidades de Armazenamento ({discos.length})
          </h3>
          {discos.length === 0 ? (
            <p className="text-xs text-slate-400">Nenhum disco informado.</p>
          ) : (
            <div className="space-y-3">
              {discos.map((d) => (
                <div key={d.pontoMontagem}>
                  <div className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-800">
                      {d.pontoMontagem} <span className="font-normal text-slate-500">({d.sistemaArquivos})</span>
                    </span>
                    <span className="text-slate-600">
                      {d.livreGb.toFixed(1)} GB livres de {d.totalGb.toFixed(1)} GB ({d.usoPercent.toFixed(0)}%)
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full ${corBarra(d.usoPercent)}`}
                      style={{ width: `${Math.min(100, Math.max(0, d.usoPercent))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
            Top Processos em Consumo ({topProcessos.length})
          </h3>
          {topProcessos.length === 0 ? (
            <p className="text-xs text-slate-400">Nenhum processo listado.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-500">
                    <th className="pb-1.5 font-medium">PID</th>
                    <th className="pb-1.5 font-medium">Processo</th>
                    <th className="pb-1.5 text-right font-medium">RAM</th>
                    <th className="pb-1.5 text-right font-medium">CPU</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {topProcessos.map((p) => (
                    <tr key={p.pid}>
                      <td className="py-1.5 font-mono text-slate-500">{p.pid}</td>
                      <td className="py-1.5 font-medium text-slate-800">{p.nome}</td>
                      <td className="py-1.5 text-right text-slate-700">{p.memoriaMb} MB</td>
                      <td className="py-1.5 text-right text-slate-700">
                        {p.cpuUsagePercent.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
