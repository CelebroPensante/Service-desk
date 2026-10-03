import { useState } from 'react'
import LoginScreen from './LoginScreen'
import SignupScreen from './SignupScreen'
import ForgotPasswordScreen from './ForgotPasswordScreen'
import ChamadosScreen from './screens/ChamadosScreen'
import type { Usuario } from './types'
import './App.css'

type Tela = 'login' | 'cadastro' | 'esqueciSenha' | 'logado'

function App() {
  const [tela, setTela] = useState<Tela>('login')
  const [usuarioLogado, setUsuarioLogado] = useState<Usuario | null>(null)
  const [token, setToken] = useState<string | null>(null)

  function handleAutenticado(usuario: Usuario, token: string) {
    // Em produção, guarde o token de forma mais segura (ex: Tauri Store).
    console.log('Token JWT recebido:', token)
    setUsuarioLogado(usuario)
    setToken(token)
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

  if (tela === 'logado' && usuarioLogado && token) {
    // Caso contrário, mostra a tela de chamados (CRUD)
    return <ChamadosScreen usuario={usuarioLogado} token={token} onSair={handleSair} />
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