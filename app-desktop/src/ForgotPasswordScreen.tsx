import { useState, type FormEvent } from 'react'
import { Headphones, Mail, ArrowRight, ArrowLeft } from 'lucide-react'

interface ForgotPasswordScreenProps {
  onIrParaLogin: () => void
}

function ForgotPasswordScreen({ onIrParaLogin }: ForgotPasswordScreenProps) {
  const [email, setEmail] = useState('')
  const [enviado, setEnviado] = useState(false)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    // TODO: sem backend ainda — isso só simula o envio visualmente.
    setEnviado(true)
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
            Vamos recuperar seu acesso.
          </h1>
          <p className="text-white/80 max-w-sm leading-relaxed">
            Informe o e-mail cadastrado e enviaremos as instruções para você criar uma
            nova senha.
          </p>
        </div>

        <p className="text-xs text-white/50">© 2026 ServiceDesk. Todos os direitos reservados.</p>
      </div>

      {/* Painel direito */}
      <div className="basis-1/2 flex items-center justify-center bg-white px-6 py-12">
        <div className="w-full max-w-sm">
          <button
            type="button"
            onClick={onIrParaLogin}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-6"
          >
            <ArrowLeft size={14} />
            Voltar para o login
          </button>

          {enviado ? (
            <div>
              <h2 className="text-2xl font-semibold text-black">Verifique seu e-mail</h2>
              <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                Se houver uma conta cadastrada com <strong>{email}</strong>, você vai
                receber um link para redefinir sua senha em instantes.
              </p>
              <button
                type="button"
                onClick={onIrParaLogin}
                className="w-full mt-6 rounded-lg py-2.5 text-sm font-medium text-white bg-gradient-to-r from-blue-900 to-blue-600 hover:opacity-90 transition flex items-center justify-center gap-2"
              >
                Voltar para o login
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <h2 className="text-2xl font-semibold text-black">Esqueceu sua senha?</h2>
              <p className="text-sm text-slate-500 mt-1 mb-6">
                Sem problemas. Informe seu e-mail e enviaremos um link de recuperação.
              </p>

              <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="email">
                E-mail
              </label>
              <div className="relative mb-6">
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

              <button
                type="submit"
                className="w-full rounded-lg py-2.5 text-sm font-medium text-white bg-gradient-to-r from-blue-900 to-blue-600 hover:opacity-90 transition flex items-center justify-center gap-2"
              >
                Enviar link de recuperação
                <ArrowRight size={16} />
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

export default ForgotPasswordScreen