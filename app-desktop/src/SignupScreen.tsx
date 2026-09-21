import { useState, type FormEvent } from 'react'
import { Mail, Lock, User } from 'lucide-react'
import type { Usuario, AuthResponse } from './types'
import AuthLayout from './components/auth/AuthLayout'
import AuthField from './components/auth/AuthField'
import AuthSubmitButton from './components/auth/AuthSubmitButton'

const API_URL = 'http://localhost:8080'

interface SignupScreenProps {
  onCadastroConcluido: (usuario: Usuario, token: string) => void
  onIrParaLogin: () => void
}

function SignupScreen({ onCadastroConcluido, onIrParaLogin }: SignupScreenProps) {
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [confirmarSenha, setConfirmarSenha] = useState('')
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setErro(null)

    if (senha.length < 8) {
      setErro('A senha deve ter pelo menos 8 caracteres.')
      return
    }
    if (senha !== confirmarSenha) {
      setErro('As senhas não coincidem.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, email, senha }),
      })

      const data = await res.json()

      if (!res.ok) {
        setErro(data.erro ?? 'Não foi possível criar a conta.')
        return
      }

      const auth = data as AuthResponse
      onCadastroConcluido(auth.usuario, auth.token)
    } catch {
      setErro('Não foi possível conectar à API. Verifique se o backend está rodando.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      heroTitle="Crie sua conta e comece a organizar seus chamados."
      heroDescription="Cadastre-se para abrir chamados, acompanhar o status em tempo real e falar direto com o time de suporte."
    >
      <form onSubmit={handleSubmit} className="w-full max-w-sm">
          <h2 className="text-2xl font-semibold text-black">Criar conta</h2>
          <p className="text-sm text-slate-500 mt-1 mb-6">
            Preencha seus dados para começar a usar o sistema.
          </p>

          <AuthField id="nome" label="Nome completo" type="text" value={nome} onChange={setNome} placeholder="Ana Pereira" icon={User} />
          <AuthField id="email" label="E-mail" type="email" value={email} onChange={setEmail} placeholder="voce@empresa.com" icon={Mail} />
          <AuthField id="senha" label="Senha" type="password" value={senha} onChange={setSenha} placeholder="Mínimo de 8 caracteres" icon={Lock} minLength={8} />
          <AuthField id="confirmarSenha" label="Confirmar senha" type="password" value={confirmarSenha} onChange={setConfirmarSenha} placeholder="••••••••" icon={Lock} />

          {erro && (
            <p className="my-5 text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{erro}</p>
          )}

          <AuthSubmitButton loading={loading} loadingLabel="Criando conta...">Criar conta</AuthSubmitButton>

          <p className="text-sm text-slate-500 text-center mt-4">
            Já tem uma conta?{' '}
            <button
              type="button"
              onClick={onIrParaLogin}
              className="text-blue-600 font-medium hover:underline"
            >
              Entrar
            </button>
          </p>
      </form>
    </AuthLayout>
  )
}

export default SignupScreen