import { useMemo, useState } from 'react'
import { Eye, PlusCircle, Search } from 'lucide-react'
import type { Chamado } from '../../types'
import {
  BADGE,
  estiloPrioridade,
  estiloStatus,
  extras,
  formatarCodigo,
  formatarData,
  normalizar,
} from './ChamadoUi'

interface ChamadosListProps {
  usuarioNome: string
  chamados: Chamado[]
  erro: string | null
  onNovo: () => void
  onDetalhe: (id: number) => void
  // Editar, excluir e sair não aparecem mais aqui (editar/excluir ficam no detalhe,
  // sair fica na sidebar). Continuam opcionais só para não quebrar o ChamadosScreen.
  onEditar?: (chamado: Chamado) => void
  onExcluir?: (chamado: Chamado) => void
  onSair?: () => void
}

type CampoFiltro = 'status' | 'prioridade' | 'categoria'

const SELECT =
  'min-w-[150px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand'

const TH = 'px-4 py-3 text-[11px] font-medium uppercase tracking-wide text-slate-500'

function ChamadosList({ usuarioNome, chamados, erro, onNovo, onDetalhe }: ChamadosListProps) {
  const [busca, setBusca] = useState('')
  const [status, setStatus] = useState('')
  const [prioridade, setPrioridade] = useState('')
  const [categoria, setCategoria] = useState('')

  // As opções dos filtros vêm dos próprios chamados carregados
  const opcoes = useMemo(() => {
    const unicos = (campo: CampoFiltro) =>
      Array.from(
        new Set(chamados.map((c) => extras(c)[campo]).filter((v): v is string => Boolean(v))),
      ).sort((a, b) => a.localeCompare(b))
    return { status: unicos('status'), prioridade: unicos('prioridade'), categoria: unicos('categoria') }
  }, [chamados])

  const filtrados = useMemo(() => {
    const termo = normalizar(busca)
    return chamados.filter((c) => {
      const x = extras(c)
      if (status && x.status !== status) return false
      if (prioridade && x.prioridade !== prioridade) return false
      if (categoria && x.categoria !== categoria) return false
      if (!termo) return true
      const texto = normalizar(
        [formatarCodigo(c.id), String(c.id), c.titulo, x.usuario ?? usuarioNome].join(' '),
      )
      return texto.includes(termo)
    })
  }, [chamados, busca, status, prioridade, categoria, usuarioNome])

  return (
    <div className="mx-auto w-full max-w-6xl px-10 py-8">
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">Chamados</h1>
      <p className="mt-1 text-sm text-slate-600">Lista completa com filtros.</p>

      {erro && <p className="mt-6 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{erro}</p>}

      {/* Filtros */}
      <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative min-w-[240px] flex-1">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por ID, título ou usuário..."
              aria-label="Buscar chamados"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
            />
          </div>

          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filtrar por status" className={SELECT}>
            <option value="">Status: Todos</option>
            {opcoes.status.map((s) => (
              <option key={s} value={s}>Status: {s}</option>
            ))}
          </select>

          <select value={prioridade} onChange={(e) => setPrioridade(e.target.value)} aria-label="Filtrar por prioridade" className={SELECT}>
            <option value="">Prioridade: Todas</option>
            {opcoes.prioridade.map((p) => (
              <option key={p} value={p}>Prioridade: {p}</option>
            ))}
          </select>

          <select value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Filtrar por categoria" className={SELECT}>
            <option value="">Categoria: Todas</option>
            {opcoes.categoria.map((c) => (
              <option key={c} value={c}>Categoria: {c}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Tabela */}
      <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {chamados.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-14 text-center">
            <h2 className="text-lg font-bold text-slate-900">Nenhum chamado por aqui</h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-600">
              Você ainda não abriu nenhum chamado de suporte.
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th scope="col" className={`${TH} pl-5`}>ID</th>
                  <th scope="col" className={TH}>Título</th>
                  <th scope="col" className={TH}>Usuário</th>
                  <th scope="col" className={TH}>Prioridade</th>
                  <th scope="col" className={TH}>Status</th>
                  <th scope="col" className={TH}>Data</th>
                  <th scope="col" className={TH}><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filtrados.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-10 text-center text-sm text-slate-500">
                      Nenhum chamado encontrado com esses filtros.
                    </td>
                  </tr>
                ) : (
                  filtrados.map((chamado) => {
                    const x = extras(chamado)
                    return (
                      <tr key={chamado.id} className="transition-colors hover:bg-slate-50/60">
                        <td className="whitespace-nowrap py-3.5 pl-5 pr-4 font-mono text-[11px] text-blue-900/70">
                          {formatarCodigo(chamado.id)}
                        </td>
                        <td className="px-4 py-3.5 font-semibold text-slate-900">{chamado.titulo}</td>
                        <td className="px-4 py-3.5 text-slate-600">{x.usuario ?? usuarioNome}</td>
                        <td className="px-4 py-3.5">
                          {x.prioridade && (
                            <span className={`${BADGE} ${estiloPrioridade(x.prioridade)}`}>{x.prioridade}</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5">
                          {x.status && <span className={`${BADGE} ${estiloStatus(x.status)}`}>{x.status}</span>}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3.5 text-slate-700">
                          {formatarData(x.dataAbertura)}
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <button
                            type="button"
                            onClick={() => onDetalhe(chamado.id)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 transition hover:bg-slate-50"
                          >
                            <Eye size={14} />
                            Ver detalhes
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

export default ChamadosList