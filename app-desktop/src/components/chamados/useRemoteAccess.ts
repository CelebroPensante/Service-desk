import { useCallback, useEffect, useRef, useState } from 'react'
import { TELEMETRIA_API_URL, TELEMETRIA_WS_URL } from '../../utils/data'

export interface MonitorInfo {
  id: number
  name: string
  x: number
  y: number
  width: number
  height: number
  primary: boolean
}

export interface AgentStatus {
  machineUid: string
  hostname: string
  online: boolean
  hasPassword: boolean
  password?: string
  monitors: MonitorInfo[]
  inSession: boolean
  technicianName?: string
}

export interface RemoteSession {
  id: string
  ticketId: number
  machineUid?: string
  hostname?: string
  ownerId: number
  technicianId: number
  technicianName: string
  technicianConnected: boolean
  ownerConnected: boolean
  sharing: boolean
  controlRequested: boolean
  control: boolean
  agentStreaming?: boolean
  monitors?: MonitorInfo[]
  activeMonitor?: number
  expires: string
}

export interface RemoteEvent {
  sessionId: string
  userId: number
  action: string
  at: string
}

interface WireMessage {
  type: string
  session?: RemoteSession
  sdp?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit
  frame?: string
  width?: number
  height?: number
  monitorId?: number
  monitors?: MonitorInfo[]
  activeMonitor?: number
  error?: string
}

export interface UseRemoteAccessOptions {
  ticketId?: number
  machineUid?: string
  token: string
  owner: boolean
}

