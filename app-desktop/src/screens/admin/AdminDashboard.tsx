import { useState } from 'react'
import type { Usuario } from '../../types'
import RolesManager from './RolesManager'
import UsersManager from './UsersManager'
import { LayoutDashboard, Users, Shield, LogOut } from 'lucide-react'

interface Props {
  usuario: Usuario
  token: string
  onSair: () => void
}

export default function AdminDashboard({ usuario, token, onSair }: Props) {
  const [activeTab, setActiveTab] = useState<'usuarios' | 'cargos'>('usuarios')

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col">
        <div className="p-4 bg-slate-950 flex items-center space-x-2">
          <Shield className="w-6 h-6 text-blue-500" />
          <span className="font-semibold text-white">Painel Admin</span>
        </div>
        
        <nav className="flex-1 p-4 space-y-2">
          <button
            onClick={() => setActiveTab('usuarios')}
            className={`w-full flex items-center space-x-2 px-3 py-2 rounded-md transition-colors ${
              activeTab === 'usuarios' ? 'bg-blue-600 text-white' : 'hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Usuários</span>
          </button>
          
          <button
            onClick={() => setActiveTab('cargos')}
            className={`w-full flex items-center space-x-2 px-3 py-2 rounded-md transition-colors ${
              activeTab === 'cargos' ? 'bg-blue-600 text-white' : 'hover:bg-slate-800 hover:text-white'
            }`}
          >
            <LayoutDashboard className="w-4 h-4" />
            <span>Cargos e Permissões</span>
          </button>
        </nav>

        <div className="p-4 border-t border-slate-800">
          <div className="text-sm truncate mb-3 text-slate-400">
            Logado como <strong className="text-white">{usuario.nome}</strong>
          </div>
          <button
            onClick={onSair}
            className="w-full flex items-center justify-center space-x-2 px-3 py-2 rounded-md bg-slate-800 hover:bg-slate-700 text-white transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>Sair</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-8 overflow-y-auto">
        <header className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">
            {activeTab === 'usuarios' ? 'Gestão de Usuários' : 'Gestão de Cargos'}
          </h1>
          <p className="text-slate-500 mt-1">
            {activeTab === 'usuarios'
              ? 'Atribua cargos e gerencie o acesso dos usuários do sistema.'
              : 'Crie e configure os papéis de acesso e permissões.'}
          </p>
        </header>

        {activeTab === 'usuarios' ? (
          <UsersManager token={token} />
        ) : (
          <RolesManager token={token} />
        )}
      </main>
    </div>
  )
}
