import { useState, type FormEvent } from 'react'
import { Mail, Lock } from 'lucide-react'
import type { Usuario, AuthResponse } from './types'
import AuthLayout from './components/auth/AuthLayout'
import AuthField from './components/auth/AuthField'
import AuthSubmitButton from './components/auth/AuthSubmitButton'

const API_URL = 'http://localhost:8080'

const STATS = [
  { valor: '1.2k+', label: 'Chamados/mês' },
  { valor: '98%', label: 'Satisfação' },
  { valor: '<2h', label: 'Tempo médio' },
]

interface LoginScreenProps {
  onLoginSuccess: (usuario: Usuario, token: string) => void
  onIrParaCadastro: () => void
  onIrParaEsqueciSenha: () => void
}

function LoginScreen({ onLoginSuccess, onIrParaCadastro, onIrParaEsqueciSenha }: LoginScreenProps) {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [lembrar, setLembrar] = useState(false)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    setLoading(true)

    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, senha }),
      })

      const data = await res.json()

      if (!res.ok) {
        setErro(data.erro ?? 'Não foi possível fazer login.')
        return
      }

      const auth = data as AuthResponse
      onLoginSuccess(auth.usuario, auth.token)
    } catch {
      setErro('Não foi possível conectar à API. Verifique se o backend está rodando.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      heroTitle="Suporte técnico organizado, rápido e rastreável."
      heroDescription="Centralize chamados, acompanhe status em tempo real e resolva incidentes com autoavaliação automática da máquina."
      stats={STATS}
    >
      <form onSubmit={handleSubmit} className="w-full max-w-sm">
          <h2 className="text-2xl font-semibold text-black">Bem-vindo de volta</h2>
          <p className="text-sm text-slate-500 mt-1 mb-6">
            Entre com suas credenciais para acessar o sistema.
          </p>

          <AuthField id="email" label="E-mail" type="email" value={email} onChange={setEmail} placeholder="voce@empresa.com" icon={Mail} />
          <AuthField id="senha" label="Senha" type="password" value={senha} onChange={setSenha} placeholder="••••••••" icon={Lock} />

          <div className="flex items-center justify-between mb-5">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={lembrar}
                onChange={(e) => setLembrar(e.target.checked)}
                className="rounded border-slate-300"
              />
              Lembrar-me
            </label>
            <button
              type="button"
              onClick={onIrParaEsqueciSenha}
              className="text-sm text-blue-600 hover:underline"
            >
              Esqueci minha senha
            </button>
          </div>

          {erro && (
            <p className="my-5 text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{erro}</p>
          )}

          <AuthSubmitButton loading={loading} loadingLabel="Entrando...">Entrar</AuthSubmitButton>

          <p className="text-sm text-slate-500 text-center mt-6 py-2">
            Ainda não tem uma conta?{' '}
            <button
              type="button"
              onClick={onIrParaCadastro}
              className="text-blue-600 font-medium hover:underline"
            >
              Criar conta
            </button>
          </p>

          <p className="text-xs text-slate-400 text-center mt-6 py-2">
            Ao entrar você aceita nossos{' '}
            <a href="#" className="underline hover:text-slate-600">
              termos de uso
            </a>
            .
          </p>
      </form>
    </AuthLayout>
  )
}

export default LoginScreen