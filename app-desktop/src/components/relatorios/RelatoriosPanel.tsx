import { useEffect, useState } from 'react'
import { CheckCircle2, ClipboardList, Clock3, UserRoundCheck } from 'lucide-react'
import type { Chamado } from '../../types'
import PageContainer from '../layout/PageContainer'
import { ESTA_ABERTO, ESTA_EM_ATENDIMENTO, ESTA_FINALIZADO, extras, normalizar } from '../chamados/ChamadoUi'

type Request = <T>(path: string, options?: RequestInit) => Promise<T>

interface Tecnico {
  id: number
  nome: string
}

interface RelatoriosPanelProps {
  chamados: Chamado[]
  request: Request
}

function Indicador({ titulo, valor, icon: Icon, tom }: {
  titulo: string
  valor: number
  icon: typeof ClipboardList
  tom: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-5">
      <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tom}`}><Icon size={19} /></span>
      <div><p className="text-sm text-slate-600">{titulo}</p><p className="text-2xl font-bold text-slate-900">{valor}</p></div>
    </div>
  )
}

function contar(chamados: Chamado[], chave: (chamado: Chamado) => string) {
  const totais = new Map<string, number>()
  for (const chamado of chamados) {
    const nome = chave(chamado).trim() || 'Não informado'
    totais.set(nome, (totais.get(nome) ?? 0) + 1)
  }
  return [...totais.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

function RelatoriosPanel({ chamados, request }: RelatoriosPanelProps) {
  const [tecnicos, setTecnicos] = useState<Tecnico[]>([])
  const [erroTecnicos, setErroTecnicos] = useState<string | null>(null)

  useEffect(() => {
    let ativo = true
    request<Tecnico[]>('/api/tecnicos')
      .then((lista) => ativo && setTecnicos(lista))
      .catch((e: unknown) => {
        if (ativo) setErroTecnicos(e instanceof Error ? e.message : 'Não foi possível carregar os técnicos.')
      })
    return () => {
      ativo = false
    }
  }, [request])

  const status = chamados.map((chamado) => normalizar(extras(chamado).status ?? ''))
  const abertos = status.filter(ESTA_ABERTO).length
  const emAtendimento = status.filter(ESTA_EM_ATENDIMENTO).length
  const finalizados = status.filter(ESTA_FINALIZADO).length
  const porCategoria = contar(chamados, (chamado) => chamado.categoria)
  const porPrioridade = contar(chamados, (chamado) => extras(chamado).prioridade ?? '')
  const maxCategoria = Math.max(1, ...porCategoria.map(([, quantidade]) => quantidade))
  const cargaTecnicos = tecnicos
    .map((tecnico) => ({ ...tecnico, total: chamados.filter((chamado) => chamado.idAtendente === tecnico.id).length }))
    .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome))
  const semResponsavel = chamados.filter((chamado) => chamado.idAtendente == null && !ESTA_FINALIZADO(normalizar(extras(chamado).status ?? ''))).length

  return (
    <PageContainer titulo="Relatórios e Supervisão" subtitulo="Acompanhe volume, status e distribuição da equipe.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador titulo="Total de chamados" valor={chamados.length} icon={ClipboardList} tom="bg-slate-100 text-slate-700" />
        <Indicador titulo="Abertos" valor={abertos} icon={Clock3} tom="bg-amber-50 text-amber-700" />
        <Indicador titulo="Em atendimento" valor={emAtendimento} icon={UserRoundCheck} tom="bg-blue-50 text-blue-700" />
        <Indicador titulo="Finalizados" valor={finalizados} icon={CheckCircle2} tom="bg-emerald-50 text-emerald-700" />
      </div>

      {erroTecnicos && <p role="alert" className="mt-5 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">Não foi possível carregar a distribuição da equipe: {erroTecnicos}</p>}

      <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div><h2 className="text-sm font-semibold text-slate-900">Distribuição de chamados</h2><p className="mt-1 text-xs text-slate-500">Chamados ativos sem responsável: {semResponsavel}</p></div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase text-slate-500"><tr><th className="px-5 py-3 font-medium">Técnico</th><th className="px-4 py-3 font-medium">Chamados atribuídos</th></tr></thead>
            <tbody className="divide-y divide-slate-200">
              {cargaTecnicos.length === 0 ? <tr><td colSpan={2} className="px-5 py-8 text-center text-slate-500">Nenhum técnico disponível.</td></tr> : cargaTecnicos.map((tecnico) => <tr key={tecnico.id}><td className="px-5 py-3 text-slate-800">{tecnico.nome}</td><td className="px-4 py-3 font-semibold text-slate-900">{tecnico.total}</td></tr>)}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <h2 className="border-b border-slate-200 px-5 py-4 text-sm font-semibold text-slate-900">Chamados por categoria</h2>
          <ul className="divide-y divide-slate-100">
            {porCategoria.length === 0 ? <li className="px-5 py-8 text-center text-sm text-slate-500">Sem dados para exibir.</li> : porCategoria.map(([nome, total]) => <li key={nome} className="px-5 py-3"><div className="mb-2 flex justify-between gap-3 text-sm"><span className="text-slate-700">{nome}</span><span className="font-medium text-slate-900">{total}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{ width: `${(total / maxCategoria) * 100}%` }} /></div></li>)}
          </ul>
        </section>
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <h2 className="border-b border-slate-200 px-5 py-4 text-sm font-semibold text-slate-900">Chamados por prioridade</h2>
          <ul className="divide-y divide-slate-100">
            {porPrioridade.length === 0 ? <li className="px-5 py-8 text-center text-sm text-slate-500">Sem dados para exibir.</li> : porPrioridade.map(([nome, total]) => <li key={nome} className="flex items-center justify-between px-5 py-3 text-sm"><span className="text-slate-700">{nome}</span><span className="font-semibold text-slate-900">{total}</span></li>)}
          </ul>
        </section>
      </div>
    </PageContainer>
  )
}

export default RelatoriosPanel
