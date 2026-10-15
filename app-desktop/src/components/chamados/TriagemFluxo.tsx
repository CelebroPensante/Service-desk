import { useEffect, useRef, useState } from 'react'
import { ArrowRight, CheckCircle2, Lightbulb, Loader2 } from 'lucide-react'
import type { EstadoTriagem, NoTriagem, OpcaoTriagem } from './TriagemTipos'

type Request = <T>(path: string, options?: RequestInit) => Promise<T>

interface Mensagem {
  autor: 'sistema' | 'usuario'
  texto: string
  // Preenchido quando o nó é uma sugestão de solução
  solucao?: string
}

interface TriagemFluxoProps {
  request: Request
  // A triagem terminou em abertura de chamado, ou o usuário pulou a triagem
  onAbrirChamado: () => void
  // O usuário confirmou que a solução sugerida resolveu o problema
  onResolvido: () => void
  onCancelar: () => void
}

function mensagemDoNo(no: NoTriagem): Mensagem {
  return {
    autor: 'sistema',
    texto: no.pergunta,
    solucao: no.tipoNo === 'sugestao_solucao' ? (no.solucaoSugerida ?? undefined) : undefined,
  }
}

const BOTAO_OPCAO =
  'rounded-xl border border-brand bg-white px-4 py-2 text-sm font-medium text-brand transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50'
const BOTAO_PRIMARIO =
  'flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-dark to-brand px-5 py-2.5 text-sm font-semibold text-white shadow-md transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60'
const BOTAO_SECUNDARIO =
  'rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-slate-50'

