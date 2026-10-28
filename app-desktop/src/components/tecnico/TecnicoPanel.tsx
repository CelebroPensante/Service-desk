import { useEffect, useState } from 'react'
import { Activity, CheckCircle2, Cpu, Eye, Inbox, MemoryStick, Monitor, Users, Wifi, WifiOff, Wrench } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Chamado, MachineTelemetry } from '../../types'
import { TELEMETRIA_API_URL, TELEMETRIA_WS_URL } from '../../utils/data'
import PageContainer from '../layout/PageContainer'
import {
  BADGE,
  ESTA_ABERTO,
  ESTA_EM_ATENDIMENTO,
  ESTA_FINALIZADO,
  estiloPrioridade,
  estiloStatus,
  extras,
  formatarCodigo,
  normalizar,
} from '../chamados/ChamadoUi'

type Request = <T>(path: string, options?: RequestInit) => Promise<T>

interface StatusOpcao {
  id: number
  status: string
}

interface Tecnico {
  id: number
  nome: string
}

// Campos do chamado usados só aqui (o backend envia em camelCase)
interface CamposTecnico {
  idStatus?: number
  idAtendente?: number | null
  idUsuario?: number
  usuario?: string
}
const dados = (chamado: Chamado) => chamado as unknown as CamposTecnico

interface TecnicoPanelProps {
  chamados: Chamado[]
  request: Request
  onRecarregar: () => Promise<void>
  onDetalhe: (id: number) => void
}

const TH = 'px-4 py-3 text-[11px] font-medium uppercase tracking-wide text-slate-500'
const SELECT =
  'rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand/40 disabled:cursor-not-allowed disabled:opacity-60'

const WS_URL = TELEMETRIA_WS_URL + '/api/telemetria/ws'

interface ResumoProps {
  label: string
  valor: number
  icon: LucideIcon
  cor: string
}

function Resumo({ label, valor, icon: Icon, cor }: ResumoProps) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4">
      <div className={'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ' + cor}>
        <Icon size={18} />
      </div>
      <div>
        <p className="text-xs text-slate-600">{label}</p>
        <p className="text-2xl font-bold leading-tight text-slate-900">{valor}</p>
      </div>
    </div>
  )
}

