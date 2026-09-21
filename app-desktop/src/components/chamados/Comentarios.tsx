import { useEffect, useState, type SubmitEvent } from 'react'
import { Send, Pencil, Trash2, Check, X } from 'lucide-react'
import { formatarDataUtc } from '../../utils/data'

const API_URL = 'http://localhost:8080'

interface Comentario {
  id: number
  idChamado: number
  idUsuario: number
  texto: string
  dataComentario: string
  privado: boolean
  editadoEm: string | null
  excluido: boolean
}

interface ComentariosProps {
  idChamado: number
  token: string
  idUsuarioLogado: number
}

function Comentarios({ idChamado, token, idUsuarioLogado }: ComentariosProps) {
  const [comentarios, setComentarios] = useState<Comentario[]>([])
  const [texto, setTexto] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const [editandoId, setEditandoId] = useState<number | null>(null)
  const [textoEdicao, setTextoEdicao] = useState('')

  async function carregarComentarios() {
    try {
      const res = await fetch(`${API_URL}/api/chamados/${idChamado}/comentarios`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()

      if (!res.ok) {
        setErro(data.erro ?? 'Não foi possível carregar os comentários.')
        return
      }

      setComentarios(data as Comentario[])
    } catch {
      setErro('Não foi possível conectar à API. Verifique se o backend está rodando.')
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    carregarComentarios()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idChamado])

  async function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!texto.trim()) return

    setErro(null)
    setEnviando(true)

    try {
      const res = await fetch(`${API_URL}/api/chamados/${idChamado}/comentarios`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ texto, privado: false }),
      })
      const data = await res.json()

      if (!res.ok) {
        setErro(data.erro ?? 'Não foi possível enviar o comentário.')
        return
      }

      setTexto('')
      await carregarComentarios()
    } catch {
      setErro('Não foi possível conectar à API. Verifique se o backend está rodando.')
    } finally {
      setEnviando(false)
    }
  }

  function iniciarEdicao(c: Comentario) {
    setEditandoId(c.id)
    setTextoEdicao(c.texto)
  }

  function cancelarEdicao() {
    setEditandoId(null)
    setTextoEdicao('')
  }

  async function salvarEdicao(comentarioId: number) {
    if (!textoEdicao.trim()) return

    try {
      const res = await fetch(
        `${API_URL}/api/chamados/${idChamado}/comentarios/${comentarioId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ texto: textoEdicao }),
        },
      )
      const data = await res.json()

      if (!res.ok) {
        setErro(data.erro ?? 'Não foi possível editar o comentário.')
        return
      }

      cancelarEdicao()
      await carregarComentarios()
    } catch {
      setErro('Não foi possível conectar à API. Verifique se o backend está rodando.')
    }
  }

  async function excluirComentario(comentarioId: number) {
    try {
      const res = await fetch(
        `${API_URL}/api/chamados/${idChamado}/comentarios/${comentarioId}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        },
      )

      if (!res.ok && res.status !== 204) {
        const data = await res.json()
        setErro(data.erro ?? 'Não foi possível excluir o comentário.')
        return
      }

      await carregarComentarios()
    } catch {
      setErro('Não foi possível conectar à API. Verifique se o backend está rodando.')
    }
  }

  return (
    <div className="flex flex-col h-full max-h-125 border border-slate-200 rounded-lg bg-white">
      <div className="px-4 py-3 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-slate-900">Comentários</h3>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {carregando && <p className="text-sm text-slate-400">Carregando...</p>}

        {!carregando && comentarios.length === 0 && (
          <p className="text-sm text-slate-400">Nenhum comentário ainda.</p>
        )}

        {comentarios.map((c) => {
          const ehAutor = c.idUsuario === idUsuarioLogado
          const emEdicao = editandoId === c.id

          return (
            <div key={c.id} className="rounded-lg bg-slate-50 px-3 py-2 group">
              {emEdicao ? (
                <div className="space-y-2">
                  <textarea
                    value={textoEdicao}
                    onChange={(e) => setTextoEdicao(e.target.value)}
                    rows={2}
                    className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-none"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => salvarEdicao(c.id)}
                      className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
                    >
                      <Check size={12} /> Salvar
                    </button>
                    <button
                      onClick={cancelarEdicao}
                      className="flex items-center gap-1 text-xs text-slate-500 hover:underline"
                    >
                      <X size={12} /> Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-slate-800">{c.texto}</p>

                    {ehAutor && (
                      <div className="hidden group-hover:flex gap-1 shrink-0">
                        <button
                          onClick={() => iniciarEdicao(c)}
                          className="text-slate-400 hover:text-blue-600"
                          title="Editar"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => excluirComentario(c.id)}
                          className="text-slate-400 hover:text-red-600"
                          title="Excluir"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    {formatarDataUtc(c.dataComentario)}
                    {c.editadoEm && ' · editado'}
                  </p>
                </>
              )}
            </div>
          )
        })}
      </div>

      {erro && (
        <p className="mx-4 mb-2 text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{erro}</p>
      )}

      <form onSubmit={handleSubmit} className="flex items-end gap-2 p-3 border-t border-slate-100">
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={2}
          placeholder="Escreva um comentário..."
          className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition resize-none"
        />
        <button
          type="submit"
          disabled={enviando}
          className="rounded-lg p-2.5 text-white bg-linear-to-r from-blue-900 to-blue-600 hover:opacity-90 transition disabled:opacity-50"
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  )
}

export default Comentarios