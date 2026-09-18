import { useState } from 'react'
import LoginScreen from './LoginScreen'
import SignupScreen from './SignupScreen'
import ForgotPasswordScreen from './ForgotPasswordScreen'
import ChamadoDetalhes from './ChamadoDetalhes'
import type { Usuario } from './types'
import './App.css'

type Tela = 'login' | 'cadastro' | 'esqueciSenha' | 'logado' | 'chamado'

function App() {
  const [tela, setTela] = useState<Tela>('login')
  const [usuarioLogado, setUsuarioLogado] = useState<Usuario | null>(null)
  const [token, setToken] = useState<string | null>(null)

  function handleAutenticado(usuario: Usuario, token: string) {
    setToken(token)
    setUsuarioLogado(usuario)
    setTela('logado')
  }

  function handleSair() {
    setUsuarioLogado(null)
    setToken(null)
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

  if (tela === 'chamado' && token && usuarioLogado) {
    return (
      <ChamadoDetalhes
        idChamado={1}
        token={token}
        idUsuarioLogado={usuarioLogado.id}
        onVoltar={() => setTela('logado')}
      />
    )
  }

  if (tela === 'logado' && usuarioLogado) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-semibold text-slate-900">
          Bem-vindo, {usuarioLogado.nome}!
        </h1>
        <p className="text-sm text-slate-500">
          Cargo: {usuarioLogado.cargo} · Nível de acesso: {usuarioLogado.nivelAcesso}
        </p>

        <button
          onClick={() => setTela('chamado')}
          className="mt-2 rounded-lg px-4 py-2 text-sm font-medium text-white bg-linear-to-r from-blue-900 to-blue-600 hover:opacity-90 transition"
        >
          Ver chamado (teste)
        </button>

        <button className="text-sm text-blue-600 hover:underline" onClick={handleSair}>
          Sair
        </button>
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