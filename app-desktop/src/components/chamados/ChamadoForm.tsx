import { useEffect, type FormEvent } from 'react'
import { Send, Sparkles } from 'lucide-react'
import type { CategoriaResumo, PrioridadeResumo } from '../../types'
import { normalizar } from './ChamadoUi'

export interface ChamadoFormData {
  titulo: string
  descricaoDetalhada: string
  idCategoria: string
  idPrioridade: string
}

interface ChamadoFormProps {
  modo: 'novo' | 'editar'
  form: ChamadoFormData
  categorias: CategoriaResumo[]
  prioridades: PrioridadeResumo[]
  erro: string | null
  salvando: boolean
  onSubmit: (event: FormEvent) => void
  onChange: (campo: keyof ChamadoFormData, valor: string) => void
  onCancel: () => void
  // Ainda não existe a coleta de dados da máquina. Quando existir, passe a função aqui
  // e o botão "Gerar autoavaliação" passa a funcionar. Sem ela, o botão fica desativado.
  onGerarAutoavaliacao?: () => void
}

const LABEL = 'mb-1.5 block text-[13px] font-semibold text-slate-900'
const CAMPO =
  'w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:border-brand focus-visible:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand/30'

function ChamadoForm({
  modo,
  form,
  categorias,
  prioridades,
  erro,
  salvando,
  onSubmit,
  onChange,
  onCancel,
  onGerarAutoavaliacao,
}: ChamadoFormProps) {
  const editando = modo === 'editar'

  // Em um chamado novo, a prioridade já começa como "Média"
  useEffect(() => {
    if (editando || form.idPrioridade) return
    const padrao = prioridades.find((p) => normalizar(p.prioridade).includes('dia'))
    if (padrao) onChange('idPrioridade', String(padrao.id))
  }, [editando, form.idPrioridade, prioridades, onChange])

  return (
    <div className="mx-auto w-full max-w-[885px] px-10 py-8">
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">
        {editando ? 'Editar chamado' : 'Abrir novo chamado'}
      </h1>
      <p className="mt-1 text-sm text-slate-600">
        {editando
          ? 'Atualize as informações do chamado.'
          : 'Descreva o problema com detalhes para acelerar o atendimento.'}
      </p>

      <form onSubmit={onSubmit} className="mt-8 rounded-2xl border border-slate-200 bg-white p-7">
        <div>
          <label htmlFor="titulo" className={LABEL}>Título do problema</label>
          <input
            id="titulo"
            type="text"
            value={form.titulo}
            onChange={(e) => onChange('titulo', e.target.value)}
            placeholder="Ex: Computador não inicia"
            required
            className={CAMPO}
          />
        </div>

        <div className="mt-5">
          <label htmlFor="descricao" className={LABEL}>Descrição detalhada</label>
          <textarea
            id="descricao"
            value={form.descricaoDetalhada}
            onChange={(e) => onChange('descricaoDetalhada', e.target.value)}
            placeholder="Descreva o que aconteceu, quando começou, mensagens de erro..."
            rows={4}
            required
            className={`${CAMPO} min-h-28 resize-y`}
          />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="categoria" className={LABEL}>Categoria</label>
            <select
              id="categoria"
              value={form.idCategoria}
              onChange={(e) => onChange('idCategoria', e.target.value)}
              required
              className={CAMPO}
            >
              <option value="">Selecione...</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>{c.categoria}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="prioridade" className={LABEL}>Prioridade</label>
            <select
              id="prioridade"
              value={form.idPrioridade}
              onChange={(e) => onChange('idPrioridade', e.target.value)}
              required
              className={CAMPO}
            >
              {!form.idPrioridade && <option value="">Selecione...</option>}
              {prioridades.map((p) => (
                <option key={p.id} value={p.id}>{p.prioridade}</option>
              ))}
            </select>
          </div>
        </div>

        {!editando && (
          <div className="mt-5 flex items-center justify-between gap-4 rounded-xl border border-dashed border-blue-300 bg-blue-50/60 px-4 py-4">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Sparkles size={16} className="text-brand" />
                Autoavaliação da máquina
              </p>
              <p className="mt-1 text-xs text-slate-600">
                Anexa um relatório técnico automático ao chamado.
              </p>
            </div>
            <button
              type="button"
              onClick={onGerarAutoavaliacao}
              disabled={!onGerarAutoavaliacao}
              title={onGerarAutoavaliacao ? undefined : 'Em breve'}
              className="shrink-0 rounded-lg border border-brand bg-white px-4 py-2 text-sm font-medium text-brand transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white"
            >
              Gerar autoavaliação
            </button>
          </div>
        )}

        {erro && <p className="mt-5 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{erro}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={salvando}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-dark to-brand px-5 py-2.5 text-sm font-semibold text-white shadow-md transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {!editando && <Send size={16} />}
            {salvando
              ? editando ? 'Salvando...' : 'Enviando...'
              : editando ? 'Salvar alterações' : 'Enviar chamado'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default ChamadoForm