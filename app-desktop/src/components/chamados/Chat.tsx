import { useEffect, useRef, useState, type KeyboardEvent, type SubmitEvent } from 'react'
import { Send } from 'lucide-react'
import { formatarDataUtc } from '../../utils/data'
import type { MensagemChat } from '../../types'

const API_URL = 'http://localhost:8080'
const WS_URL = API_URL.replace(/^http/, 'ws')
const TAMANHO_MAX = 2000
const MAX_TENTATIVAS = 5

type StatusConexao = 'conectando' | 'conectado' | 'desconectado'

interface ChatProps {
  idChamado: number
  token: string
  idUsuarioLogado: number
}

// Junta listas de mensagens sem duplicar (pelo id) e mantém a ordem.
function mesclar(atuais: MensagemChat[], novas: MensagemChat[]): MensagemChat[] {
  const porId = new Map<number, MensagemChat>()
  for (const m of [...atuais, ...novas]) porId.set(m.id, m)
  return [...porId.values()].sort((a, b) => a.id - b.id)
}

function Chat({ idChamado, token, idUsuarioLogado }: ChatProps) {
  const [mensagens, setMensagens] = useState<MensagemChat[]>([])
  const [texto, setTexto] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusConexao>('conectando')
  const [tentativaManual, setTentativaManual] = useState(0)

  const wsRef = useRef<WebSocket | null>(null)
  const listaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelado = false
    let tentativas = 0
    let jaConectou = false
    let timer: ReturnType<typeof setTimeout> | undefined

    async function carregarHistorico() {
      try {
        const res = await fetch(`${API_URL}/api/chamados/${idChamado}/chat/mensagens`, {
          headers: { Authorization: `Bearer ${token}` },
        })

        if (!res.ok) {
          if (!cancelado) setErro('Não foi possível carregar o histórico do chat.')
          return
        }

        const data = (await res.json()) as MensagemChat[]
        if (!cancelado) setMensagens((prev) => mesclar(prev, data))
      } catch {
        if (!cancelado) {
          setErro('Não foi possível conectar à API. Verifique se o backend está rodando.')
        }
      } finally {
        if (!cancelado) setCarregando(false)
      }
    }

    function conectar() {
      const ws = new WebSocket(
        `${WS_URL}/api/chamados/${idChamado}/chat/ws?token=${encodeURIComponent(token)}`,
      )
      wsRef.current = ws

      ws.onopen = () => {
        tentativas = 0
        setStatus('conectado')
        // Se caiu e voltou, busca o que foi enviado enquanto estava fora.
        if (jaConectou) carregarHistorico()
        jaConectou = true
      }

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data) as MensagemChat
          setMensagens((prev) => mesclar(prev, [msg]))
        } catch {
          // mensagem malformada: ignora
        }
      }

      ws.onclose = () => {
        if (cancelado) return

        if (tentativas < MAX_TENTATIVAS) {
          tentativas++
          setStatus('conectando')
          timer = setTimeout(conectar, 2000 * tentativas)
        } else {
          setStatus('desconectado')
        }
      }
    }

    carregarHistorico()
    conectar()

    return () => {
      cancelado = true
      clearTimeout(timer)
      wsRef.current?.close()
    }
  }, [idChamado, token, tentativaManual])

  // Rola para a última mensagem sempre que a lista muda.
  useEffect(() => {
    const el = listaRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [mensagens])

  function enviar() {
    const t = texto.trim()
    const ws = wsRef.current
    if (!t || !ws || ws.readyState !== WebSocket.OPEN) return

    ws.send(JSON.stringify({ texto: t }))
    setTexto('')
  }

  function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    enviar()
  }

  // Enter envia; Shift+Enter quebra linha.
  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      enviar()
    }
  }

  function reconectar() {
    setStatus('conectando')
    setTentativaManual((n) => n + 1)
  }

  const corStatus =
    status === 'conectado'
      ? 'bg-green-500'
      : status === 'conectando'
        ? 'bg-amber-400'
        : 'bg-red-500'

  const textoStatus =
    status === 'conectado'
      ? 'Conectado'
      : status === 'conectando'
        ? 'Conectando...'
        : 'Desconectado'

  return (
    <div className="flex flex-col h-96 border border-slate-200 rounded-lg bg-white">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-slate-900">Chat</h3>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className={`inline-block w-2 h-2 rounded-full ${corStatus}`} />
          {textoStatus}
          {status === 'desconectado' && (
            <button onClick={reconectar} className="text-blue-600 hover:underline">
              Tentar novamente
            </button>
          )}
        </div>
      </div>

      <div ref={listaRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {carregando && <p className="text-sm text-slate-400">Carregando...</p>}

        {!carregando && mensagens.length === 0 && (
          <p className="text-sm text-slate-400">Nenhuma mensagem ainda. Comece a conversa!</p>
        )}

        {mensagens.map((m) => {
          const minha = m.idUsuario === idUsuarioLogado

          return (
            <div key={m.id} className={`flex ${minha ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] rounded-lg px-3 py-2 ${
                  minha ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-800'
                }`}
              >
                {!minha && m.nomeUsuario && (
                  <p className="text-xs font-semibold text-slate-500 mb-0.5">{m.nomeUsuario}</p>
                )}
                <p className="text-sm whitespace-pre-wrap wrap-break-word">{m.texto}</p>
                <p className={`text-xs mt-1 ${minha ? 'text-blue-100' : 'text-slate-400'}`}>
                  {formatarDataUtc(m.dataEnvio)}
                </p>
              </div>
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
          onKeyDown={handleKeyDown}
          rows={2}
          maxLength={TAMANHO_MAX}
          placeholder="Escreva uma mensagem..."
          className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition resize-none"
        />
        <button
          type="submit"
          disabled={status !== 'conectado' || !texto.trim()}
          className="rounded-lg p-2.5 text-white bg-linear-to-r from-blue-900 to-blue-600 hover:opacity-90 transition disabled:opacity-50"
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  )
}

export default Chat