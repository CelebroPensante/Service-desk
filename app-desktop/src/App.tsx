import { useState } from 'react'
import LoginScreen from './LoginScreen'
import SignupScreen from './SignupScreen'
import ForgotPasswordScreen from './ForgotPasswordScreen'
import type { Usuario } from './types'
import './App.css'

type Tela = 'login' | 'cadastro' | 'esqueciSenha' | 'logado'

function App() {
  const [tela, setTela] = useState<Tela>('login')
  const [usuarioLogado, setUsuarioLogado] = useState<Usuario | null>(null)

  function handleAutenticado(usuario: Usuario, token: string) {
    // Em produção, guarde o token de forma mais segura (ex: Tauri Store).
    console.log('Token JWT recebido:', token)
    setUsuarioLogado(usuario)
    setTela('logado')
  }

  function handleSair() {
    setUsuarioLogado(null)
    setTela('login')
  }

  if (tela === 'cadastro') {
    return (
      <SignupScreen
        onCadastroConcluido={handleAutenticado}
        onIrParaLogin={() => setTela('login')}
      />
    )
  }

  if (tela === 'esqueciSenha') {
    return <ForgotPasswordScreen onIrParaLogin={() => setTela('login')} />
  }

  if (tela === 'logado' && usuarioLogado) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold text-slate-900">
            Bem-vindo, {usuarioLogado.nome}!
          </h1>
          <p className="text-slate-500">
            Cargo: {usuarioLogado.cargo} · Nível de acesso: {usuarioLogado.nivelAcesso}
          </p>
          <button className="mt-4 text-sm text-blue-600 hover:underline" onClick={handleSair}>
            Sair
          </button>
        </div>
      </div>
    )
  }

  return (
    <LoginScreen
      onLoginSuccess={handleAutenticado}
      onIrParaCadastro={() => setTela('cadastro')}
      onIrParaEsqueciSenha={() => setTela('esqueciSenha')}
    />
  )
}

export default App