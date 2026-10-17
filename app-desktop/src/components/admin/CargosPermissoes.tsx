import { useEffect, useState } from 'react'
import { Pencil, Plus, ShieldCheck, Trash2, X } from 'lucide-react'
import PageContainer from '../layout/PageContainer'

type Request = <T>(path: string, options?: RequestInit) => Promise<T>

// Ajuste aqui se as rotas do seu backend forem outras
const API = {
  cargos: '/api/admin/cargos',
  permissoes: '/api/admin/cargos/permissoes',
  cargo: (id: number) => `/api/admin/cargos/${id}`,
}

interface Cargo {
  id: number
  nome: string
  nivel: number
  descricao: string
  idPermissao: number
}

interface CargoApi {
  id: number
  cargo: string
  nivel: number
  descricao: string
  idPermissao: number
}

interface NivelPermissao {
  id: number
  nivel: number
  descricao: string
}

type FormCargo = Pick<Cargo, 'nome' | 'nivel'>

const NIVEIS: Record<number, string> = {
  1: 'Usuário padrão',
  2: 'Técnico',
  3: 'Help desk',
  4: 'Gerente',
  5: 'Administrador',
}

// O que cada nível libera (cumulativo). Ajuste conforme as regras do backend.
const PERMISSOES: { nome: string; nivelMinimo: number }[] = [
  { nome: 'Abrir chamados', nivelMinimo: 1 },
  { nome: 'Ver os próprios chamados', nivelMinimo: 1 },
  { nome: 'Ver todos os chamados', nivelMinimo: 2 },
  { nome: 'Gerenciar chamados (status/atribuição)', nivelMinimo: 2 },
  { nome: 'Acessar painel técnico', nivelMinimo: 2 },
  { nome: 'Triagem e distribuição de chamados', nivelMinimo: 3 },
  { nome: 'Relatórios e supervisão de equipe', nivelMinimo: 4 },
  { nome: 'Gerenciar usuários e cargos dos usuários', nivelMinimo: 5 },
  { nome: 'Criar e editar cargos', nivelMinimo: 5 },
]

const permissoesDoNivel = (nivel: number) => PERMISSOES.filter((p) => nivel >= p.nivelMinimo)

const CAMPO =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand/40'
const LABEL = 'mb-1 block text-xs font-medium text-slate-600'
const BOTAO_PRIMARIO =
  'inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60'
const BOTAO_SECUNDARIO =
  'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50'

const VAZIO: FormCargo = { nome: '', nivel: 1 }

function normalizarCargo(cargo: CargoApi): Cargo {
  return {
    id: cargo.id,
    nome: cargo.cargo,
    nivel: cargo.nivel,
    descricao: cargo.descricao,
    idPermissao: cargo.idPermissao,
  }
}

interface FormularioProps {
  inicial: FormCargo
  titulo: string
  salvando: boolean
  onSalvar: (form: FormCargo) => void
  onCancelar: () => void
}

function Formulario({ inicial, titulo, salvando, onSalvar, onCancelar }: FormularioProps) {
  const [form, setForm] = useState<FormCargo>(inicial)
  const valido = form.nome.trim().length > 0

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (valido) onSalvar({ ...form, nome: form.nome.trim() })
      }}
      className="space-y-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">{titulo}</h2>
        <button type="button" onClick={onCancelar} aria-label="Cancelar" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <X size={16} />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <label className="sm:col-span-2">
          <span className={LABEL}>Nome do cargo</span>
          <input
            value={form.nome}
            onChange={(e) => setForm({ ...form, nome: e.target.value })}
            placeholder="Ex: Supervisor"
            className={CAMPO}
            autoFocus
          />
        </label>
        <label>
          <span className={LABEL}>Nível</span>
          <select
            value={form.nivel}
            onChange={(e) => setForm({ ...form, nivel: Number(e.target.value) })}
            className={CAMPO}
          >
            {Object.entries(NIVEIS).map(([n, nome]) => (
              <option key={n} value={n}>Nível {n} — {nome}</option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <p className={LABEL}>Permissões deste nível</p>
        <Permissoes nivel={form.nivel} />
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancelar} className={BOTAO_SECUNDARIO}>Cancelar</button>
        <button type="submit" disabled={!valido || salvando} className={BOTAO_PRIMARIO}>
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </form>
  )
}

function Permissoes({ nivel }: { nivel: number }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {permissoesDoNivel(nivel).map((p) => (
        <li key={p.nome} className="rounded-md bg-slate-100 px-2 py-1 text-[11px] text-slate-600">
          {p.nome}
        </li>
      ))}
    </ul>
  )
}

interface CargosPermissoesProps {
  request: Request
}

