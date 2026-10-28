import { useEffect, type FormEvent } from 'react'
import { CheckCircle2, Cpu, HardDrive, Lock, MemoryStick, RefreshCw, Send, Sparkles, Trash2, Wand2 } from 'lucide-react'
import type { CategoriaResumo, MachineTelemetry, PrioridadeResumo, SetorResumo } from '../../types'
import { normalizar } from './ChamadoUi'

export interface ChamadoFormData {
  titulo: string
  descricaoDetalhada: string
  idCategoria: string
  idPrioridade: string
  idSetor: string
}

interface ChamadoFormProps {
  modo: 'novo' | 'editar'
  form: ChamadoFormData
  categorias: CategoriaResumo[]
  prioridades: PrioridadeResumo[]
  // US-23: setores (equipes) e travas conforme a permissão do usuário
  setores: SetorResumo[]
  origemTriagem: boolean
  travarCategoria: boolean
  travarPrioridade: boolean
  podeEditarSetor: boolean
  setorNome: string | null
  erro: string | null
  salvando: boolean
  onSubmit: (event: FormEvent) => void
  onChange: (campo: keyof ChamadoFormData, valor: string) => void
  onCancel: () => void
  onGerarAutoavaliacao?: () => void
  gerandoAutoavaliacao?: boolean
  autoavaliacao?: MachineTelemetry | null
  erroAutoavaliacao?: string | null
  onRemoverAutoavaliacao?: () => void
}

const LABEL = 'mb-1.5 block text-[13px] font-semibold text-slate-900'
const CAMPO =
  'w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:border-brand focus-visible:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand/30'

function ChamadoForm({
  modo,
  form,
  categorias,
  prioridades,
  setores,
  origemTriagem,
  travarCategoria,
  travarPrioridade,
  podeEditarSetor,
  setorNome,
  erro,
  salvando,
  onSubmit,
  onChange,
  onCancel,
  onGerarAutoavaliacao,
  gerandoAutoavaliacao = false,
  autoavaliacao = null,
  erroAutoavaliacao = null,
  onRemoverAutoavaliacao,
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
        {origemTriagem && (
          <div className="mb-5 flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50/60 px-4 py-3">
            <Wand2 size={16} className="mt-0.5 shrink-0 text-brand" />
            <p className="text-sm text-slate-900">
              <span className="font-semibold">Preenchido pela triagem.</span>{' '}
              Categoria, prioridade e setor vieram das suas respostas
              {travarCategoria || travarPrioridade ? '; só a equipe técnica pode alterá-los.' : '.'}
            </p>
          </div>
        )}

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
              disabled={travarCategoria}
              className={`${CAMPO} disabled:cursor-not-allowed disabled:opacity-70`}
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
              disabled={travarPrioridade}
              className={`${CAMPO} disabled:cursor-not-allowed disabled:opacity-70`}
            >
              {!form.idPrioridade && <option value="">Selecione...</option>}
              {prioridades.map((p) => (
                <option key={p.id} value={p.id}>{p.prioridade}</option>
              ))}
            </select>
          </div>
        </div>

        {(podeEditarSetor || setorNome) && (
          <div className="mt-5">
            <label htmlFor="setor" className={LABEL}>
              Setor responsável
              {!podeEditarSetor && <Lock size={12} className="ml-1.5 inline text-slate-500" aria-label="somente leitura" />}
            </label>
            {podeEditarSetor ? (
              <select
                id="setor"
                value={form.idSetor}
                onChange={(e) => onChange('idSetor', e.target.value)}
                className={CAMPO}
              >
                <option value="">Sem setor definido</option>
                {setores.map((s) => (
                  <option key={s.id} value={s.id}>{s.nome}</option>
                ))}
              </select>
            ) : (
              <input
                id="setor"
                type="text"
                value={setorNome ?? ''}
                readOnly
                className={`${CAMPO} cursor-not-allowed opacity-70`}
              />
            )}
          </div>
        )}

        {!editando && (
          <div className="mt-5 rounded-xl border border-dashed border-blue-300 bg-blue-50/60 px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Sparkles size={16} className="text-brand" />
                  Autoavaliação da máquina
                  {autoavaliacao && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                      <CheckCircle2 size={12} /> Pronta para anexar
                    </span>
                  )}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  Coleta automaticamente métricas de CPU, memória RAM, discos e processos via Agente Rust/gRPC.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {autoavaliacao && onRemoverAutoavaliacao && (
                  <button
                    type="button"
                    onClick={onRemoverAutoavaliacao}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
                  >
                    <Trash2 size={14} />
                    Remover
                  </button>
                )}
                <button
                  type="button"
                  onClick={onGerarAutoavaliacao}
                  disabled={!onGerarAutoavaliacao || gerandoAutoavaliacao}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-brand bg-white px-4 py-2 text-sm font-medium text-brand transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCw size={14} className={gerandoAutoavaliacao ? 'animate-spin' : ''} />
                  {gerandoAutoavaliacao
                    ? 'Coletando...'
                    : autoavaliacao
                      ? 'Atualizar autoavaliação'
                      : 'Gerar autoavaliação'}
                </button>
              </div>
            </div>

            {erroAutoavaliacao && (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {erroAutoavaliacao}
              </p>
            )}

            {autoavaliacao && (
              <div className="mt-4 rounded-xl border border-blue-200 bg-white p-4 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 text-xs text-slate-600">
                  <span>
                    Estação: <strong className="text-slate-900">{autoavaliacao.hostname}</strong> ({autoavaliacao.osName} {autoavaliacao.osVersion})
                  </span>
                  <span>
                    Usuário SO: <strong className="text-slate-900">{autoavaliacao.usuarioSo}</strong>
                  </span>
                  <span>
                    Processador: <strong className="text-slate-900">{autoavaliacao.cpuBrand}</strong> ({autoavaliacao.cpuCores} núcleos)
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
                    <Cpu size={18} className="text-blue-600" />
                    <div>
                      <p className="text-[11px] text-slate-500">Uso de CPU</p>
                      <p className="text-sm font-bold text-slate-900">
                        {autoavaliacao.cpuUsagePercent.toFixed(1)}%
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
                    <MemoryStick size={18} className="text-indigo-600" />
                    <div>
                      <p className="text-[11px] text-slate-500">Memória RAM</p>
                      <p className="text-sm font-bold text-slate-900">
                        {autoavaliacao.memoriaUsadaMb} / {autoavaliacao.memoriaTotalMb} MB ({autoavaliacao.memoriaUsoPercent.toFixed(0)}%)
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
                    <HardDrive size={18} className="text-emerald-600" />
                    <div>
                      <p className="text-[11px] text-slate-500">Discos / Processos</p>
                      <p className="text-sm font-bold text-slate-900">
                        {autoavaliacao.discos.length} disco(s) • Top {autoavaliacao.topProcessos.length} proc.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
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
