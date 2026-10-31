import { useEffect, useRef, useState } from 'react'
import type { Chamado } from '../../types'
import { remoteKey, videoPoint } from './remoteInput'
import { useRemoteAccess } from './useRemoteAccess'

interface Props { chamado: Chamado; token: string; userId: number; level: number }
const button = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium disabled:opacity-50'
const actions: Record<string, string> = {
  requested: 'Acesso solicitado', screen_allowed: 'Tela autorizada', control_requested: 'Controle solicitado',
  control_allowed: 'Controle autorizado', control_revoked: 'Controle revogado', agent_disconnected: 'Agente desconectado', ended: 'Sessão encerrada',
}
export default function AcessoRemoto({ chamado, token, userId, level }: Props) {
  const closed = !!chamado.dataResolucao || ['resolvido', 'fechado', 'finalizado', 'cancelado'].includes(chamado.status?.toLowerCase())
  const owner = chamado.idUsuario === userId
  const remote = useRemoteAccess(chamado.id, token, owner)
  const { session, videoStream, send } = remote
  const video = useRef<HTMLVideoElement>(null)
  const keys = useRef(new Map<string, string>())
  const [pairCode, setPairCode] = useState('')
  const canControl = !owner && !!session?.control
  const lastMove = useRef(0)
  useEffect(() => { if (video.current) video.current.srcObject = videoStream }, [videoStream])
  useEffect(() => { if (!canControl) keys.current.clear() }, [canControl])
  function release() {
    for (const key of keys.current.values()) send({ type: 'input', input: { kind: 'key', key, down: false } })
    keys.current.clear()
    if (canControl) for (let i = 0; i < 3; i++) send({ type: 'input', input: { kind: 'button', button: i, down: false } })
  }
  function move(e: React.PointerEvent<HTMLVideoElement>, force = false) {
    if (!canControl || !video.current) return false
    const now = performance.now(); if (!force && now - lastMove.current < 30) return false
    const v = video.current
    const point = videoPoint(e.clientX, e.clientY, v.getBoundingClientRect(), v.videoWidth, v.videoHeight)
    if (!point) return false
    send({ type: 'input', input: { kind: 'move', ...point } }); lastMove.current = now; return true
  }
  return <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="Acesso remoto">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-semibold text-slate-900">Acesso remoto</h2>
        <p className="text-sm text-slate-600">Compartilhamento de tela e controle com autorização do solicitante.</p></div>
      {!session && !owner && level >= 2 && !closed && <button className={button} onClick={() => { void remote.requestSession() }}>Solicitar acesso remoto</button>}
      {session && <button className={`${button} text-red-700`} disabled={!remote.connected} onClick={remote.end}>Encerrar sessão</button>}
    </div>
    {remote.error && <p role="alert" className="mt-3 rounded bg-red-50 p-3 text-sm text-red-700">{remote.error}</p>}
    {!session && owner && <p className="mt-3 text-sm text-slate-500">As solicitações do técnico aparecerão aqui enquanto este chamado estiver aberto.</p>}
    {session && <div className="mt-4 space-y-3">
      <p role="status" className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
        {session.control ? 'Controle remoto ativo — o técnico pode usar mouse e teclado.' : session.sharing ? 'Tela compartilhada. Controle de mouse e teclado depende de autorização separada.' : `Técnico ${session.technicianName} solicitou acesso. Aguardando compartilhamento da tela.`}
        {!remote.connected && ' Conectando…'}
        {owner && remote.connected && !session.technicianConnected && ' Aguardando conexão do técnico.'}
      </p>
      {owner && !session.sharing && <div>
        <p className="mb-2 text-sm text-slate-600">Abra no navegador via HTTPS ou localhost. Para permitir controle, escolha a tela inteira do monitor principal. O técnico verá o conteúdo escolhido.</p>
        <button className={button} disabled={!remote.connected || !session.technicianConnected} onClick={() => { void remote.share() }}>Autorizar e compartilhar tela</button>
      </div>}
      {!owner && session.sharing && !session.control && <button className={button} disabled={!remote.connected || session.controlRequested} onClick={() => send({ type: 'request_control' })}>
        {session.controlRequested ? 'Aguardando autorização do controle' : 'Solicitar controle de mouse e teclado'}
      </button>}
      {owner && session.controlRequested && !session.control && <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
        <p className="text-sm">O técnico solicita controle de mouse e teclado. Execute o agente com REMOTE_CONTROL_ENABLED=true e informe o código exibido no terminal desta máquina.</p>
        <label className="mt-2 block text-sm" htmlFor={`pair-${chamado.id}`}>Código local do agente</label>
        <input id={`pair-${chamado.id}`} type="password" autoComplete="off" value={pairCode} onChange={e => setPairCode(e.target.value)} className="my-2 w-full rounded border border-slate-300 bg-white px-3 py-2" />
        <div className="flex gap-2"><button className={button} disabled={pairCode.trim().length !== 32} onClick={() => { remote.allowControl(pairCode); setPairCode('') }}>Autorizar controle</button>
        <button className={button} onClick={() => send({ type: 'revoke_control' })}>Negar controle</button></div>
      </div>}
      {session.control && <button className={button} onClick={() => send({ type: 'revoke_control' })}>Revogar controle</button>}
    </div>}
    <video ref={video} autoPlay playsInline muted tabIndex={canControl ? 0 : -1}
      aria-label={owner ? 'Prévia da tela compartilhada' : 'Tela remota; clique para usar mouse e teclado'}
      className={`mt-4 max-h-[70vh] w-full rounded-lg bg-slate-900 object-contain outline-blue-500 ${videoStream ? '' : 'hidden'} ${canControl ? 'cursor-crosshair' : ''}`}
      onPointerMove={e => { move(e) }}
      onPointerDown={e => {
        if (!canControl || e.button > 2 || !move(e, true)) return
        e.preventDefault(); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId)
        send({ type: 'input', input: { kind: 'button', button: e.button, down: true } })
      }}
      onPointerUp={e => { if (canControl && e.button <= 2) { move(e, true); send({ type: 'input', input: { kind: 'button', button: e.button, down: false } }) } }}
      onPointerCancel={release} onBlur={release}
      onContextMenu={e => { if (canControl) e.preventDefault() }}
      onWheel={e => { if (canControl) { send({ type: 'input', input: { kind: 'scroll', delta: Math.sign(e.deltaY) * Math.min(10, Math.max(1, Math.ceil(Math.abs(e.deltaY) / 100))) } }) } }}
      onKeyDown={e => {
        if (!canControl) return
        if (e.key === 'Escape') { e.preventDefault(); release(); send({ type: 'revoke_control' }); return }
        const key = remoteKey(e.code, e.key); if (!key) return
        e.preventDefault(); keys.current.set(e.code, key)
        send({ type: 'input', input: { kind: 'key', key, down: true } })
      }}
      onKeyUp={e => {
        if (!canControl) return
        const key = keys.current.get(e.code); if (!key) return
        e.preventDefault(); keys.current.delete(e.code); send({ type: 'input', input: { kind: 'key', key, down: false } })
      }} />
    {canControl && <p className="mt-2 text-xs text-slate-600">Clique no vídeo para controlar. Esc revoga o controle. Atalhos reservados pelo navegador e telas de elevação do sistema podem não funcionar.</p>}
    {remote.history.length > 0 && <details className="mt-4 text-sm text-slate-600"><summary className="cursor-pointer">Histórico de acesso remoto</summary>
      <ul className="mt-2 space-y-1">{remote.history.map((event, i) => <li key={`${event.at}-${i}`}>{new Date(event.at).toLocaleString('pt-BR')} — {actions[event.action] ?? event.action}{event.userId > 0 ? ` (usuário #${event.userId})` : ''}</li>)}</ul>
    </details>}
  </section>
}
