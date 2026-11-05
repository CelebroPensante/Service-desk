import { useEffect, useRef, useState } from 'react'
import {
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Lock,
  Maximize2,
  Minimize2,
  Monitor,
  MousePointerClick,
  RefreshCw,
  ShieldAlert,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type { Chamado } from '../../types'
import { TELEMETRIA_API_URL } from '../../utils/data'
import { remoteKey, videoPoint } from './remoteInput'
import { useRemoteAccess, type AgentStatus } from './useRemoteAccess'

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
  const isAdmin = level >= 3

  const remote = useRemoteAccess({
    ticketId: chamado?.id,
    machineUid,
    token,
    owner,
  })
  const { session, agentInfo, videoStream, agentFrame, send } = remote

  const viewerContainerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const keys = useRef(new Map<string, string>())
  const lastMove = useRef(0)

  const [passwordInput, setPasswordInput] = useState('')
  const [newAdminPassword, setNewAdminPassword] = useState('')
  const [showPasswordManager, setShowPasswordManager] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordFeedback, setPasswordFeedback] = useState('')
  const [copiedPass, setCopiedPass] = useState(false)

  // Estados de visualização (Zoom, Modo Expandido, Tela Cheia e Foco Exclusivo)
  const [zoom, setZoom] = useState<number>(100)
  const [expanded, setExpanded] = useState<boolean>(isPopout)
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false)
  const [isFocused, setIsFocused] = useState<boolean>(false)

  // Lista de agentes disponíveis quando acessado de dentro de um chamado
  const [availableAgents, setAvailableAgents] = useState<AgentStatus[]>([])
  const [selectedAgentUid, setSelectedAgentUid] = useState<string>(machineUid ?? '')

  const canControl = !owner && (!!session?.control || !!session?.agentStreaming)
  const hasVisualStream = !!agentFrame || !!videoStream
  const monitors = session?.monitors?.length
    ? session.monitors
    : agentInfo?.monitors ?? []
  const activeMonitor = session?.activeMonitor ?? agentFrame?.monitorId ?? 0

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = videoStream
  }, [videoStream])

  useEffect(() => {
    if (!canControl) {
      keys.current.clear()
      setIsFocused(false)
    }
  }, [canControl])

  // Carrega agentes conectados para permitir conexão por senha ou gerenciamento de senha ADM
  useEffect(() => {
    if (owner || level < 2) return
    let active = true
    async function loadAgents() {
      try {
        const res = await fetch(`${TELEMETRIA_API_URL}/api/remoto/maquinas`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.ok && active) {
          const list = (await res.json()) as AgentStatus[]
          setAvailableAgents(list)
          if (!selectedAgentUid && list.length > 0) {
            setSelectedAgentUid(list[0].machineUid)
          }
        }
      } catch {
        // Ignorado se offline
      }
    }
    void loadAgents()
    const timer = setInterval(() => void loadAgents(), 5000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [owner, level, token, selectedAgentUid])

  const targetAgent =
    agentInfo ??
    availableAgents.find((a) => a.machineUid === (machineUid || selectedAgentUid)) ??
    availableAgents[0] ??
    null

  // Preenche automaticamente a senha para ADM se estiver disponível e o campo estiver vazio
  useEffect(() => {
    if (isAdmin && targetAgent?.password && !passwordInput) {
      setPasswordInput(targetAgent.password)
    }
  }, [isAdmin, targetAgent?.password, passwordInput])

  // Listener de mudança de Fullscreen
  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(!!document.fullscreenElement)
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  // Ponto 5: Bloqueio NATIVO ({ passive: false }) de scroll da página quando o foco está na tela remota!
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

  // Libera o foco ao clicar fora da tela de acesso remoto
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
    if (agentFrame && imgRef.current) {
      return {
        rect: imgRef.current.getBoundingClientRect(),
        width: agentFrame.width,
        height: agentFrame.height,
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

  // Ponto 8: Movimento de mouse em 120 Hz (8ms) para máxima fluidez com o Agente Rust
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

  function openPopoutWindow() {
    const url = new URL(window.location.href)
    url.searchParams.set('popout_remoto', '1')
    if (machineUid || session?.machineUid) {
      url.searchParams.set('machine_uid', machineUid || session?.machineUid || '')
      url.searchParams.set('hostname', hostname || session?.hostname || '')
    } else if (chamado?.id) {
      url.searchParams.set('ticket_id', String(chamado.id))
    }
    window.open(
      url.toString(),
      `remoto_${machineUid ?? chamado?.id ?? 'win'}`,
      'width=1360,height=840,menubar=no,toolbar=no,location=no,status=no,resizable=yes',
    )
  }

  async function handleSaveAdminPassword(generateRandom: boolean) {
    const uid = machineUid || selectedAgentUid || targetAgent?.machineUid
    if (!uid) return
    setSavingPassword(true)
    setPasswordFeedback('')
    try {
      const updated = await remote.updateMachinePassword(
        uid,
        generateRandom ? '' : newAdminPassword,
      )
      setPasswordInput(updated)
      setNewAdminPassword('')
      setPasswordFeedback(
        `Senha atualizada no Registro do Windows (HKCU\\Software\\ServiceDesk\\Agent): ${updated}`,
      )
      setAvailableAgents((prev) =>
        prev.map((a) => (a.machineUid === uid ? { ...a, password: updated } : a)),
      )
    } catch (err) {
      setPasswordFeedback(
        err instanceof Error ? err.message : 'Erro ao salvar senha',
      )
    } finally {
      setSavingPassword(false)
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
              {(hostname || session?.hostname || targetAgent?.hostname) &&
                `• ${hostname || session?.hostname || targetAgent?.hostname}`}
            </h2>
            <p
              className={`text-xs ${
                isPopout ? 'text-slate-300' : 'text-slate-500'
              }`}
            >
              Controle unificado de tela, mouse e teclado em baixa latência via Agente Rust.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && targetAgent && (
            <button
              type="button"
              className={btnClass}
              onClick={() => setShowPasswordManager((v) => !v)}
            >
              <KeyRound size={14} className="text-amber-600" />
              Gerenciar Senha no Registro (ADM)
            </button>
          )}
          {session && !isPopout && (
            <button
              type="button"
              className={btnClass}
              onClick={openPopoutWindow}
              title="Abrir o acesso remoto em uma janela independente"
            >
              <ExternalLink size={14} />
              Janela Separada
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

      {/* Painel ADM de Gerenciamento da Senha no Registro do Windows (Ponto 3) */}
      {isAdmin && showPasswordManager && targetAgent && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-amber-900">
                Configuração de Senha da Máquina (Editor de Registro do Windows)
              </h3>
              <p className="mt-0.5 text-xs text-amber-800">
                Chave persistida no Agente:{' '}
                <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[11px]">
                  HKEY_CURRENT_USER\Software\ServiceDesk\Agent\RemotePassword
                </code>
              </p>
            </div>
            {targetAgent.password && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-1.5">
                <span className="text-xs text-slate-500">Senha Atual:</span>
                <span className="font-mono text-sm font-bold text-slate-900">
                  {targetAgent.password}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(targetAgent.password ?? '')
                    setCopiedPass(true)
                    setTimeout(() => setCopiedPass(false), 2000)
                  }}
                  className="text-slate-500 hover:text-slate-800"
                  title="Copiar senha"
                >
                  {copiedPass ? (
                    <Check size={14} className="text-emerald-600" />
                  ) : (
                    <Copy size={14} />
                  )}
                </button>
              </div>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={newAdminPassword}
              onChange={(e) => setNewAdminPassword(e.target.value)}
              placeholder="Nova senha personalizada (mín. 4 caracteres)"
              className="w-72 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs text-slate-900"
            />
            <button
              type="button"
              disabled={savingPassword || newAdminPassword.trim().length < 4}
              onClick={() => void handleSaveAdminPassword(false)}
              className={btnPrimaryClass}
            >
              Salvar Nova Senha no Registro
            </button>
            <button
              type="button"
              disabled={savingPassword}
              onClick={() => void handleSaveAdminPassword(true)}
              className={btnClass}
            >
              <RefreshCw size={13} />
              Gerar Senha Aleatória
            </button>
          </div>
          {passwordFeedback && (
            <p className="mt-2 text-xs font-medium text-emerald-800">
              {passwordFeedback}
            </p>
          )}
        </div>
      )}

      {remote.error && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700"
        >
          {remote.error}
        </p>
      )}

      {/* Abertura de Sessão pelo Técnico (Via Senha Direta sem depender do usuário OU Solicitação) */}
      {!session && !owner && level >= 2 && !closed && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-slate-800">
          <div className="flex flex-wrap items-end gap-3">
            {!machineUid && availableAgents.length > 1 && (
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  Estação Alvo
                </label>
                <select
                  value={selectedAgentUid}
                  onChange={(e) => setSelectedAgentUid(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900"
                >
                  {availableAgents.map((a) => (
                    <option key={a.machineUid} value={a.machineUid}>
                      {a.hostname} ({a.machineUid})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex-1 min-w-[220px]">
              <label
                htmlFor="remote-machine-pass"
                className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-700"
              >
                <Lock size={12} className="text-blue-600" />
                Senha de Acesso da Máquina (acesso imediato sem aguardar usuário)
              </label>
              <input
                id="remote-machine-pass"
                type="text"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="Digite a senha gerada pelo agente (ex: A7K9M2P4)"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900"
              />
            </div>

            <button
              type="button"
              disabled={!passwordInput.trim()}
              onClick={() =>
                void remote.requestSession(
                  passwordInput,
                  machineUid || selectedAgentUid,
                )
              }
              className={btnPrimaryClass}
            >
              <KeyRound size={14} />
              Conectar Agora com Senha
            </button>

            {chamado && (
              <button
                type="button"
                onClick={() => void remote.requestSession()}
                className={btnClass}
              >
                Solicitar Permissão ao Usuário
              </button>
            )}
          </div>
          {targetAgent ? (
            <p className="mt-2 text-[11px] text-emerald-700">
              ● Agente Rust online em <strong>{targetAgent.hostname}</strong> (
              {targetAgent.monitors?.length || 1} monitor(es) detectado(s)).
            </p>
          ) : (
            <p className="mt-2 text-[11px] text-slate-500">
              Aguardando conexão do Agente Rust da estação ou inicie via solicitação ao usuário.
            </p>
          )}
        </div>
      )}

      {!session && owner && (
        <p className="mt-3 text-xs text-slate-500">
          Caso um técnico inicie o atendimento remoto nesta máquina, você receberá uma notificação imediatamente.
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
                  ? `Acesso remoto completo ativo (Tela + Mouse e Teclado liberados) — Técnico: ${session.technicianName}`
                  : session.sharing
                    ? 'Tela compartilhada ativa.'
                    : `Técnico ${session.technicianName} solicitou acesso remoto.`}
              </span>
            </div>
            {owner && (
              <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                <ShieldAlert size={12} /> Sua máquina está sendo acessada
              </span>
            )}
          </div>

          {/* Se a sessão foi criada sem senha no chamado, o técnico ainda pode inserir a senha para entrar direto OU o usuário autorizar com 1 clique (sem etapa separada de mouse/teclado!) */}
          {!session.sharing && !owner && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <input
                type="text"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="Senha da máquina para conectar sem aguardar"
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs text-slate-900"
              />
              <button
                type="button"
                disabled={!passwordInput.trim()}
                onClick={() =>
                  remote.authenticateWithPassword(
                    passwordInput,
                    machineUid || selectedAgentUid,
                  )
                }
                className={btnPrimaryClass}
              >
                Autenticar com Senha
              </button>
            </div>
          )}

          {owner && !session.sharing && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3.5 text-slate-900">
              <p className="text-xs font-medium">
                O técnico <strong>{session.technicianName}</strong> solicitou acesso remoto. Ao autorizar, a visualização da tela e o controle de mouse/teclado serão habilitados automaticamente.
              </p>
              <button
                type="button"
                className={btnPrimaryClass}
                disabled={!remote.connected}
                onClick={() => void remote.share()}
              >
                Autorizar Acesso Remoto
              </button>
            </div>
          )}
        </div>
      )}

      {/* Visor de Acesso Remoto + Barra de Ferramentas (Pontos 5, 6, 7 e 8) */}
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
          {/* Ponto 7: Seletor de Monitores em Tempo Real */}
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

          {/* Indicador de Foco Capturado (Ponto 5) */}
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
                  Soltar Foco (Esc)
                </button>
              )}
            </div>
          )}

          {/* Ponto 6: Controles de Zoom, Expandir, Tela Cheia e Janela Separada */}
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex items-center rounded-md bg-slate-800 p-0.5">
              <button
                type="button"
                onClick={() =>
                  setZoom((z) => Math.max(100, z - 25))
                }
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
                onClick={() =>
                  setZoom((z) => Math.min(200, z + 25))
                }
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

            {!isPopout && (
              <button
                type="button"
                onClick={openPopoutWindow}
                className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700"
                title="Abrir em uma nova janela separada"
              >
                <ExternalLink size={12} />
                Nova Janela
              </button>
            )}
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
          {/* Stream Nativo de Baixa Latência do Agente Rust */}
          {agentFrame && (
            <img
              ref={imgRef}
              src={agentFrame.dataUrl}
              alt="Tela remota da estação"
              draggable={false}
              style={{
                width: zoom === 100 ? '100%' : `${zoom}%`,
                maxWidth: zoom === 100 ? '100%' : 'none',
                maxHeight: zoom === 100 ? '100%' : 'none',
              }}
              className="object-contain select-none pointer-events-none"
            />
          )}

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
              !agentFrame && videoStream ? '' : 'hidden'
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