// Fluxo guiado de perguntas exibido na abertura de um chamado (US-21).
// Quem decide a próxima pergunta é o backend (US-20); aqui só se exibe a
// conversa e se envia a opção escolhida.
function TriagemFluxo({ request, onAbrirChamado, onResolvido, onCancelar }: TriagemFluxoProps) {
  const [estado, setEstado] = useState<EstadoTriagem | null>(null)
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [carregando, setCarregando] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // StrictMode executa o efeito duas vezes em desenvolvimento; sem a trava, duas triagens seriam criadas.
  const iniciou = useRef(false)
  const fimDaConversa = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (iniciou.current) return
    iniciou.current = true

    request<EstadoTriagem>('/api/triagem/iniciar', { method: 'POST' })
      .then((inicial) => {
        setEstado(inicial)
        setMensagens([mensagemDoNo(inicial.noAtual)])
      })
      .catch((e: unknown) => {
        setErro(e instanceof Error ? e.message : 'Não foi possível iniciar a triagem.')
      })
      .finally(() => setCarregando(false))
  }, [request])

  useEffect(() => {
    fimDaConversa.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [mensagens, estado])

  async function avancar(
    textoDoUsuario: string,
    chamada: () => Promise<EstadoTriagem>,
  ) {
    setEnviando(true)
    setErro(null)
    try {
      const novo = await chamada()
      setEstado(novo)
      setMensagens((atuais) => [
        ...atuais,
        { autor: 'usuario', texto: textoDoUsuario },
        mensagemDoNo(novo.noAtual),
      ])
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível enviar a resposta.')
    } finally {
      setEnviando(false)
    }
  }

  function responder(opcao: OpcaoTriagem) {
    if (!estado) return
    void avancar(opcao.texto, () =>
      request<EstadoTriagem>(`/api/triagem/${estado.idFluxo}/responder`, {
        method: 'POST',
        body: JSON.stringify({ idOpcao: opcao.id }),
      }),
    )
  }

  function confirmarResolvido() {
    if (!estado) return
    void avancar('Resolveu o meu problema', () =>
      request<EstadoTriagem>(`/api/triagem/${estado.idFluxo}/resolver`, { method: 'POST' }),
    )
  }

  const emAndamento = estado !== null && !estado.concluido

  return (
    <div className="mx-auto w-full max-w-[885px] px-10 py-8">
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">Abrir novo chamado</h1>
      <p className="mt-1 text-sm text-slate-600">
        Responda algumas perguntas para identificarmos corretamente o seu problema.
      </p>

      <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-7">
        <div
          className="flex max-h-[420px] min-h-40 flex-col gap-3 overflow-y-auto pr-1"
          aria-live="polite"
        >
          {carregando && (
            <p className="flex items-center gap-2 text-sm text-slate-600">
              <Loader2 size={16} className="animate-spin" />
              Iniciando a triagem...
            </p>
          )}

          {mensagens.map((m, i) =>
            m.autor === 'sistema' ? (
              <div key={i} className="max-w-[80%] self-start">
                <p className="rounded-2xl rounded-tl-sm bg-slate-100 px-4 py-3 text-sm text-slate-900">
                  {m.texto}
                </p>
                {m.solucao && (
                  <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                    <p className="flex items-center gap-2 text-xs font-semibold text-amber-800">
                      <Lightbulb size={14} />
                      Tente isto
                    </p>
                    <p className="mt-1 text-sm text-slate-900">{m.solucao}</p>
                  </div>
                )}
              </div>
            ) : (
              <p
                key={i}
                className="max-w-[80%] self-end rounded-2xl rounded-tr-sm bg-gradient-to-r from-brand-dark to-brand px-4 py-3 text-sm text-white"
              >
                {m.texto}
              </p>
            ),
          )}
          <div ref={fimDaConversa} />
        </div>

        {erro && <p className="mt-5 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{erro}</p>}

        {emAndamento && (
          <div className="mt-5 flex flex-wrap gap-3">
            {estado.opcoes.map((opcao) => (
              <button
                key={opcao.id}
                type="button"
                disabled={enviando}
                onClick={() => responder(opcao)}
                className={BOTAO_OPCAO}
              >
                {opcao.texto}
              </button>
            ))}
            {estado.podeResolver && (
              <button
                type="button"
                disabled={enviando}
                onClick={confirmarResolvido}
                className={BOTAO_OPCAO}
              >
                Resolveu o meu problema
              </button>
            )}
          </div>
        )}

        {estado?.concluido && estado.resultado === 'abrir_chamado' && (
          <div className="mt-5 flex items-center justify-between gap-4 rounded-xl border border-dashed border-blue-300 bg-blue-50/60 px-4 py-4">
            <p className="text-sm text-slate-900">
              Não foi possível resolver pela triagem. Vamos registrar o seu chamado.
            </p>
            <button type="button" onClick={onAbrirChamado} className={BOTAO_PRIMARIO}>
              Continuar para o chamado
              <ArrowRight size={16} />
            </button>
          </div>
        )}

        {estado?.concluido && estado.resultado === 'resolvido' && (
          <div className="mt-5 flex items-center justify-between gap-4 rounded-xl border border-green-200 bg-green-50 px-4 py-4">
            <p className="flex items-center gap-2 text-sm font-medium text-green-800">
              <CheckCircle2 size={16} />
              Que bom que deu certo! Nenhum chamado foi aberto.
            </p>
            <div className="flex shrink-0 gap-3">
              <button type="button" onClick={onAbrirChamado} className={BOTAO_SECUNDARIO}>
                Abrir chamado mesmo assim
              </button>
              <button type="button" onClick={onResolvido} className={BOTAO_PRIMARIO}>
                Concluir
              </button>
            </div>
          </div>
        )}

        <div className="mt-6 flex items-center justify-between gap-3 border-t border-slate-100 pt-5">
          <button
            type="button"
            onClick={onAbrirChamado}
            className="text-sm font-medium text-brand underline-offset-2 hover:underline"
          >
            Pular a triagem e abrir o chamado manualmente
          </button>
          <button type="button" onClick={onCancelar} className={BOTAO_SECUNDARIO}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}

export default TriagemFluxo