import { useEffect, useMemo, useState } from 'react'
import { History, Search, UserCheck, UserX } from 'lucide-react'
import PageContainer from '../layout/PageContainer'
import { BADGE } from '../chamados/ChamadoUi'

type Request = <T>(path: string, options?: RequestInit) => Promise<T>

// Ajuste aqui se as rotas do seu backend forem outras
const API = {
  usuarios: '/api/admin/usuarios',
  cargos: '/api/admin/cargos',
  cargoDoUsuario: (id: number) => `/api/admin/usuarios/${id}/cargo`,
  statusDoUsuario: (id: number) => `/api/admin/usuarios/${id}/status`,
}

interface Cargo {
  id: number
  nome: string
  nivel: number
}

interface CargoApi {
  id: number
  cargo: string
  nivel: number
}

interface Usuario {
  id: number
  nome: string
  email: string
  ativo: boolean
  idCargo: number | null
  dataCadastro?: string
}

// Formato "cru" vindo do backend — aceita variações comuns de nome de campo
interface UsuarioApi {
  id: number
  nome?: string
  email?: string
  ativo?: boolean
  status?: string
  idCargo?: number | null
  dataCadastro?: string
  dataCriacao?: string
}

function normalizarUsuario(u: UsuarioApi): Usuario {
  return {
    id: u.id,
    nome: u.nome ?? '—',
    email: u.email ?? '—',
    ativo: u.ativo ?? (u.status ? u.status.toLowerCase() === 'ativo' : true),
    idCargo: u.idCargo ?? null,
    dataCadastro: u.dataCadastro ?? u.dataCriacao,
  }
}

interface LogItem {
  quando: Date
  texto: string
}

const POR_PAGINA = 10

const TH = 'px-4 py-3 text-[11px] font-medium uppercase tracking-wide text-slate-500'
const SELECT =
  'rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand/40 disabled:cursor-not-allowed disabled:opacity-60'
const FILTRO =
  'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand/40'
const BOTAO_SECUNDARIO =
  'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50'

const rotuloCargo = (c: Cargo) => `${c.nome} (Nível ${c.nivel})`
const formatarData = (data?: string) => (data ? new Date(data).toLocaleDateString('pt-BR') : '—')

interface GestaoUsuariosProps {
  request: Request
}