function TecnicoPanel({ chamados, request, onRecarregar, onDetalhe }: TecnicoPanelProps) {
  const [statusOpcoes, setStatusOpcoes] = useState<StatusOpcao[]>([])
  const [tecnicos, setTecnicos] = useState<Tecnico[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [salvandoId, setSalvandoId] = useState<number | null>(null)

  // Telemetria ao vivo das estações monitoradas
  const [maquinas, setMaquinas] = useState<Record<string, MachineTelemetry>>({})
  const [wsConectado, setWsConectado] = useState(false)

  useEffect(() => {
    let ativo = true

    async function carregar() {
      const [rStatus, rTecnicos] = await Promise.allSettled([
        request<StatusOpcao[]>('/api/chamados/status'),
        request<Tecnico[]>('/api/tecnicos'),
      ])
      if (!ativo) return

      const falhas: string[] = []
      const motivo = (r: PromiseRejectedResult) =>
        r.reason instanceof Error ? r.reason.message : 'erro desconhecido'

      if (rStatus.status === 'fulfilled') setStatusOpcoes(rStatus.value)
      else falhas.push(`status: ${motivo(rStatus)}`)

      if (rTecnicos.status === 'fulfilled') setTecnicos(rTecnicos.value)
      else falhas.push(`técnicos: ${motivo(rTecnicos)}`)

      if (falhas.length > 0) setErro(`Não foi possível carregar ${falhas.join(' | ')}`)
    }

    void carregar()
    return () => {
      ativo = false
    }
  }, [request])

  // Carrega a lista de estações do Servidor Go e assina atualizações via WebSocket
  useEffect(() => {
    let cancelado = false
    let ws: WebSocket | null = null

    async function carregarMaquinasIniciais() {
      try {
        const resp = await fetch(`${TELEMETRIA_API_URL}/api/telemetria/maquinas`)
        if (resp.ok && !cancelado) {
          const lista = (await resp.json()) as MachineTelemetry[]
          if (Array.isArray(lista)) {
            const mapa: Record<string, MachineTelemetry> = {}
            for (const m of lista) {
              mapa[m.machineUid] = m
            }
            setMaquinas(mapa)
          }
        }
      } catch {
        // Ignorado se servidor Go não estiver ativo
      }
    }

    void carregarMaquinasIniciais()

    try {
      ws = new WebSocket(WS_URL)
      ws.onopen = () => {
        if (!cancelado) setWsConectado(true)
      }
      ws.onmessage = (event) => {
        if (cancelado) return
        try {
          const snap = JSON.parse(event.data) as MachineTelemetry
          if (snap?.machineUid) {
            setMaquinas((atual) => ({ ...atual, [snap.machineUid]: snap }))
          }
        } catch {
          // Ignora frame inválido
        }
      }
      ws.onclose = () => {
        if (!cancelado) setWsConectado(false)
      }
      ws.onerror = () => {
        if (!cancelado) setWsConectado(false)
      }
    } catch {
      setWsConectado(false)
    }

    return () => {
      cancelado = true
      if (ws) ws.close()
    }
  }, [])

  async function salvar(chamado: Chamado, caminho: string, body: object, mensagemErro: string) {
    setErro(null)
    setSalvandoId(chamado.id)
    try {
      await request(`/api/chamados/${chamado.id}/${caminho}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      })
      await onRecarregar()
    } catch (e) {
      setErro(e instanceof Error ? `${mensagemErro}: ${e.message}` : mensagemErro)
    } finally {
      setSalvandoId(null)
    }
  }

  const status = chamados.map((c) => normalizar(extras(c).status ?? ''))
  const abertos = status.filter(ESTA_ABERTO).length
  const emAtendimento = status.filter(ESTA_EM_ATENDIMENTO).length
  const finalizados = status.filter(ESTA_FINALIZADO).length
  const listaMaquinas = Object.values(maquinas)

  return (
    <PageContainer
      titulo="Painel do Técnico"
      subtitulo="Gerencie todos os chamados, atribuições, status e monitore estações em tempo real."
    >
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Resumo label="Total" valor={chamados.length} icon={Users} cor="bg-slate-100 text-slate-600" />
        <Resumo label="Abertos" valor={abertos} icon={Inbox} cor="bg-amber-50 text-amber-600" />
        <Resumo label="Em atendimento" valor={emAtendimento} icon={Wrench} cor="bg-blue-50 text-blue-600" />
        <Resumo label="Finalizados" valor={finalizados} icon={CheckCircle2} cor="bg-emerald-50 text-emerald-600" />
      </div>

      {/* Monitoramento Ao Vivo das Estações Conectadas via Agente Rust -> Servidor Go */}
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
              <Activity size={16} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Estações Monitoradas em Tempo Real ({listaMaquinas.length})
              </h2>
              <p className="text-xs text-slate-500">
                Stream gRPC recebido dos Agentes em Rust pelo Servidor Go On-Premise.
              </p>
            </div>
          </div>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium border ${
              wsConectado
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-slate-100 text-slate-600 border-slate-200'
            }`}
          >
            {wsConectado ? <Wifi size={12} /> : <WifiOff size={12} />}
            {wsConectado ? 'Servidor Go Conectado' : 'Servidor Go Desconectado'}
          </span>
        </div>

        {listaMaquinas.length === 0 ? (
          <p className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-500">
            Nenhuma estação conectada no momento. Inicie o Servidor Go (<code>porta 50051/8081</code>) e o Agente Rust para visualizar a telemetria ao vivo.
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {listaMaquinas.map((m) => {
              const online = m.statusConexao === 'online'
              return (
                <div
                  key={m.machineUid}
                  className="rounded-xl border border-slate-200 bg-slate-50/70 p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Monitor size={16} className="text-slate-700" />
                      <div>
                        <p className="text-sm font-bold text-slate-900">{m.hostname}</p>
                        <p className="text-[11px] text-slate-500">
                          {m.usuarioSo} • {m.osName} {m.osVersion}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        online
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-red-100 text-red-700'
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          online ? 'bg-emerald-500' : 'bg-red-500'
                        }`}
                      />
                      {online ? 'Online' : 'Offline'}
                    </span>
                  </div>

                  <p className="mt-2 truncate text-[11px] text-slate-500">
                    {m.cpuBrand} ({m.cpuCores} núcleos)
                  </p>

                  <div className="mt-3 grid grid-cols-2 gap-2.5">
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <span className="flex items-center gap-1 text-[11px] text-slate-500">
                        <Cpu size={12} className="text-blue-600" /> CPU
                      </span>
                      <p className="mt-0.5 text-sm font-bold text-slate-900">
                        {m.cpuUsagePercent.toFixed(1)}%
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <span className="flex items-center gap-1 text-[11px] text-slate-500">
                        <MemoryStick size={12} className="text-indigo-600" /> RAM
                      </span>
                      <p className="mt-0.5 text-sm font-bold text-slate-900">
                        {m.memoriaUsadaMb} / {m.memoriaTotalMb} MB
                      </p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {erro && <p className="mt-6 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{erro}</p>}

      <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th scope="col" className={`${TH} pl-5`}>ID</th>
                <th scope="col" className={TH}>Título</th>
                <th scope="col" className={TH}>Usuário</th>
                <th scope="col" className={TH}>Prioridade</th>
                <th scope="col" className={TH}>Status</th>
                <th scope="col" className={TH}>Técnico</th>
                <th scope="col" className={TH}><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {chamados.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-sm text-slate-500">
                    Nenhum chamado encontrado.
                  </td>
                </tr>
              ) : (
                chamados.map((chamado) => {
                  const x = extras(chamado)
                  const d = dados(chamado)
                  const ocupado = salvandoId === chamado.id
                  const atendente = d.idAtendente
                  return (
                    <tr key={chamado.id} className="transition-colors hover:bg-slate-50/60">
                      <td className="whitespace-nowrap py-3.5 pl-5 pr-4 font-mono text-[11px] text-blue-900/70">
                        {formatarCodigo(chamado.id)}
                      </td>
                      <td className="px-4 py-3.5 font-semibold text-slate-900">{chamado.titulo}</td>
                      <td className="px-4 py-3.5 text-slate-600">
                        {d.usuario ?? (d.idUsuario ? `Usuário #${d.idUsuario}` : '—')}
                      </td>
                      <td className="px-4 py-3.5">
                        {x.prioridade && (
                          <span className={`${BADGE} ${estiloPrioridade(x.prioridade)}`}>{x.prioridade}</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          {x.status && <span className={`${BADGE} ${estiloStatus(x.status)}`}>{x.status}</span>}
                          <select
                            aria-label={`Status do chamado ${formatarCodigo(chamado.id)}`}
                            value={d.idStatus ?? ''}
                            disabled={ocupado || statusOpcoes.length === 0}
                            onChange={(e) =>
                              void salvar(
                                chamado,
                                'status',
                                { idStatus: Number(e.target.value) },
                                'Não foi possível atualizar o status',
                              )
                            }
                            className={SELECT}
                          >
                            {statusOpcoes.length === 0 && <option value={d.idStatus ?? ''}>{x.status ?? '—'}</option>}
                            {statusOpcoes.map((s) => (
                              <option key={s.id} value={s.id}>{s.status}</option>
                            ))}
                          </select>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <select
                          aria-label={`Técnico do chamado ${formatarCodigo(chamado.id)}`}
                          value={atendente ?? ''}
                          disabled={ocupado}
                          onChange={(e) =>
                            void salvar(
                              chamado,
                              'atendente',
                              { idAtendente: e.target.value === '' ? null : Number(e.target.value) },
                              'Não foi possível atribuir o técnico',
                            )
                          }
                          className={SELECT}
                        >
                          <option value="">Não atribuído</option>
                          {atendente != null && !tecnicos.some((t) => t.id === atendente) && (
                            <option value={atendente}>Técnico #{atendente}</option>
                          )}
                          {tecnicos.map((t) => (
                            <option key={t.id} value={t.id}>{t.nome}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <button
                          type="button"
                          onClick={() => onDetalhe(chamado.id)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 transition hover:bg-slate-50"
                        >
                          <Eye size={14} />
                          Detalhes
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </PageContainer>
  )
}

export default TecnicoPanel