function CargosPermissoes({ request }: CargosPermissoesProps) {
  const [cargos, setCargos] = useState<Cargo[]>([])
  const [permissoes, setPermissoes] = useState<NivelPermissao[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [editando, setEditando] = useState<number | 'novo' | null>(null)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    let ativo = true
    Promise.all([request<CargoApi[]>(API.cargos), request<NivelPermissao[]>(API.permissoes)])
      .then(([lista, niveis]) => {
        if (!ativo) return
        setCargos(lista.map(normalizarCargo))
        setPermissoes(niveis)
      })
      .catch((e) => ativo && setErro(`Não foi possível carregar os cargos: ${e instanceof Error ? e.message : 'erro desconhecido'}`))
      .finally(() => ativo && setCarregando(false))
    return () => {
      ativo = false
    }
  }, [request])

  async function salvar(form: FormCargo) {
    setErro(null)
    setSalvando(true)
    try {
      const permissao = permissoes.find((item) => item.nivel === form.nivel)
      if (!permissao) throw new Error('não existe uma permissão para o nível selecionado')
      const payload = { cargo: form.nome, idPermissao: permissao.id }

      if (editando === 'novo') {
        const criado = await request<{ id: number }>(API.cargos, {
          method: 'POST',
          body: JSON.stringify(payload),
        })
        setCargos((lista) => [...lista, {
          id: criado.id,
          nome: form.nome,
          nivel: form.nivel,
          descricao: permissao.descricao,
          idPermissao: permissao.id,
        }])
      } else if (typeof editando === 'number') {
        const id = editando
        await request(API.cargo(id), { method: 'PUT', body: JSON.stringify(payload) })
        setCargos((lista) => lista.map((cargo) => (cargo.id === id
          ? { ...cargo, nome: form.nome, nivel: form.nivel, descricao: permissao.descricao, idPermissao: permissao.id }
          : cargo)))
      }
      setEditando(null)
    } catch (e) {
      setErro(e instanceof Error ? `Não foi possível salvar o cargo: ${e.message}` : 'Não foi possível salvar o cargo')
    } finally {
      setSalvando(false)
    }
  }

  async function excluir(cargo: Cargo) {
    if (!window.confirm(`Excluir o cargo "${cargo.nome}"? Usuários com esse cargo podem ficar sem acesso.`)) return
    setErro(null)
    try {
      await request(API.cargo(cargo.id), { method: 'DELETE' })
      setCargos((l) => l.filter((c) => c.id !== cargo.id))
    } catch (e) {
      setErro(e instanceof Error ? `Não foi possível excluir o cargo: ${e.message}` : 'Não foi possível excluir o cargo')
    }
  }

  const ordenados = [...cargos].sort((a, b) => b.nivel - a.nivel)

  return (
    <PageContainer titulo="Cargos e Permissões" subtitulo="Defina níveis de acesso e o que cada cargo pode fazer.">
      <div className="mb-5 flex justify-end">
        <button type="button" onClick={() => setEditando('novo')} disabled={editando === 'novo'} className={BOTAO_PRIMARIO}>
          <Plus size={16} />
          Novo cargo
        </button>
      </div>

      {erro && <p className="mb-5 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{erro}</p>}

      {editando === 'novo' && (
        <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-5">
          <Formulario
            inicial={VAZIO}
            titulo="Novo cargo"
            salvando={salvando}
            onSalvar={salvar}
            onCancelar={() => setEditando(null)}
          />
        </section>
      )}

      {carregando ? (
        <p className="text-sm text-slate-500">Carregando cargos…</p>
      ) : ordenados.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-500">
          Nenhum cargo cadastrado.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {ordenados.map((cargo) => (
            <article key={cargo.id} className="rounded-2xl border border-slate-200 bg-white p-5">
              {editando === cargo.id ? (
                <Formulario
                  inicial={{ nome: cargo.nome, nivel: cargo.nivel }}
                  titulo={`Editar ${cargo.nome}`}
                  salvando={salvando}
                  onSalvar={salvar}
                  onCancelar={() => setEditando(null)}
                />
              ) : (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <ShieldCheck size={16} className="shrink-0 text-brand" />
                        <h2 className="truncate text-base font-semibold text-slate-900">{cargo.nome}</h2>
                        <span className="rounded-md border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">
                          Nível {cargo.nivel}
                        </span>
                      </div>
                      {cargo.descricao && <p className="mt-1.5 text-sm text-slate-600">{cargo.descricao}</p>}
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <button type="button" onClick={() => setEditando(cargo.id)} className={BOTAO_SECUNDARIO}>
                        <Pencil size={13} />
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => void excluir(cargo)}
                        aria-label={`Excluir ${cargo.nome}`}
                        className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="mt-4">
                    <Permissoes nivel={cargo.nivel} />
                  </div>
                </>
              )}
            </article>
          ))}
        </div>
      )}
    </PageContainer>
  )
}

export default CargosPermissoes