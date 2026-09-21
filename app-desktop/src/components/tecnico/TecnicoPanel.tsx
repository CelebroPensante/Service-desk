import { useEffect, useState } from 'react'
import { CheckCircle2, Eye, Inbox, Users, Wrench } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Chamado } from '../../types'
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

  return (
    <PageContainer
      titulo="Painel do Técnico"
      subtitulo="Gerencie todos os chamados, atribuições e status."
    >
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Resumo label="Total" valor={chamados.length} icon={Users} cor="bg-slate-100 text-slate-600" />
        <Resumo label="Abertos" valor={abertos} icon={Inbox} cor="bg-amber-50 text-amber-600" />
        <Resumo label="Em atendimento" valor={emAtendimento} icon={Wrench} cor="bg-blue-50 text-blue-600" />
        <Resumo label="Finalizados" valor={finalizados} icon={CheckCircle2} cor="bg-emerald-50 text-emerald-600" />
      </div>

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