export function useRemoteAccess(
  ticketIdOrOpts: number | UseRemoteAccessOptions,
  tokenArg?: string,
  ownerArg?: boolean,
) {
  const opts: UseRemoteAccessOptions =
    typeof ticketIdOrOpts === 'number'
      ? { ticketId: ticketIdOrOpts, token: tokenArg ?? '', owner: ownerArg ?? false }
      : ticketIdOrOpts

  const { ticketId, machineUid, token, owner } = opts
  const isDirectMachine = !!machineUid && !ticketId

  const [session, setSession] = useState<RemoteSession | null>(null)
  const [agentInfo, setAgentInfo] = useState<AgentStatus | null>(null)
  const [error, setError] = useState('')
  const [connected, setConnected] = useState(false)
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null)
  const [agentFrame, setAgentFrame] = useState<{
    dataUrl: string
    width: number
    height: number
    monitorId: number
  } | null>(null)
  const [history, setHistory] = useState<RemoteEvent[]>([])

  const ws = useRef<WebSocket | null>(null)
  const pc = useRef<RTCPeerConnection | null>(null)
  const capture = useRef<MediaStream | null>(null)
  const current = useRef<RemoteSession | null>(null)
  const candidates = useRef<RTCIceCandidateInit[]>([])
  const sharing = useRef(false)

  const headers = useCallback(
    () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
    [token],
  )

  const send = useCallback((message: object) => {
    if (ws.current?.readyState !== WebSocket.OPEN) return false
    if (ws.current.bufferedAmount > 512 * 1024) return false
    ws.current.send(JSON.stringify(message))
    return true
  }, [])

  const clearMedia = useCallback(() => {
    pc.current?.close()
    pc.current = null
    const stream = capture.current
    capture.current = null
    stream?.getTracks().forEach((track) => {
      track.onended = null
      track.stop()
    })
    candidates.current = []
    sharing.current = false
    setVideoStream(null)
    setAgentFrame(null)
  }, [])

  const end = useCallback(() => {
    send({ type: 'end' })
    clearMedia()
    current.current = null
    setSession(null)
    ws.current?.close()
    ws.current = null
    setConnected(false)
  }, [clearMedia, send])

  const getPeer = useCallback(async () => {
    if (pc.current) return pc.current
    const response = await fetch(`${TELEMETRIA_API_URL}/api/remoto/config`, {
      headers: headers(),
    })
    if (!response.ok) throw new Error('Não foi possível carregar a configuração WebRTC')
    const raw: RTCConfiguration = await response.json()
    const config: RTCConfiguration = {
      ...raw,
      iceServers: Array.isArray(raw?.iceServers) ? raw.iceServers : [],
    }
    if (!current.current) throw new Error('Sessão encerrada')
    const peer = new RTCPeerConnection(config)
    pc.current = peer
    peer.onicecandidate = (e) => {
      if (e.candidate) send({ type: 'ice', candidate: e.candidate.toJSON() })
    }
    peer.ontrack = (e) => setVideoStream(e.streams[0] ?? new MediaStream([e.track]))
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
        setError('Conexão WebRTC interrompida. Inicie outra sessão.')
        end()
      }
    }
    return peer
  }, [end, headers, send])

  useEffect(() => {
    let disposed = false
    let socket: WebSocket | null = null
    let polling = false
    let rtcChain = Promise.resolve()

    const baseHttpPath = isDirectMachine
      ? `${TELEMETRIA_API_URL}/api/remoto/maquinas/${encodeURIComponent(machineUid!)}`
      : `${TELEMETRIA_API_URL}/api/remoto/chamados/${ticketId}`

    const baseWsPath = isDirectMachine
      ? `${TELEMETRIA_WS_URL}/api/remoto/maquinas/${encodeURIComponent(machineUid!)}/ws`
      : `${TELEMETRIA_WS_URL}/api/remoto/chamados/${ticketId}/ws`

    async function handleRtcMessage(message: WireMessage) {
      if (disposed) return
      if (message.type === 'offer' && !owner && message.sdp) {
        const peer = await getPeer()
        await peer.setRemoteDescription(message.sdp)
        for (const candidate of candidates.current.splice(0)) {
          await peer.addIceCandidate(candidate)
        }
        await peer.setLocalDescription(await peer.createAnswer())
        send({ type: 'answer', sdp: peer.localDescription })
      } else if (message.type === 'answer' && owner && message.sdp) {
        const peer = pc.current
        if (!peer) return
        await peer.setRemoteDescription(message.sdp)
        for (const candidate of candidates.current.splice(0)) {
          await peer.addIceCandidate(candidate)
        }
      } else if (message.type === 'ice' && message.candidate) {
        if (pc.current?.remoteDescription) await pc.current.addIceCandidate(message.candidate)
        else candidates.current.push(message.candidate)
      }
    }

    function onRawMessage(rawText: string) {
      if (disposed) return
      let message: WireMessage
      try {
        message = JSON.parse(rawText) as WireMessage
      } catch {
        return
      }

      // Fast-path: quadros nativos do Agente Rust são renderizados imediatamente sem fila de Promise
      if (message.type === 'frame' && message.frame) {
        setAgentFrame({
          dataUrl: `data:image/jpeg;base64,${message.frame}`,
          width: message.width || 1280,
          height: message.height || 720,
          monitorId: message.monitorId ?? 0,
        })
        return
      }

      if (message.type === 'state' && message.session) {
        current.current = message.session
        setSession(message.session)
        return
      }
      if (message.type === 'ended') {
        current.current = null
        setSession(null)
        clearMedia()
        return
      }
      if (message.type === 'error') {
        setError(message.error ?? 'Falha no acesso remoto')
        return
      }
      if (
        message.type === 'offer' ||
        message.type === 'answer' ||
        message.type === 'ice'
      ) {
        rtcChain = rtcChain
          .then(() => handleRtcMessage(message))
          .catch((err) => {
            setError(err instanceof Error ? err.message : 'Falha WebRTC')
            end()
          })
      }
    }

    async function poll() {
      if (disposed || polling) return
      polling = true
      try {
        const response = await fetch(baseHttpPath, { headers: headers() })
        if (!response.ok) {
          throw new Error(
            response.status === 503
              ? 'Acesso remoto requer PostgreSQL e a migration 017.'
              : 'Não foi possível consultar a sessão remota',
          )
        }
        const data: { session: RemoteSession | null; agent?: AgentStatus | null } =
          await response.json()
        if (disposed) return
        if (data.agent !== undefined) {
          setAgentInfo(data.agent)
        }
        if (!socket || socket.readyState === WebSocket.CLOSED) {
          current.current = data.session
          setSession(data.session)
          if (data.session) {
            socket = new WebSocket(baseWsPath)
            ws.current = socket
            socket.onopen = () => {
              if (disposed) return
              socket?.send(JSON.stringify({ type: 'auth', token }))
              setConnected(true)
            }
            socket.onmessage = (event) => {
              if (typeof event.data === 'string') {
                onRawMessage(event.data)
              }
            }
            socket.onclose = () => {
              if (disposed) return
              ws.current = null
              setConnected(false)
              current.current = null
              setSession(null)
              clearMedia()
            }
            socket.onerror = () => {
              if (!disposed) setError('Falha na conexão de acesso remoto')
            }
          }
        }
        if (!isDirectMachine && ticketId) {
          const audit = await fetch(
            `${TELEMETRIA_API_URL}/api/remoto/chamados/${ticketId}/historico`,
            { headers: headers() },
          )
          if (audit.ok && !disposed) setHistory((await audit.json()) as RemoteEvent[])
        }
      } catch (err) {
        if (!disposed)
          setError(err instanceof Error ? err.message : 'Servidor remoto indisponível')
      } finally {
        polling = false
      }
    }

    void poll()
    const timer = setInterval(() => {
      void poll()
    }, 2500)
    return () => {
      disposed = true
      clearInterval(timer)
      socket?.close()
      ws.current = null
      current.current = null
      clearMedia()
    }
  }, [ticketId, machineUid, isDirectMachine, token, owner, headers, getPeer, send, end, clearMedia])

  async function requestSession(password?: string, preferredMachineUid?: string) {
    setError('')
    try {
      const targetUrl = isDirectMachine
        ? `${TELEMETRIA_API_URL}/api/remoto/maquinas/${encodeURIComponent(machineUid!)}`
        : `${TELEMETRIA_API_URL}/api/remoto/chamados/${ticketId}`
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          password: password?.trim() || '',
          machineUid: preferredMachineUid || machineUid || '',
        }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(
          body?.erro ||
            (response.status === 409
              ? 'Já existe uma sessão ativa ou o chamado está encerrado'
              : 'Não foi possível iniciar o acesso remoto'),
        )
      }
      const data: { session: RemoteSession } = await response.json()
      current.current = data.session
      setSession(data.session)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao iniciar sessão')
    }
  }

  function authenticateWithPassword(password: string, preferredMachineUid?: string) {
    setError('')
    send({
      type: 'auth_password',
      password: password.trim(),
      machineUid: preferredMachineUid || machineUid || '',
    })
  }

  function selectMonitor(monitorId: number) {
    setError('')
    send({ type: 'select_monitor', monitorId })
  }

  async function updateMachinePassword(targetMachineUid: string, newPassword?: string) {
    setError('')
    const response = await fetch(
      `${TELEMETRIA_API_URL}/api/remoto/maquinas/${encodeURIComponent(targetMachineUid)}/senha`,
      {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify({ password: newPassword?.trim() || '' }),
      },
    )
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      throw new Error(body?.erro ?? 'Não foi possível alterar a senha da máquina')
    }
    const data: { machineUid: string; password: string } = await response.json()
    setAgentInfo((prev) => (prev ? { ...prev, password: data.password, hasPassword: true } : prev))
    return data.password
  }

  async function share() {
    if (sharing.current || !connected) return
    sharing.current = true
    setError('')
    try {
      // Primeiro envia 'share': se o Agente Rust estiver conectado na estação, ele assume captura + controle automaticamente!
      if (!send({ type: 'share', machineUid: machineUid || '' })) {
        throw new Error('Conexão encerrada')
      }
      // Fallback opcional para WebRTC caso queira compartilhar do navegador também
      if (navigator.mediaDevices?.getDisplayMedia) {
        try {
          const stream = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: { ideal: 30, max: 60 } },
            audio: false,
          })
          if (current.current && ws.current?.readyState === WebSocket.OPEN) {
            const videoTrack = stream.getVideoTracks()[0]
            if (videoTrack && 'contentHint' in videoTrack) {
              videoTrack.contentHint = 'motion'
            }
            capture.current = stream
            setVideoStream(stream)
            videoTrack.onended = end
            const peer = await getPeer()
            for (const track of stream.getTracks()) peer.addTrack(track, stream)
            await peer.setLocalDescription(await peer.createOffer())
            send({ type: 'offer', sdp: peer.localDescription })
          } else {
            stream.getTracks().forEach((t) => t.stop())
          }
        } catch {
          // Se o usuário cancelar o popup do navegador mas o Agente Rust estiver transmitindo, mantém a sessão do Agente!
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Compartilhamento cancelado')
      end()
    } finally {
      sharing.current = false
    }
  }

  return {
    session,
    agentInfo,
    error,
    connected,
    videoStream,
    agentFrame,
    history,
    send,
    end,
    share,
    requestSession,
    authenticateWithPassword,
    selectMonitor,
    updateMachinePassword,
  }
}
