import { Inbox, Wrench, CheckCircle2, PlusCircle, ArrowUpRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Chamado } from '../../types'
import {
  BADGE,
  ESTA_ABERTO,
  ESTA_EM_ATENDIMENTO,
  ESTA_FINALIZADO,
  estiloPrioridade,
  estiloStatus,
  extras,
  formatarCodigo,
  formatarData,
  normalizar,
} from '../chamados/ChamadoUi'

interface DashboardViewProps {
  chamados: Chamado[]
  erro: string | null
  onNovo: () => void
  onVerTodos: () => void
  onDetalhe: (id: number) => void
}

interface CardProps {
  label: string
  valor: number
  icon: LucideIcon
  cor: string
}

function StatCard({ label, valor, icon: Icon, cor }: CardProps) {
  return (
    <div className="flex items-start justify-between rounded-2xl border border-slate-200 bg-white p-5">
      <div>
        <p className="text-[13px] text-slate-600">{label}</p>
        <p className="mt-2 text-4xl font-bold text-slate-900">{valor}</p>
      </div>
      <div className={'flex h-10 w-10 items-center justify-center rounded-xl ' + cor}>
        <Icon size={20} />
      </div>
    </div>
  )
}

function DashboardView({ chamados, erro, onNovo, onVerTodos, onDetalhe }: DashboardViewProps) {
  const status = chamados.map((c) => normalizar(extras(c).status ?? ''))
  const abertos = status.filter(ESTA_ABERTO).length
  const emAtendimento = status.filter(ESTA_EM_ATENDIMENTO).length
  const finalizados = status.filter(ESTA_FINALIZADO).length

  // mais recentes primeiro (assumindo que id maior = mais novo)
  const ultimos = [...chamados].sort((a, b) => b.id - a.id).slice(0, 5)

  return (
    <div className="mx-auto w-full max-w-6xl px-10 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-600">Visão geral dos seus chamados de suporte.</p>
        </div>
        <button
          type="button"
          onClick={onNovo}
          className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-dark to-brand px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <PlusCircle size={16} />
          Abrir novo chamado
        </button>
      </div>

      {erro && <p className="mt-6 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{erro}</p>}

      <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-3">
        <StatCard label="Chamados abertos" valor={abertos} icon={Inbox} cor="bg-amber-50 text-amber-600" />
        <StatCard label="Em atendimento" valor={emAtendimento} icon={Wrench} cor="bg-blue-50 text-blue-600" />
        <StatCard label="Finalizados" valor={finalizados} icon={CheckCircle2} cor="bg-emerald-50 text-emerald-600" />
      </div>

      <section className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Últimos chamados</h2>
            <p className="mt-1 text-xs text-slate-600">Acompanhe os chamados mais recentes.</p>
          </div>
          {ultimos.length > 0 && (
            <button
              type="button"
              onClick={onVerTodos}
              className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
            >
              Ver todos
              <ArrowUpRight size={14} />
            </button>
          )}
        </div>

        {ultimos.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-14 text-center">
            <div className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-blue-100 text-brand">
              <Inbox size={30} />
            </div>
            <h3 className="mt-5 text-lg font-bold text-slate-900">Nenhum chamado por aqui</h3>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-600">
              Você ainda não abriu nenhum chamado de suporte. Se precisar de ajuda com computador,
              impressora, internet ou qualquer outro problema de TI, é só abrir um novo chamado.
            </p>
            <button
              type="button"
              onClick={onNovo}
              className="mt-6 flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-brand transition hover:bg-slate-50"
            >
              <PlusCircle size={16} />
              Abrir meu primeiro chamado
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-slate-200">
            {ultimos.map((chamado) => {
              const { prioridade, status: statusTexto, dataAbertura } = extras(chamado)
              const data = formatarData(dataAbertura)
              return (
                <li key={chamado.id}>
                  <button
                    type="button"
                    onClick={() => onDetalhe(chamado.id)}
                    className="flex w-full items-center justify-between gap-4 px-6 py-4 text-left transition hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-[11px] text-slate-500">
                        <span className="font-mono text-blue-900/70">{formatarCodigo(chamado.id)}</span>
                        {data && (
                          <>
                            <span aria-hidden="true">•</span>
                            <span>{data}</span>
                          </>
                        )}
                      </p>
                      <p className="mt-1 truncate text-sm font-semibold text-slate-900">{chamado.titulo}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {prioridade && <span className={`${BADGE} ${estiloPrioridade(prioridade)}`}>{prioridade}</span>}
                      {statusTexto && <span className={`${BADGE} ${estiloStatus(statusTexto)}`}>{statusTexto}</span>}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

export default DashboardView