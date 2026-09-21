import type { ReactNode } from 'react'
import { Headset, KeyRound, LayoutGrid, LogOut, PlusCircle, Shield, Ticket, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Usuario } from '../../types'

export type Pagina = 'dashboard' | 'chamados' | 'novo' | 'tecnico' | 'usuarios' | 'cargos'

interface AppLayoutProps {
  usuario: Usuario
  paginaAtiva: Pagina
  onNavegar: (pagina: Pagina) => void
  onSair: () => void
  children: ReactNode
}

// nivelMinimo: só aparece no menu para quem tem esse nível de acesso (ou mais).
// A proteção de verdade continua sendo feita no backend.
const ITENS: { pagina: Pagina; label: string; icon: LucideIcon; nivelMinimo: number }[] = [
  { pagina: 'dashboard', label: 'Dashboard', icon: LayoutGrid, nivelMinimo: 0 },
  { pagina: 'chamados', label: 'Chamados', icon: Ticket, nivelMinimo: 0 },
  { pagina: 'novo', label: 'Novo Chamado', icon: PlusCircle, nivelMinimo: 0 },
  { pagina: 'tecnico', label: 'Painel Técnico', icon: Shield, nivelMinimo: 2 },
  { pagina: 'usuarios', label: 'Gestão de Usuários', icon: Users, nivelMinimo: 5 },
  { pagina: 'cargos', label: 'Cargos e Permissões', icon: KeyRound, nivelMinimo: 5 },
]

function iniciais(nome: string) {
  const partes = nome.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return '?'
  const primeira = partes[0][0]
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : ''
  return (primeira + ultima).toUpperCase()
}

function AppLayout({ usuario, paginaAtiva, onNavegar, onSair, children }: AppLayoutProps) {
  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar */}
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center gap-2.5 border-b border-slate-200 px-4 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white">
            <Headset size={16} />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-slate-900">ServiceDesk</p>
            <p className="text-xs text-slate-500">Suporte de TI</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-2">
          {ITENS.filter((item) => usuario.nivelAcesso >= item.nivelMinimo).map(({ pagina, label, icon: Icon }) => {
            const ativo = pagina === paginaAtiva
            return (
              <button
                key={pagina}
                type="button"
                onClick={() => onNavegar(pagina)}
                aria-current={ativo ? 'page' : undefined}
                className={
                  'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors ' +
                  (ativo
                    ? 'bg-brand text-white shadow-sm'
                    : 'text-slate-700 hover:bg-slate-100')
                }
              >
                <Icon size={16} />
                {label}
              </button>
            )
          })}
        </nav>

        <div className="border-t border-slate-200 p-2">
          <button
            type="button"
            onClick={onSair}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
          >
            <LogOut size={16} />
            Sair
          </button>
        </div>
      </aside>

      {/* Conteúdo */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center justify-between border-b border-slate-200 bg-white px-6">
          <p className="text-sm text-slate-600">
            Bem-vindo de volta, <span className="font-semibold text-slate-900">{usuario.nome}</span>
          </p>
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white"
            title={usuario.nome}
          >
            {iniciais(usuario.nome)}
          </div>
        </header>

        <main className="flex-1">{children}</main>
      </div>
    </div>
  )
}

export default AppLayout