import { useEffect, useRef, useState } from 'react'
import {
  Activity,
  Maximize2,
  Minimize2,
  Monitor,
  MousePointerClick,
  ShieldAlert,
  Timer,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type { Chamado } from '../../types'
import { remoteKey, videoPoint } from './remoteInput'
import { useRemoteAccess } from './useRemoteAccess'

export interface AcessoRemotoProps {
  chamado?: Chamado
  machineUid?: string
  hostname?: string
  token: string
  userId: number
  level: number
  isPopout?: boolean
  onClose?: () => void
}

const btnClass =
  'inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 transition hover:bg-slate-50 disabled:opacity-50'
const btnPrimaryClass =
  'inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50'

const actions: Record<string, string> = {
  requested: 'Acesso solicitado',
  screen_allowed: 'Tela autorizada',
  control_requested: 'Controle solicitado',
  control_allowed: 'Controle ativo (Tela + Mouse/Teclado)',
  control_revoked: 'Controle revogado',
  agent_disconnected: 'Agente desconectado',
  ended: 'Sessão encerrada',
}

const ZOOM_LEVELS = [100, 125, 150, 200] as const

export default function AcessoRemoto({
  chamado,
  machineUid,
  hostname,
  token,
  userId,
  level,
  isPopout = false,
  onClose,
}: AcessoRemotoProps) {
  const closed =
    chamado != null &&
    (!!chamado.dataResolucao ||
      ['resolvido', 'fechado', 'finalizado', 'cancelado'].includes(
        chamado.status?.toLowerCase() ?? '',
      ))
  const owner = chamado != null ? chamado.idUsuario === userId : false

  const remote = useRemoteAccess({
    ticketId: chamado?.id,
    machineUid,
    token,
    owner,
  })
  const {
    session,
    agentInfo,
    videoStream,
    hasAgentStream,
    frameImgRef,
    frameMetaRef,
    send,
  } = remote

  const viewerContainerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const keys = useRef(new Map<string, string>())
  const lastMove = useRef(0)

  // Estados de visualização (Zoom, Modo Expandido, Tela Cheia e Foco Exclusivo)
  const [zoom, setZoom] = useState<number>(100)
  const [expanded, setExpanded] = useState<boolean>(isPopout)
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false)
  const [isFocused, setIsFocused] = useState<boolean>(false)

  const canControl = !owner && (!!session?.control || !!session?.agentStreaming)
  const hasVisualStream = hasAgentStream || !!videoStream
  const monitors = session?.monitors?.length
    ? session.monitors
    : agentInfo?.monitors ?? []
  const activeMonitor =
    session?.activeMonitor ?? frameMetaRef.current.monitorId ?? 0

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = videoStream
  }, [videoStream])

  useEffect(() => {
    if (!canControl) {
      keys.current.clear()
      setIsFocused(false)
    }
  }, [canControl])

  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(!!document.fullscreenElement)
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  // Bloqueio nativo ({ passive: false }) de scroll da página quando o foco está na tela remota
  useEffect(() => {
    const container = viewerContainerRef.current
    if (!container) return

    function handleNativeWheel(e: WheelEvent) {
      if (!canControl || !isFocused) return
      e.preventDefault()
      e.stopPropagation()
      const delta =
        Math.sign(e.deltaY) *
        Math.min(10, Math.max(1, Math.ceil(Math.abs(e.deltaY) / 100)))
      if (delta !== 0) {
        send({ type: 'input', input: { kind: 'scroll', delta } })
      }
    }

    container.addEventListener('wheel', handleNativeWheel, { passive: false })
    return () => {
      container.removeEventListener('wheel', handleNativeWheel)
    }
  }, [canControl, isFocused, send])

  useEffect(() => {
    function handleOutsidePointerDown(e: MouseEvent) {
      if (
        isFocused &&
        viewerContainerRef.current &&
        !viewerContainerRef.current.contains(e.target as Node)
      ) {
        releaseAllInputs()
        setIsFocused(false)
      }
    }
    document.addEventListener('mousedown', handleOutsidePointerDown)
    return () => document.removeEventListener('mousedown', handleOutsidePointerDown)
  })

  function releaseAllInputs() {
    for (const key of keys.current.values()) {
      send({ type: 'input', input: { kind: 'key', key, down: false } })
    }
    keys.current.clear()
    if (canControl) {
      for (let i = 0; i < 3; i++) {
        send({ type: 'input', input: { kind: 'button', button: i, down: false } })
      }
    }
  }

  function getActiveSurfaceMetrics(): {
    rect: DOMRect
    width: number
    height: number
  } | null {
    if (hasAgentStream && frameImgRef.current) {
      return {
        rect: frameImgRef.current.getBoundingClientRect(),
        width:
          frameMetaRef.current.width || frameImgRef.current.naturalWidth || 1920,
        height:
          frameMetaRef.current.height ||
          frameImgRef.current.naturalHeight ||
          1080,
      }
    }
    if (videoRef.current && videoRef.current.videoWidth > 0) {
      return {
        rect: videoRef.current.getBoundingClientRect(),
        width: videoRef.current.videoWidth,
        height: videoRef.current.videoHeight,
      }
    }
    return null
  }

  function movePointer(clientX: number, clientY: number, force = false): boolean {
    if (!canControl) return false
    const now = performance.now()
    if (!force && now - lastMove.current < 8) return false
    const metrics = getActiveSurfaceMetrics()
    if (!metrics) return false
    const point = videoPoint(
      clientX,
      clientY,
      metrics.rect,
      metrics.width,
      metrics.height,
    )
    if (!point) return false
    send({ type: 'input', input: { kind: 'move', ...point } })
    lastMove.current = now
    return true
  }

  async function toggleFullscreen() {
    const el = viewerContainerRef.current
    if (!el) return
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen()
      } else {
        await document.exitFullscreen()
      }
    } catch {
      setExpanded((prev) => !prev)
    }
  }

  return (
    <section
      className={`${
        isPopout
          ? 'flex min-h-screen flex-col bg-slate-950 p-4 text-white'
          : expanded
            ? 'fixed inset-3 z-50 flex flex-col overflow-auto rounded-2xl border border-slate-300 bg-white p-5 shadow-2xl'
            : 'mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm'
      }`}
      aria-label="Acesso remoto"
    >
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <Monitor size={18} />
          </div>
          <div>
            <h2
              className={`font-semibold ${
                isPopout ? 'text-white' : 'text-slate-900'
              }`}
            >
              Acesso Remoto{' '}
              {(hostname || session?.hostname || agentInfo?.hostname) &&
                `• ${hostname || session?.hostname || agentInfo?.hostname}`}
            </h2>
            <p
              className={`text-xs ${
                isPopout ? 'text-slate-300' : 'text-slate-500'
              }`}
            >
              Compartilhamento de tela e controle de mouse/teclado mediante autorização do usuário.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!session && !owner && level >= 2 && !closed && (
            <button
              type="button"
              className={btnPrimaryClass}
              onClick={() => void remote.requestSession()}
            >
              Solicitar Acesso Remoto
            </button>
          )}
          
          {session && (
            <button
              type="button"
              className={`${btnClass} border-red-200 text-red-700 hover:bg-red-50`}
              onClick={remote.end}
            >
              Encerrar Sessão
            </button>
          )}
          {onClose && (
            <button type="button" className={btnClass} onClick={onClose}>
              Fechar Painel
            </button>
          )}
        </div>
      </div>

      {remote.error && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700"
        >
          {remote.error}
        </p>
      )}

      {!session && owner && (
        <p className="mt-3 text-xs text-slate-500">
          As solicitações de acesso remoto do técnico aparecerão aqui e como notificação no topo da tela.
        </p>
      )}

      {/* Status da Sessão Ativa */}
      {session && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-xs text-blue-950">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="font-medium">
                {session.control || session.agentStreaming
                  ? `Acesso remoto autorizado e em andamento — Técnico: ${session.technicianName}`
                  : session.sharing
                    ? 'Tela compartilhada ativa.'
                    : `Solicitação enviada pelo técnico ${session.technicianName}. Aguardando autorização do usuário na máquina…`}
              </span>
            </div>
            {owner && (
              <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                <ShieldAlert size={12} /> Sua máquina está sendo acessada
              </span>
            )}
          </div>

          {owner && !session.sharing && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3.5 text-slate-900">
              <p className="text-xs font-medium">
                O técnico <strong>{session.technicianName}</strong> solicitou acesso remoto. Ao autorizar, a visualização da tela e o controle de mouse/teclado serão habilitados automaticamente.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700"
                  onClick={() => void remote.share()}
                >
                  Autorizar Acesso Remoto
                </button>
                <button
                  type="button"
                  className={btnClass}
                  onClick={() => void remote.denySession()}
                >
                  Recusar
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Visor de Acesso Remoto + Barra de Ferramentas */}
      <div
        ref={viewerContainerRef}
        className={`mt-4 flex flex-col rounded-xl border bg-slate-950 ${
          hasVisualStream ? '' : 'hidden'
        } ${
          isFocused
            ? 'border-blue-500 ring-2 ring-blue-500/40'
            : 'border-slate-800'
        } ${isFullscreen || isPopout ? 'flex-1' : ''}`}
      >
        {/* Barra de Ferramentas do Visor (Monitores, Foco, Zoom, Modo Expandido, Tela Cheia, Pop-out) */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-200 rounded-t-xl">
          {/* Seletor de Monitores em Tempo Real */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium text-slate-400 mr-1">
              Monitores:
            </span>
            {monitors.length > 0 ? (
              monitors.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => remote.selectMonitor(m.id)}
                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                    activeMonitor === m.id
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  <Monitor size={12} />
                  {m.name || `Monitor ${m.id + 1} (${m.width}x${m.height})`}
                </button>
              ))
            ) : (
              <span className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2.5 py-1 text-[11px] text-slate-300">
                <Monitor size={12} /> Monitor Principal
              </span>
            )}
          </div>

          {/* Métricas da transmissão: FPS e latência */}
          <div
            className="flex items-center gap-1.5"
            title="FPS = quadros recebidos por segundo. Latência = tempo de ida e volta técnico ↔ servidor ↔ agente."
          >
            <span
              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
                remote.stats.fps >= 20
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : remote.stats.fps >= 10
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'bg-red-500/20 text-red-300'
              }`}
            >
              <Activity size={12} /> {remote.stats.fps} FPS
            </span>
            {!owner && (
              <span
                className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
                  remote.stats.latency === null
                    ? 'bg-slate-800 text-slate-400'
                    : remote.stats.latency <= 60
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : remote.stats.latency <= 150
                        ? 'bg-amber-500/20 text-amber-300'
                        : 'bg-red-500/20 text-red-300'
                }`}
              >
                <Timer size={12} />{' '}
                {remote.stats.latency === null ? '-- ms' : `${remote.stats.latency} ms`}
              </span>
            )}
          </div>

          {/* Indicador de Foco Capturado */}
          {canControl && (
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                  isFocused
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                <MousePointerClick size={12} />
                {isFocused
                  ? 'Foco exclusivo no Acesso Remoto (Scroll/Teclado travados aqui)'
                  : 'Clique na imagem para capturar o foco'}
              </span>
              {isFocused && (
                <button
                  type="button"
                  onClick={() => {
                    releaseAllInputs()
                    setIsFocused(false)
                  }}
                  className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-slate-700"
                >
                  Soltar Foco (Ctrl+Alt+Esc)
                </button>
              )}
            </div>
          )}

          {/* Controles de Zoom, Expandir, Tela Cheia e Janela Separada */}
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex items-center rounded-md bg-slate-800 p-0.5">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(100, z - 25))}
                disabled={zoom <= 100}
                className="rounded px-1.5 py-1 text-slate-300 hover:bg-slate-700 disabled:opacity-40"
                title="Diminuir Zoom"
              >
                <ZoomOut size={13} />
              </button>
              {ZOOM_LEVELS.map((z) => (
                <button
                  key={z}
                  type="button"
                  onClick={() => setZoom(z)}
                  className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                    zoom === z
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {z}%
                </button>
              ))}
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(200, z + 25))}
                disabled={zoom >= 200}
                className="rounded px-1.5 py-1 text-slate-300 hover:bg-slate-700 disabled:opacity-40"
                title="Aumentar Zoom"
              >
                <ZoomIn size={13} />
              </button>
            </div>

            {!isPopout && !isFullscreen && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700"
                title="Expandir ou recolher o tamanho do visor na tela"
              >
                {expanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                {expanded ? 'Modo Normal' : 'Expandir Visor'}
              </button>
            )}

            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700"
              title="Alternar Tela Cheia"
            >
              <Maximize2 size={12} />
              {isFullscreen ? 'Sair da Tela Cheia' : 'Tela Cheia'}
            </button>

          </div>
        </div>

        {/* Área do Visor Interativo */}
        <div
          tabIndex={canControl ? 0 : -1}
          role="application"
          aria-label={
            owner
              ? 'Prévia da tela compartilhada'
              : 'Tela remota; clique para controlar mouse, scroll e teclado'
          }
          className={`relative flex items-center justify-center overflow-auto bg-slate-950 outline-none select-none ${
            isFullscreen
              ? 'h-[calc(100vh-44px)]'
              : isPopout
                ? 'flex-1 h-[calc(100vh-140px)]'
                : expanded
                  ? 'h-[calc(100vh-160px)]'
                  : 'max-h-[78vh] min-h-[420px]'
          } ${canControl ? 'cursor-crosshair' : ''}`}
          onPointerMove={(e) => {
            if (isFocused) movePointer(e.clientX, e.clientY)
          }}
          onPointerDown={(e) => {
            if (!canControl || e.button > 2) return
            e.preventDefault()
            e.currentTarget.focus()
            setIsFocused(true)
            if (!movePointer(e.clientX, e.clientY, true)) return
            e.currentTarget.setPointerCapture(e.pointerId)
            send({
              type: 'input',
              input: { kind: 'button', button: e.button, down: true },
            })
          }}
          onPointerUp={(e) => {
            if (canControl && e.button <= 2 && isFocused) {
              movePointer(e.clientX, e.clientY, true)
              send({
                type: 'input',
                input: { kind: 'button', button: e.button, down: false },
              })
            }
          }}
          onPointerCancel={releaseAllInputs}
          onBlur={() => {
            releaseAllInputs()
            setIsFocused(false)
          }}
          onContextMenu={(e) => {
            if (canControl) e.preventDefault()
          }}
          onKeyDown={(e) => {
            if (!canControl || !isFocused) return
            if (e.key === 'Escape' && (e.ctrlKey || e.altKey)) {
              e.preventDefault()
              releaseAllInputs()
              setIsFocused(false)
              return
            }
            const key = remoteKey(e.code, e.key)
            if (!key) return
            e.preventDefault()
            e.stopPropagation()
            keys.current.set(e.code, key)
            send({ type: 'input', input: { kind: 'key', key, down: true } })
          }}
          onKeyUp={(e) => {
            if (!canControl || !isFocused) return
            const key = keys.current.get(e.code)
            if (!key) return
            e.preventDefault()
            e.stopPropagation()
            keys.current.delete(e.code)
            send({ type: 'input', input: { kind: 'key', key, down: false } })
          }}
        >
          {/* Stream Binário de Baixa Latência do Agente Rust (Zero Re-renders por Frame) */}
          <img
            ref={frameImgRef}
            alt="Tela remota da estação"
            draggable={false}
            style={{
              width: zoom === 100 ? '100%' : `${zoom}%`,
              maxWidth: zoom === 100 ? '100%' : 'none',
              maxHeight: zoom === 100 ? '100%' : 'none',
            }}
            className={`object-contain select-none pointer-events-none ${
              hasAgentStream ? '' : 'hidden'
            }`}
          />

          {/* Fallback WebRTC quando não há quadro nativo do Agente */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{
              width: zoom === 100 ? '100%' : `${zoom}%`,
              maxWidth: zoom === 100 ? '100%' : 'none',
              maxHeight: zoom === 100 ? '100%' : 'none',
            }}
            className={`object-contain select-none pointer-events-none ${
              !hasAgentStream && videoStream ? '' : 'hidden'
            }`}
          />
        </div>
      </div>

      {remote.history.length > 0 && !isPopout && (
        <details className="mt-4 text-xs text-slate-600">
          <summary className="cursor-pointer font-medium">
            Histórico de Auditoria de Acesso Remoto ({remote.history.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {remote.history.map((event, i) => (
              <li key={`${event.at}-${i}`}>
                {new Date(event.at).toLocaleString('pt-BR')} —{' '}
                {actions[event.action] ?? event.action}
                {event.userId > 0 ? ` (usuário #${event.userId})` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
