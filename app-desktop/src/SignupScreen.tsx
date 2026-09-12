import { useState, type FormEvent } from 'react'
import { Headphones, Mail, Lock, User, ArrowRight } from 'lucide-react'
import type { Usuario, AuthResponse } from './types'

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
            Crie sua conta e comece a organizar seus chamados.
          </h1>
          <p className="text-white/80 max-w-sm leading-relaxed">
            Cadastre-se para abrir chamados, acompanhar o status em tempo real e falar
            direto com o time de suporte.
          </p>
        </div>

        <p className="text-xs text-white/50">© 2026 ServiceDesk. Todos os direitos reservados.</p>
      </div>

      {/* Painel direito */}
      <div className="basis-1/2 flex items-center justify-center bg-white px-6 py-12">
        <form onSubmit={handleSubmit} className="w-full max-w-sm">
          <h2 className="text-2xl font-semibold text-black">Criar conta</h2>
          <p className="text-sm text-slate-500 mt-1 mb-6">
            Preencha seus dados para começar a usar o sistema.
          </p>

          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="nome">
            Nome completo
          </label>
          <div className="relative mb-4">
            <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              id="nome"
              type="text"
              required
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ana Pereira"
              className="w-full rounded-lg border border-slate-200 pl-9 pr-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
            />
          </div>

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
              minLength={8}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              placeholder="Mínimo de 8 caracteres"
              className="w-full rounded-lg border border-slate-200 pl-9 pr-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
            />
          </div>

          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="confirmarSenha">
            Confirmar senha
          </label>
          <div className="relative mb-4">
            <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              id="confirmarSenha"
              type="password"
              required
              value={confirmarSenha}
              onChange={(e) => setConfirmarSenha(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-lg border border-slate-200 pl-9 pr-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
            />
          </div>

          {erro && (
            <p className="my-5 text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{erro}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg py-2.5 text-sm font-medium text-white bg-gradient-to-r from-blue-900 to-blue-600 hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? 'Criando conta...' : 'Criar conta'}
            {!loading && <ArrowRight size={16} />}
          </button>

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
      </div>
    </div>
  )
}

export default SignupScreen