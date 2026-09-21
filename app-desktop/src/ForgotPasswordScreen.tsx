import { useState, type FormEvent } from 'react'
import { Mail, ArrowLeft } from 'lucide-react'
import AuthLayout from './components/auth/AuthLayout'
import AuthField from './components/auth/AuthField'
import AuthSubmitButton from './components/auth/AuthSubmitButton'

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
    <AuthLayout
      heroTitle="Vamos recuperar seu acesso."
      heroDescription="Informe o e-mail cadastrado e enviaremos as instruções para você criar uma nova senha."
    >
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

              <AuthField id="email" label="E-mail" type="email" value={email} onChange={setEmail} placeholder="voce@empresa.com" icon={Mail} marginClassName="mb-6" />
              <AuthSubmitButton loadingLabel="Enviando...">Enviar link de recuperação</AuthSubmitButton>
            </form>
          )}
      </div>
    </AuthLayout>
  )
}

export default ForgotPasswordScreen