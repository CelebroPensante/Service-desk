import { useCallback, useEffect, useRef, useState } from 'react'
import { TELEMETRIA_API_URL, TELEMETRIA_WS_URL } from '../../utils/data'

export interface RemoteSession {
  id: string; ticketId: number; ownerId: number; technicianId: number; technicianName: string
  technicianConnected: boolean; ownerConnected: boolean
  sharing: boolean; controlRequested: boolean; control: boolean; expires: string
}
export interface RemoteEvent { sessionId: string; userId: number; action: string; at: string }
interface WireMessage {
  type: string; session?: RemoteSession; sdp?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit; error?: string
}
export function useRemoteAccess(ticketId: number, token: string, owner: boolean) {
  const [session, setSession] = useState<RemoteSession | null>(null)
  const [error, setError] = useState('')
  const [connected, setConnected] = useState(false)
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null)
  const [history, setHistory] = useState<RemoteEvent[]>([])
  const ws = useRef<WebSocket | null>(null)
  const pc = useRef<RTCPeerConnection | null>(null)
  const capture = useRef<MediaStream | null>(null)
  const current = useRef<RemoteSession | null>(null)
  const candidates = useRef<RTCIceCandidateInit[]>([])
  const sharing = useRef(false)
  const headers = useCallback(() => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }), [token])
  const send = useCallback((message: object) => {
    if (ws.current?.readyState !== WebSocket.OPEN) return false
    // Do not build an unbounded input backlog on slow connections.
    if (ws.current.bufferedAmount > 65536) { ws.current.close(); return false }
    ws.current.send(JSON.stringify(message)); return true
  }, [])
  const clearMedia = useCallback(() => {
    pc.current?.close(); pc.current = null
    const stream = capture.current; capture.current = null
    stream?.getTracks().forEach(track => { track.onended = null; track.stop() })
    candidates.current = []; sharing.current = false; setVideoStream(null)
  }, [])
  const end = useCallback(() => {
    send({ type: 'end' }); clearMedia()
    current.current = null; setSession(null)
    ws.current?.close(); ws.current = null; setConnected(false)
  }, [clearMedia, send])
  const getPeer = useCallback(async () => {
    if (pc.current) return pc.current
    const response = await fetch(`${TELEMETRIA_API_URL}/api/remoto/config`, { headers: headers() })
    if (!response.ok) throw new Error('Não foi possível carregar a configuração WebRTC')
    const config: RTCConfiguration = await response.json()
    if (!current.current) throw new Error('Sessão encerrada')
    const peer = new RTCPeerConnection(config); pc.current = peer
    peer.onicecandidate = e => { if (e.candidate) send({ type: 'ice', candidate: e.candidate.toJSON() }) }
    peer.ontrack = e => setVideoStream(e.streams[0] ?? new MediaStream([e.track]))
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
        setError('Conexão WebRTC interrompida. Inicie outra sessão.'); end()
      }
    }
    return peer
  }, [end, headers, send])
  useEffect(() => {
    let disposed = false
    let socket: WebSocket | null = null
    let polling = false
    let messages = Promise.resolve()
    async function onMessage(message: WireMessage) {
      if (disposed) return
      if (message.type === 'state' && message.session) {
        current.current = message.session; setSession(message.session)
      } else if (message.type === 'ended') {
        current.current = null; setSession(null); clearMedia()
      } else if (message.type === 'error') {
        setError(message.error ?? 'Falha no acesso remoto')
      } else if (message.type === 'offer' && !owner && message.sdp) {
        const peer = await getPeer()
        await peer.setRemoteDescription(message.sdp)
        for (const candidate of candidates.current.splice(0)) await peer.addIceCandidate(candidate)
        await peer.setLocalDescription(await peer.createAnswer())
        send({ type: 'answer', sdp: peer.localDescription })
      } else if (message.type === 'answer' && owner && message.sdp) {
        const peer = pc.current
        if (!peer) return
        await peer.setRemoteDescription(message.sdp)
        for (const candidate of candidates.current.splice(0)) await peer.addIceCandidate(candidate)
      } else if (message.type === 'ice' && message.candidate) {
        if (pc.current?.remoteDescription) await pc.current.addIceCandidate(message.candidate)
        else candidates.current.push(message.candidate)
      }
    }
    async function poll() {
      if (disposed || polling) return
      polling = true
      try {
        const response = await fetch(`${TELEMETRIA_API_URL}/api/remoto/chamados/${ticketId}`, { headers: headers() })
        if (!response.ok) throw new Error(response.status === 503 ? 'Acesso remoto requer PostgreSQL e a migration 017.' : 'Não foi possível consultar a sessão remota')
        const data: { session: RemoteSession | null } = await response.json()
        if (disposed) return
        if (!socket || socket.readyState === WebSocket.CLOSED) {
          current.current = data.session; setSession(data.session)
          if (data.session) {
            socket = new WebSocket(`${TELEMETRIA_WS_URL}/api/remoto/chamados/${ticketId}/ws`)
            ws.current = socket
            socket.onopen = () => { if (disposed) return; socket?.send(JSON.stringify({ type: 'auth', token })); setConnected(true) }
            socket.onmessage = event => {
              messages = messages.then(() => onMessage(JSON.parse(event.data) as WireMessage))
                .catch(err => { setError(err instanceof Error ? err.message : 'Falha WebRTC'); end() })
            }
            socket.onclose = () => {
              if (disposed) return
              ws.current = null; setConnected(false); current.current = null; setSession(null); clearMedia()
            }
            socket.onerror = () => { if (!disposed) setError('Falha na conexão de acesso remoto') }
          }
        }
        const audit = await fetch(`${TELEMETRIA_API_URL}/api/remoto/chamados/${ticketId}/historico`, { headers: headers() })
        if (audit.ok && !disposed) setHistory(await audit.json() as RemoteEvent[])
      } catch (err) { if (!disposed) setError(err instanceof Error ? err.message : 'Servidor remoto indisponível') }
      finally { polling = false }
    }
    void poll(); const timer = setInterval(() => { void poll() }, 3000)
    return () => { disposed = true; clearInterval(timer); socket?.close(); ws.current = null; current.current = null; clearMedia() }
  }, [ticketId, token, owner, headers, getPeer, send, end, clearMedia])
  async function requestSession() {
    setError('')
    try {
      const response = await fetch(`${TELEMETRIA_API_URL}/api/remoto/chamados/${ticketId}`, { method: 'POST', headers: headers() })
      if (!response.ok) throw new Error(response.status === 409 ? 'Já existe uma sessão ou o chamado está encerrado' : 'Não foi possível solicitar o acesso remoto')
      const data: { session: RemoteSession } = await response.json(); current.current = data.session; setSession(data.session)
    } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao solicitar sessão') }
  }
  async function share() {
    if (sharing.current || !connected) return
    sharing.current = true; setError('')
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Para compartilhar, abra o ServiceDesk no navegador com HTTPS ou localhost. O WebView do Tauri pode não oferecer captura de tela.')
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false })
      if (!current.current || ws.current?.readyState !== WebSocket.OPEN) { stream.getTracks().forEach(t => t.stop()); throw new Error('Sessão encerrada durante a escolha da tela') }
      capture.current = stream; setVideoStream(stream)
      stream.getVideoTracks()[0].onended = end
      if (!send({ type: 'share' })) throw new Error('Conexão encerrada')
      const peer = await getPeer()
      for (const track of stream.getTracks()) peer.addTrack(track, stream)
      await peer.setLocalDescription(await peer.createOffer()); send({ type: 'offer', sdp: peer.localDescription })
    } catch (err) { setError(err instanceof Error ? err.message : 'Compartilhamento cancelado'); end() }
  }
  function allowControl(pairCode: string) {
    if (capture.current?.getVideoTracks()[0]?.getSettings().displaySurface !== 'monitor') {
      setError('Para controlar, encerre esta sessão e compartilhe a tela inteira do monitor principal.'); return
    }
    setError(''); send({ type: 'allow_control', pairCode: pairCode.trim() })
  }
  return { session, error, connected, videoStream, history, send, end, share, allowControl, requestSession }
}
