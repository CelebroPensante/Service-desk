import type { Chamado } from '../../types'

// Campos que o backend envia, mas que podem não estar declarados no type Chamado.
// Se o nome no JSON for outro, ajuste aqui.
export interface CamposExtras {
  status?: string
  prioridade?: string
  categoria?: string
  dataAbertura?: string
  usuario?: string // nome de quem abriu (o backend ainda não envia)
}
export const extras = (chamado: Chamado) => chamado as unknown as CamposExtras

export const normalizar = (texto: string) =>
  texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

export const ESTA_ABERTO = (s: string) => s.includes('abert')
export const ESTA_EM_ATENDIMENTO = (s: string) =>
  s.includes('atendimento') || s.includes('andamento')
export const ESTA_FINALIZADO = (s: string) =>
  s.includes('finaliz') || s.includes('conclu') || s.includes('fechad')

export const BADGE = 'rounded-full border px-2.5 py-0.5 text-[11px] font-medium'
const NEUTRO = 'border-slate-200 bg-slate-50 text-slate-600'

export function estiloPrioridade(prioridade: string) {
  const n = normalizar(prioridade)
  if (n.startsWith('cr')) return 'border-red-300 bg-red-100 text-red-700' // Crítica
  if (n === 'alta') return 'border-red-200 bg-red-50 text-red-600'
  if (n.includes('dia')) return 'border-amber-200 bg-amber-50 text-amber-600' // Média
  return NEUTRO // Baixa e demais
}

export function estiloStatus(status: string) {
  const n = normalizar(status)
  if (ESTA_FINALIZADO(n)) return 'border-emerald-200 bg-emerald-50 text-emerald-600'
  if (ESTA_EM_ATENDIMENTO(n)) return 'border-blue-200 bg-blue-50 text-blue-600'
  if (ESTA_ABERTO(n)) return 'border-amber-200 bg-amber-50 text-amber-600'
  return NEUTRO
}

export function formatarCodigo(id: number) {
  return `CHM-${String(id).padStart(4, '0')}`
}

export function formatarData(iso?: string) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}