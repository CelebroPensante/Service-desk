import { useEffect, useState } from 'react'
import { ClipboardList, UserRoundCheck, Users } from 'lucide-react'
import type { Chamado } from '../../types'
import PageContainer from '../layout/PageContainer'
import { BADGE, ESTA_FINALIZADO, estiloPrioridade, extras, formatarCodigo, normalizar } from '../chamados/ChamadoUi'

type Request = <T>(path: string, options?: RequestInit) => Promise<T>

interface Tecnico {
  id: number
  nome: string
}

interface TriagemPanelProps {
  chamados: Chamado[]
  request: Request
  onRecarregar: () => Promise<void>
  onDetalhe: (id: number) => void
}

function TriagemPanel({ chamados, request, onRecarregar, onDetalhe }: TriagemPanelProps) {
  const [tecnicos, setTecnicos] = useState<Tecnico[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [salvandoId, setSalvandoId] = useState<number | null>(null)

  useEffect(() => {
    let ativo = true
    request<Tecnico[]>('/api/tecnicos')
      .then((lista) => ativo && setTecnicos(lista))
      .catch((e: unknown) => {
        if (ativo) setErro(e instanceof Error ? e.message : 'Não foi possível carregar os técnicos.')
      })
    return () => {
      ativo = false
    }
  }, [request])

  const pendentes = chamados.filter((chamado) => {
    const status = normalizar(extras(chamado).status ?? '')
    return chamado.idAtendente == null && !ESTA_FINALIZADO(status)
  })
  const atribuidos = chamados.filter((chamado) => chamado.idAtendente != null)

  async function atribuir(chamado: Chamado, idAtendente: number | null) {
    setErro(null)
    setSalvandoId(chamado.id)
    try {
      await request(`/api/chamados/${chamado.id}/atendente`, {
        method: 'PUT',
        body: JSON.stringify({ idAtendente }),
      })
      await onRecarregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível atribuir o chamado.')
    } finally {
      setSalvandoId(null)
    }
  }

  return (
    <PageContainer titulo="Triagem e Distribuição" subtitulo="Organize a fila e encaminhe chamados para a equipe técnica.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-5">
          <ClipboardList className="text-amber-600" size={20} />
          <div><p className="text-sm text-slate-600">Aguardando responsável</p><p className="text-2xl font-bold text-slate-900">{pendentes.length}</p></div>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-5">
          <UserRoundCheck className="text-blue-600" size={20} />
          <div><p className="text-sm text-slate-600">Já distribuídos</p><p className="text-2xl font-bold text-slate-900">{atribuidos.length}</p></div>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-5">
          <Users className="text-emerald-600" size={20} />
          <div><p className="text-sm text-slate-600">Técnicos disponíveis</p><p className="text-2xl font-bold text-slate-900">{tecnicos.length}</p></div>
        </div>
      </div>

      {erro && <p role="alert" className="mt-5 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{erro}</p>}

      <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Fila de triagem</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Chamado</th>
                <th className="px-4 py-3 font-medium">Categoria</th>
                <th className="px-4 py-3 font-medium">Prioridade</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Atribuir técnico</th>
                <th className="px-4 py-3 font-medium"><span className="sr-only">Detalhes</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {pendentes.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-500">Não há chamados aguardando distribuição.</td></tr>
              ) : pendentes.map((chamado) => {
                const dados = extras(chamado)
                const ocupado = salvandoId === chamado.id
                return (
                  <tr key={chamado.id} className="hover:bg-slate-50/60">
                    <td className="px-5 py-3.5">
                      <span className="block font-mono text-[11px] text-slate-500">{formatarCodigo(chamado.id)}</span>
                      <span className="font-semibold text-slate-900">{chamado.titulo}</span>
                    </td>
                    <td className="px-4 py-3.5 text-slate-600">{chamado.categoria}</td>
                    <td className="px-4 py-3.5">
                      {dados.prioridade && <span className={`${BADGE} ${estiloPrioridade(dados.prioridade)}`}>{dados.prioridade}</span>}
                    </td>
                    <td className="px-4 py-3.5 text-slate-600">{dados.status ?? '—'}</td>
                    <td className="px-4 py-3.5">
                      <select
                        aria-label={`Atribuir ${formatarCodigo(chamado.id)}`}
                        disabled={ocupado || tecnicos.length === 0}
                        value=""
                        onChange={(e) => void atribuir(chamado, Number(e.target.value))}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 disabled:opacity-60"
                      >
                        <option value="">Selecionar técnico</option>
                        {tecnicos.map((tecnico) => <option key={tecnico.id} value={tecnico.id}>{tecnico.nome}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <button type="button" onClick={() => onDetalhe(chamado.id)} className="text-xs font-medium text-blue-700 hover:underline">Detalhes</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </PageContainer>
  )
}

export default TriagemPanel