function GestaoUsuarios({ request }: GestaoUsuariosProps) {
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [cargos, setCargos] = useState<Cargo[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [salvandoId, setSalvandoId] = useState<number | null>(null)

  const [busca, setBusca] = useState('')
  const [filtroCargo, setFiltroCargo] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('')
  const [pagina, setPagina] = useState(1)

  const [log, setLog] = useState<LogItem[]>([])

  useEffect(() => {
    let ativo = true

    async function carregar() {
      const [rUsuarios, rCargos] = await Promise.allSettled([
        request<UsuarioApi[]>(API.usuarios),
        request<CargoApi[]>(API.cargos),
      ])
      if (!ativo) return

      const falhas: string[] = []
      const motivo = (r: PromiseRejectedResult) =>
        r.reason instanceof Error ? r.reason.message : 'erro desconhecido'

      if (rUsuarios.status === 'fulfilled') setUsuarios(rUsuarios.value.map(normalizarUsuario))
      else falhas.push(`usuários: ${motivo(rUsuarios)}`)

      if (rCargos.status === 'fulfilled') {
        setCargos(rCargos.value.map(({ id, cargo, nivel }) => ({ id, nome: cargo, nivel })))
      }
      else falhas.push(`cargos: ${motivo(rCargos)}`)

      if (falhas.length > 0) setErro(`Não foi possível carregar ${falhas.join(' | ')}`)
      setCarregando(false)
    }

    void carregar()
    return () => {
      ativo = false
    }
  }, [request])

  // Volta para a primeira página sempre que um filtro muda
  useEffect(() => setPagina(1), [busca, filtroCargo, filtroStatus])

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return usuarios.filter((u) => {
      if (termo && !u.nome.toLowerCase().includes(termo) && !u.email.toLowerCase().includes(termo)) return false
      if (filtroCargo && String(u.idCargo ?? '') !== filtroCargo) return false
      if (filtroStatus === 'ativo' && !u.ativo) return false
      if (filtroStatus === 'inativo' && u.ativo) return false
      return true
    })
  }, [usuarios, busca, filtroCargo, filtroStatus])

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA))
  const paginaAtual = Math.min(pagina, totalPaginas)
  const visiveis = filtrados.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA)

  const nomeCargo = (id: number | null) => {
    const c = cargos.find((x) => x.id === id)
    return c ? rotuloCargo(c) : 'Sem cargo'
  }

  async function alterar(
    usuario: Usuario,
    caminho: string,
    metodo: 'PUT' | 'PATCH',
    body: object,
    aplicar: (u: Usuario) => Usuario,
    descricao: string,
    mensagemErro: string,
  ) {
    setErro(null)
    setSalvandoId(usuario.id)
    try {
      await request(caminho, { method: metodo, body: JSON.stringify(body) })
      setUsuarios((lista) => lista.map((u) => (u.id === usuario.id ? aplicar(u) : u)))
      setLog((l) => [{ quando: new Date(), texto: descricao }, ...l])
    } catch (e) {
      setErro(e instanceof Error ? `${mensagemErro}: ${e.message}` : mensagemErro)
    } finally {
      setSalvandoId(null)
    }
  }

  function trocarCargo(usuario: Usuario, valor: string) {
    const idCargo = valor === '' ? null : Number(valor)
    void alterar(
      usuario,
      API.cargoDoUsuario(usuario.id),
      'PATCH',
      { idCargo },
      (u) => ({ ...u, idCargo }),
      `Cargo de ${usuario.nome} alterado de ${nomeCargo(usuario.idCargo)} para ${nomeCargo(idCargo)}`,
      'Não foi possível alterar o cargo',
    )
  }

  function alternarStatus(usuario: Usuario) {
    const ativo = !usuario.ativo
    void alterar(
      usuario,
      API.statusDoUsuario(usuario.id),
      'PUT',
      { ativo },
      (u) => ({ ...u, ativo }),
      `${usuario.nome} foi ${ativo ? 'reativado' : 'desativado'}`,
      'Não foi possível alterar o status',
    )
  }

  return (
    <PageContainer titulo="Gestão de Usuários" subtitulo="Cargos, status de acesso e histórico de alterações.">
      {/* Busca e filtros */}
      <section className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:flex-row md:items-center">
        <label className="relative flex-1">
          <span className="sr-only">Buscar usuário</span>
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou e-mail"
            className={`${FILTRO} w-full pl-9`}
          />
        </label>
        <select
          aria-label="Filtrar por cargo"
          value={filtroCargo}
          onChange={(e) => setFiltroCargo(e.target.value)}
          className={FILTRO}
        >
          <option value="">Todos os cargos</option>
          {cargos.map((c) => (
            <option key={c.id} value={c.id}>{rotuloCargo(c)}</option>
          ))}
        </select>
        <select
          aria-label="Filtrar por status"
          value={filtroStatus}
          onChange={(e) => setFiltroStatus(e.target.value)}
          className={FILTRO}
        >
          <option value="">Todos os status</option>
          <option value="ativo">Ativos</option>
          <option value="inativo">Inativos</option>
        </select>
      </section>

      {erro && <p className="mt-6 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{erro}</p>}

      {/* Tabela */}
      <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th scope="col" className={`${TH} pl-5`}>ID</th>
                <th scope="col" className={TH}>Nome</th>
                <th scope="col" className={TH}>E-mail</th>
                <th scope="col" className={TH}>Status</th>
                <th scope="col" className={TH}>Cargo</th>
                <th scope="col" className={TH}>Cadastro</th>
                <th scope="col" className={TH}><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {carregando ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-sm text-slate-500">Carregando usuários…</td>
                </tr>
              ) : visiveis.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-sm text-slate-500">Nenhum usuário encontrado.</td>
                </tr>
              ) : (
                visiveis.map((u) => {
                  const ocupado = salvandoId === u.id
                  return (
                    <tr key={u.id} className="transition-colors hover:bg-slate-50/60">
                      <td className="whitespace-nowrap py-3.5 pl-5 pr-4 font-mono text-[11px] text-slate-500">#{u.id}</td>
                      <td className="px-4 py-3.5 font-semibold text-slate-900">{u.nome}</td>
                      <td className="px-4 py-3.5 text-slate-600">{u.email}</td>
                      <td className="px-4 py-3.5">
                        <span
                          className={`${BADGE} ${
                            u.ativo
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : 'border-slate-200 bg-slate-100 text-slate-600'
                          }`}
                        >
                          {u.ativo ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <select
                          aria-label={`Cargo de ${u.nome}`}
                          value={u.idCargo ?? ''}
                          disabled={ocupado || cargos.length === 0}
                          onChange={(e) => trocarCargo(u, e.target.value)}
                          className={SELECT}
                        >
                          {u.idCargo == null && <option value="">Sem cargo</option>}
                          {cargos.map((c) => (
                            <option key={c.id} value={c.id}>{rotuloCargo(c)}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3.5 text-slate-600">{formatarData(u.dataCadastro)}</td>
                      <td className="px-4 py-3.5 text-right">
                        <button type="button" disabled={ocupado} onClick={() => alternarStatus(u)} className={BOTAO_SECUNDARIO}>
                          {u.ativo ? <UserX size={14} /> : <UserCheck size={14} />}
                          {u.ativo ? 'Desativar' : 'Reativar'}
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Paginação */}
        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3 text-sm text-slate-600">
          <span>
            {filtrados.length} usuário(s) · página {paginaAtual} de {totalPaginas}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={paginaAtual <= 1}
              onClick={() => setPagina(paginaAtual - 1)}
              className={BOTAO_SECUNDARIO}
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={paginaAtual >= totalPaginas}
              onClick={() => setPagina(paginaAtual + 1)}
              className={BOTAO_SECUNDARIO}
            >
              Próxima
            </button>
          </div>
        </div>
      </section>

      {/* Log de auditoria (alterações feitas nesta sessão) */}
      <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <h2 className="flex items-center gap-2 border-b border-slate-200 px-5 py-4 text-sm font-semibold text-slate-900">
          <History size={16} className="text-brand" />
          Log de auditoria
        </h2>
        {log.length === 0 ? (
          <p className="px-5 py-4 text-sm text-slate-500">Nenhuma alteração registrada ainda.</p>
        ) : (
          <ul className="divide-y divide-slate-200">
            {log.map((item, i) => (
              <li key={i} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                <span className="text-slate-800">{item.texto}</span>
                <time className="shrink-0 text-xs text-slate-500">
                  {item.quando.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageContainer>
  )
}

export default GestaoUsuarios