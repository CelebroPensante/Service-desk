import { useState, type FormEvent } from 'react'
import { Headphones, Mail, Lock, ArrowRight } from 'lucide-react'
import type { Usuario, AuthResponse } from './types'

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
    <div className="min-h-screen flex flex-row">
      {/* Painel esquerdo */}
      <div className="flex flex-col justify-between p-12 bg-gradient-to-br from-blue-950 via-blue-800 to-sky-500 text-white basis-1/2 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center">
            <Headphones size={20} />
          </div>
          <div>
            <p className="font-semibold leading-tight">ServiceDesk</p>
            <p className="text-xs text-white/70 leading-tight">Plataforma de Suporte de TI</p>
          </div>
        </div>

        <div className="space-y-5">
          <h1 className="text-4xl font-semibold leading-tight max-w-md">
            Suporte técnico organizado, rápido e rastreável.
          </h1>
          <p className="text-white/80 max-w-sm leading-relaxed">
            Centralize chamados, acompanhe status em tempo real e resolva incidentes
            com autoavaliação automática da máquina.
          </p>

          <div className="flex gap-3 pt-2">
            {STATS.map((s) => (
              <div key={s.label} className="rounded-lg bg-white/10 px-4 py-3 min-w-[92px]">
                <p className="font-semibold">{s.valor}</p>
                <p className="text-xs text-white/70">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs text-white/50">© 2026 ServiceDesk. Todos os direitos reservados.</p>
      </div>

      {/* Painel direito */}
      <div className="basis-1/2 flex items-center justify-center bg-white px-6 py-12">
        <form onSubmit={handleSubmit} className="w-full max-w-sm">
          <h2 className="text-2xl font-semibold text-black">Bem-vindo de volta</h2>
          <p className="text-sm text-slate-500 mt-1 mb-6">
            Entre com suas credenciais para acessar o sistema.
          </p>

          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="email">
            E-mail
          </label>
          <div className="relative mb-4">
            <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@empresa.com"
              className="w-full rounded-lg border border-slate-200 pl-9 pr-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
            />
          </div>

          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="senha">
            Senha
          </label>
          <div className="relative mb-4">
            <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              id="senha"
              type="password"
              required
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-lg border border-slate-200 pl-9 pr-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
            />
          </div>

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

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg py-2.5 text-sm font-medium text-white bg-gradient-to-r from-blue-900 to-blue-600 hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? 'Entrando...' : 'Entrar'}
            {!loading && <ArrowRight size={16} />}
          </button>

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
      </div>
    </div>
  )
}

export default LoginScreen