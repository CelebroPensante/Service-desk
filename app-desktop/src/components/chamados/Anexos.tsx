import { useEffect, useRef, useState } from 'react'
import { Paperclip, Download, FileText, Loader2, Trash2  } from 'lucide-react'
import { formatarDataUtc } from '../../utils/data'
import type { Anexo } from '../../types'

const API_URL = 'http://localhost:8080'

interface AnexosProps {
  idChamado: number
  token: string
  idUsuarioLogado: number
}

function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function Anexos({ idChamado, token, idUsuarioLogado }: AnexosProps) {
  const [anexos, setAnexos] = useState<Anexo[]>([])
  const [carregando, setCarregando] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [baixandoId, setBaixandoId] = useState<number | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function carregarAnexos() {
    try {
      const res = await fetch(`${API_URL}/api/chamados/${idChamado}/anexos`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()

      if (!res.ok) {
        setErro(data.erro ?? 'Não foi possível carregar os anexos.')
        return
      }

      setAnexos(data as Anexo[])
    } catch {
      setErro('Não foi possível conectar à API. Verifique se o backend está rodando.')
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    carregarAnexos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idChamado])

  async function handleSelecionarArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0]
    if (!arquivo) return

    setErro(null)
    setEnviando(true)

    try {
      const formData = new FormData()
      formData.append('arquivo', arquivo)

      const res = await fetch(`${API_URL}/api/chamados/${idChamado}/anexos`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        // Sem Content-Type manual — o navegador define o boundary do
        // multipart/form-data sozinho.
        body: formData,
      })
      const data = await res.json().catch(() => null)

      if (!res.ok) {
        setErro(data?.erro ?? 'Não foi possível enviar o arquivo.')
        return
      }

      await carregarAnexos()
    } catch {
      setErro('Não foi possível conectar à API. Verifique se o backend está rodando.')
    } finally {
      setEnviando(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function excluirAnexo(anexo: Anexo) {
    if (!window.confirm(`Excluir o anexo "${anexo.nomeOriginal}"?`)) return

    setErro(null)
    try {
      const res = await fetch(
        `${API_URL}/api/chamados/${idChamado}/anexos/${anexo.id}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      )

      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => null)
        setErro(data?.erro ?? 'Não foi possível excluir o anexo.')
        return
      }

      await carregarAnexos()
    } catch {
      setErro('Não foi possível conectar à API. Verifique se o backend está rodando.')
    }
  }

  async function handleDownload(anexo: Anexo) {
    setErro(null)
    setBaixandoId(anexo.id)

    try {
      const res = await fetch(
        `${API_URL}/api/chamados/${idChamado}/anexos/${anexo.id}/download`,
        { headers: { Authorization: `Bearer ${token}` } },
      )

      if (!res.ok) {
        setErro('Não foi possível baixar o arquivo.')
        return
      }

      // Precisa de fetch + blob (não dá pra usar <a href> direto), porque
      // o download exige o header Authorization, que a navegação normal
      // do navegador não envia.
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = anexo.nomeOriginal
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch {
      setErro('Não foi possível conectar à API. Verifique se o backend está rodando.')
    } finally {
      setBaixandoId(null)
    }
  }

  return (
    <div className="border border-slate-200 rounded-lg bg-white">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Anexos</h3>

        <label className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline cursor-pointer">
          {enviando ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Paperclip size={14} />
          )}
          {enviando ? 'Enviando...' : 'Anexar arquivo'}
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            disabled={enviando}
            onChange={handleSelecionarArquivo}
          />
        </label>
      </div>

      <div className="px-4 py-3 space-y-2">
        {carregando && <p className="text-sm text-slate-400">Carregando...</p>}

        {!carregando && anexos.length === 0 && (
          <p className="text-sm text-slate-400">Nenhum anexo ainda.</p>
        )}

        {anexos.map((a) => (
          <div
            key={a.id}
            className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <FileText size={16} className="text-slate-400 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm text-slate-800 truncate">{a.nomeOriginal}</p>
                <p className="text-xs text-slate-400">
                  {formatarTamanho(a.tamanhoBytes)} · {a.nomeUsuario} ·{' '}
                  {formatarDataUtc(a.dataUpload)}
                </p>
              </div>
            </div>

            <button
              onClick={() => handleDownload(a)}
              disabled={baixandoId === a.id}
              className="shrink-0 text-slate-400 hover:text-blue-600 disabled:opacity-50"
              title="Baixar"
            >
              {baixandoId === a.id ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Download size={16} />
              )}
            </button>

            {a.idUsuario === idUsuarioLogado && (
              <button
                onClick={() => excluirAnexo(a)}
                className="text-slate-400 hover:text-red-600"
                title="Excluir"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        ))}
      </div>

      {erro && (
        <p className="mx-4 mb-3 text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{erro}</p>
      )}
    </div>
  )
}

export default Anexos