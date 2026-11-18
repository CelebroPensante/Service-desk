import { useEffect, useRef } from 'react'
import { API_URL } from '../../utils/data'

// "resync": eventos podem ter sido perdidos (reconexão ou cliente lento); recarregue tudo.
export interface EventoChamado {
  tipo: 'criado' | 'atualizado' | 'excluido' | 'resync'
  idChamado?: number
}

// Assina o SSE de chamados da API. O EventSource não envia header Authorization,
// então o token vai na query string (mesmo padrão do WebSocket do chat).
export function useEventosChamados(token: string, onEvento: (evento: EventoChamado) => void) {
  const callback = useRef(onEvento)
  useEffect(() => { callback.current = onEvento })

  useEffect(() => {
    if (!token) return
    const fonte = new EventSource(`${API_URL}/api/chamados/eventos?token=${encodeURIComponent(token)}`)
    let jaConectou = false
    fonte.onopen = () => {
      // O EventSource reconecta sozinho após uma queda; o que mudou nesse meio-tempo se perdeu.
      if (jaConectou) callback.current({ tipo: 'resync' })
      jaConectou = true
    }
    fonte.addEventListener('chamado', (e) => {
      try {
        callback.current(JSON.parse((e as MessageEvent<string>).data) as EventoChamado)
      } catch {
        callback.current({ tipo: 'resync' })
      }
    })
    fonte.addEventListener('resync', () => callback.current({ tipo: 'resync' }))
    return () => fonte.close()
  }, [token])
}
