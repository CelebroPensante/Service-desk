import { useEffect, useState, type FormEvent } from 'react'
import { AlertTriangle, CheckCircle2, Flag, History, Pencil, Plus, Trash2, X } from 'lucide-react'
import PageContainer from '../layout/PageContainer'

type Request = <T>(path: string, options?: RequestInit) => Promise<T>

const API = '/api/admin/triagem'

type TipoNo = 'pergunta' | 'sugestao_solucao' | 'etapa_final'

interface Opcao {
  id: number
  texto: string
  ordem: number
  idNoDestino: number
  versao: number
}

interface No {
  id: number
  pergunta: string
  tipoNo: TipoNo
  solucaoSugerida: string | null
  ehRaiz: boolean
  ativo: boolean
  versao: number
  opcoes: Opcao[]
}

interface Problema {
  gravidade: 'erro' | 'aviso'
  codigo: string
  mensagem: string
  idNo: number | null
}

interface Validacao {
  valida: boolean
  problemas: Problema[]
}

interface Arvore {
  nos: No[]
  validacao: Validacao
}

interface Mutacao {
  id: number
  afetados: number[]
  desativados: number[]
  validacao: Validacao
}

interface Auditoria {
  id: number
  tabela: 'no_decisao' | 'opcao_resposta'
  operacao: 'INSERT' | 'UPDATE' | 'DELETE'
  idRegistro: number
  dadosAnteriores: Record<string, unknown> | null
  dadosNovos: Record<string, unknown> | null
  nomeUsuario: string | null
  dataAlteracao: string
}

const TIPOS: Record<TipoNo, { nome: string; rotulo: string; estilo: string }> = {
  pergunta: { nome: 'Pergunta', rotulo: 'Pergunta', estilo: 'border-blue-200 bg-blue-50 text-blue-700' },
  sugestao_solucao: {
    nome: 'Sugestão de solução',
    rotulo: 'Título da sugestão',
    estilo: 'border-amber-200 bg-amber-50 text-amber-700',
  },
  etapa_final: {
    nome: 'Etapa final',
    rotulo: 'Mensagem exibida antes de abrir o chamado',
    estilo: 'border-green-200 bg-green-50 text-green-700',
  },
}

const CAMPO =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand/40'
const LABEL = 'mb-1 block text-xs font-medium text-slate-600'
const BOTAO_PRIMARIO =
  'inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60'
const BOTAO_SECUNDARIO =
  'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50'
const BOTAO_ICONE =
  'rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 transition hover:bg-slate-50 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50'
const BADGE = 'rounded-md border px-1.5 py-0.5 text-[11px] font-medium'

const resumir = (texto: string, max = 70) => (texto.length > max ? texto.slice(0, max) + '…' : texto)

function formatarData(iso: string) {
  const data = new Date(iso)
  return Number.isNaN(data.getTime()) ? iso : data.toLocaleString('pt-BR')
}

function mensagemDeErro(e: unknown, padrao: string) {
  return e instanceof Error ? e.message : padrao
}

// ---------------------------------------------------------------
// Formulário de nó (criar / editar)
// ---------------------------------------------------------------
interface NoFormProps {
  no?: No
  ocupado: boolean
  onSalvar: (dados: { tipoNo: TipoNo; pergunta: string; solucaoSugerida: string }) => void
  onCancelar: () => void
}

function NoForm({ no, ocupado, onSalvar, onCancelar }: NoFormProps) {
  const [tipoNo, setTipoNo] = useState<TipoNo>(no?.tipoNo ?? 'pergunta')
  const [pergunta, setPergunta] = useState(no?.pergunta ?? '')
  const [solucao, setSolucao] = useState(no?.solucaoSugerida ?? '')
  const sugestao = tipoNo === 'sugestao_solucao'
  const valido = pergunta.trim() !== '' && (!sugestao || solucao.trim() !== '')

  function enviar(e: FormEvent) {
    e.preventDefault()
    if (valido) onSalvar({ tipoNo, pergunta, solucaoSugerida: solucao })
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">{no ? 'Editar nó' : 'Novo nó'}</h2>
        <button type="button" onClick={onCancelar} aria-label="Cancelar" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <X size={16} />
        </button>
      </div>

      {!no && (
        <label className="block">
          <span className={LABEL}>Tipo do nó</span>
          <select value={tipoNo} onChange={(e) => setTipoNo(e.target.value as TipoNo)} className={CAMPO}>
            {(Object.keys(TIPOS) as TipoNo[]).map((t) => (
              <option key={t} value={t}>
                {TIPOS[t].nome}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="block">
        <span className={LABEL}>{TIPOS[tipoNo].rotulo}</span>
        <textarea value={pergunta} onChange={(e) => setPergunta(e.target.value)} rows={2} maxLength={500} className={CAMPO} />
      </label>

      {sugestao && (
        <label className="block">
          <span className={LABEL}>Solução sugerida (um passo por linha)</span>
          <textarea value={solucao} onChange={(e) => setSolucao(e.target.value)} rows={4} maxLength={1000} className={CAMPO} />
        </label>
      )}

      {!no && (
        <p className="text-xs text-slate-500">
          O nó é criado como rascunho: ele só entra na triagem quando o ramo for ativado.
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancelar} className={BOTAO_SECUNDARIO}>
          Cancelar
        </button>
        <button type="submit" disabled={!valido || ocupado} className={BOTAO_PRIMARIO}>
          {no ? 'Salvar alterações' : 'Criar nó'}
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------
// Formulário de opção de resposta (criar / editar)
// ---------------------------------------------------------------
interface OpcaoFormProps {
  opcao?: Opcao
  origem: No
  destinos: No[]
  ocupado: boolean
  onSalvar: (dados: { texto: string; idNoDestino: number }) => void
  onCancelar: () => void
}

function OpcaoForm({ opcao, origem, destinos, ocupado, onSalvar, onCancelar }: OpcaoFormProps) {
  const [texto, setTexto] = useState(opcao?.texto ?? '')
  const [destino, setDestino] = useState<number | ''>(opcao?.idNoDestino ?? '')
  const valido = texto.trim() !== '' && destino !== ''

  function enviar(e: FormEvent) {
    e.preventDefault()
    if (valido) onSalvar({ texto, idNoDestino: Number(destino) })
  }

  return (
    <form onSubmit={enviar} className="mt-2 grid grid-cols-1 gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 sm:grid-cols-5">
      <label className="sm:col-span-2">
        <span className={LABEL}>Resposta</span>
        <input value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={200} placeholder="Ex.: Sim" className={CAMPO} />
      </label>
      <label className="sm:col-span-3">
        <span className={LABEL}>Leva para</span>
        <select value={destino} onChange={(e) => setDestino(e.target.value === '' ? '' : Number(e.target.value))} className={CAMPO}>
          <option value="">Selecione o próximo nó…</option>
          {destinos
            .filter((n) => n.id !== origem.id)
            .map((n) => (
              <option key={n.id} value={n.id}>
                {`#${n.id} · ${resumir(n.pergunta, 60)}${n.ativo ? '' : ' (rascunho)'}`}
              </option>
            ))}
        </select>
      </label>
      <div className="flex justify-end gap-2 sm:col-span-5">
        <button type="button" onClick={onCancelar} className={BOTAO_SECUNDARIO}>
          Cancelar
        </button>
        <button type="submit" disabled={!valido || ocupado} className={BOTAO_SECUNDARIO}>
          {opcao ? 'Salvar resposta' : 'Adicionar resposta'}
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------
// Histórico de alterações
// ---------------------------------------------------------------
const OPERACAO: Record<Auditoria['operacao'], { nome: string; estilo: string }> = {
  INSERT: { nome: 'Criado', estilo: 'border-green-200 bg-green-50 text-green-700' },
  UPDATE: { nome: 'Editado', estilo: 'border-blue-200 bg-blue-50 text-blue-700' },
  DELETE: { nome: 'Excluído', estilo: 'border-red-200 bg-red-50 text-red-600' },
}

const CAMPOS_VISIVEIS: Record<string, string> = {
  pergunta: 'Pergunta',
  solucao_sugerida: 'Solução',
  ativo: 'Ativo',
  eh_raiz: 'Pergunta inicial',
  texto: 'Resposta',
  ordem: 'Ordem',
  id_no_destino: 'Nó de destino',
}

function descreverRegistro(a: Auditoria) {
  const dados = a.dadosNovos ?? a.dadosAnteriores ?? {}
  const texto = a.tabela === 'no_decisao' ? dados.pergunta : dados.texto
  return typeof texto === 'string' ? resumir(texto, 90) : `#${a.idRegistro}`
}

function alteracoes(a: Auditoria): { campo: string; antes: string; depois: string }[] {
  if (a.operacao !== 'UPDATE' || !a.dadosAnteriores || !a.dadosNovos) return []
  const texto = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'boolean' ? (v ? 'sim' : 'não') : String(v))
  return Object.keys(CAMPOS_VISIVEIS)
    .filter((k) => JSON.stringify(a.dadosAnteriores?.[k]) !== JSON.stringify(a.dadosNovos?.[k]))
    .map((k) => ({
      campo: CAMPOS_VISIVEIS[k],
      antes: resumir(texto(a.dadosAnteriores?.[k]), 80),
      depois: resumir(texto(a.dadosNovos?.[k]), 80),
    }))
}

function ListaHistorico({ itens }: { itens: Auditoria[] }) {
  if (itens.length === 0) {
    return (
      <p className="rounded-2xl border border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-500">
        Nenhuma alteração registrada ainda.
      </p>
    )
  }
  return (
    <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
      {itens.map((a) => (
        <li key={a.id} className="px-5 py-3.5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className={`${BADGE} ${OPERACAO[a.operacao].estilo}`}>{OPERACAO[a.operacao].nome}</span>
            <span className="font-medium text-slate-700">{a.tabela === 'no_decisao' ? 'Nó' : 'Resposta'}</span>
            <span>{formatarData(a.dataAlteracao)}</span>
            <span>·</span>
            <span>{a.nomeUsuario ?? 'direto no banco'}</span>
          </div>
          <p className="mt-1 text-sm text-slate-900">{descreverRegistro(a)}</p>
          {alteracoes(a).map((c) => (
            <p key={c.campo} className="mt-0.5 text-xs text-slate-600">
              <span className="font-medium">{c.campo}:</span> <span className="line-through">{c.antes}</span> → {c.depois}
            </p>
          ))}
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------
// Tela
// ---------------------------------------------------------------
interface FluxosTriagemProps {
  request: Request
}

function FluxosTriagem({ request }: FluxosTriagemProps) {
  const [arvore, setArvore] = useState<Arvore | null>(null)
  const [historico, setHistorico] = useState<Auditoria[]>([])
  const [aba, setAba] = useState<'arvore' | 'historico'>('arvore')
  const [carregando, setCarregando] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [sucesso, setSucesso] = useState<string | null>(null)
  const [criandoNo, setCriandoNo] = useState(false)
  const [editandoNo, setEditandoNo] = useState<number | null>(null)
  const [novaOpcaoPara, setNovaOpcaoPara] = useState<number | null>(null)
  const [editandoOpcao, setEditandoOpcao] = useState<number | null>(null)

  useEffect(() => {
    let ativo = true
    request<Arvore>(`${API}/arvore`)
      .then((dados) => ativo && setArvore(dados))
      .catch((e) => ativo && setErro(mensagemDeErro(e, 'Não foi possível carregar a árvore de triagem.')))
      .finally(() => ativo && setCarregando(false))
    return () => {
      ativo = false
    }
  }, [request])

  async function recarregar() {
    const [dados, auditoria] = await Promise.all([
      request<Arvore>(`${API}/arvore`),
      request<Auditoria[]>(`${API}/auditoria?limite=100`),
    ])
    setArvore(dados)
    setHistorico(auditoria)
  }

  // Executa uma alteração, atualiza a tela e mostra o resultado (ou o motivo da recusa)
  async function executar(acao: () => Promise<Mutacao>, mensagem: (m: Mutacao) => string) {
    setOcupado(true)
    setErro(null)
    setSucesso(null)
    try {
      const resultado = await acao()
      await recarregar()
      setSucesso(mensagem(resultado))
      setCriandoNo(false)
      setEditandoNo(null)
      setNovaOpcaoPara(null)
      setEditandoOpcao(null)
    } catch (e) {
      setErro(mensagemDeErro(e, 'Não foi possível salvar a alteração.'))
    } finally {
      setOcupado(false)
    }
  }

  const json = (corpo: unknown): RequestInit => ({ body: JSON.stringify(corpo) })
  const put = (caminho: string, corpo?: unknown) =>
    request<Mutacao>(`${API}${caminho}`, { method: 'PUT', ...(corpo === undefined ? {} : json(corpo)) })
  const post = (caminho: string, corpo: unknown) =>
    request<Mutacao>(`${API}${caminho}`, { method: 'POST', ...json(corpo) })
  const apagar = (caminho: string) => request<Mutacao>(`${API}${caminho}`, { method: 'DELETE' })

  function criarNo(d: { tipoNo: TipoNo; pergunta: string; solucaoSugerida: string }) {
    void executar(
      () => post('/nos', { tipoNo: d.tipoNo, pergunta: d.pergunta, solucaoSugerida: d.tipoNo === 'sugestao_solucao' ? d.solucaoSugerida : undefined }),
      () => 'Nó criado como rascunho. Ligue-o à árvore e ative o ramo para publicá-lo.',
    )
  }

  function editarNo(no: No, d: { pergunta: string; solucaoSugerida: string }) {
    void executar(
      () => put(`/nos/${no.id}`, { pergunta: d.pergunta, solucaoSugerida: no.tipoNo === 'sugestao_solucao' ? d.solucaoSugerida : undefined }),
      () => 'Nó atualizado.',
    )
  }

  function excluirNo(no: No) {
    if (!window.confirm(`Excluir o nó "${resumir(no.pergunta, 60)}" e as respostas ligadas a ele?`)) return
    void executar(() => apagar(`/nos/${no.id}`), () => 'Nó excluído.')
  }

  function definirRaiz(no: No) {
    if (!window.confirm(`Definir "${resumir(no.pergunta, 60)}" como a pergunta inicial da triagem?`)) return
    void executar(() => put(`/nos/${no.id}/raiz`), (m) =>
      m.desativados.length > 0
        ? `Pergunta inicial alterada. ${m.desativados.length} nó(s) que só eram alcançados pela raiz anterior saíram do ar.`
        : 'Pergunta inicial alterada.',
    )
  }

  function alternarRamo(no: No) {
    if (no.ativo) {
      if (!window.confirm(`Tirar do ar "${resumir(no.pergunta, 60)}" e o que só é alcançado por ele?`)) return
      void executar(() => put(`/nos/${no.id}/desativar-ramo`), (m) => `${m.afetados.length} nó(s) desativado(s).`)
    } else {
      void executar(() => put(`/nos/${no.id}/ativar-ramo`), (m) => `${m.afetados.length} nó(s) ativado(s).`)
    }
  }

  function criarOpcao(origem: No, d: { texto: string; idNoDestino: number }) {
    void executar(() => post('/opcoes', { idNoOrigem: origem.id, idNoDestino: d.idNoDestino, texto: d.texto }), () => 'Resposta adicionada.')
  }

  function editarOpcao(opcao: Opcao, d: { texto: string; idNoDestino: number }) {
    void executar(() => put(`/opcoes/${opcao.id}`, d), () => 'Resposta atualizada.')
  }

  function excluirOpcao(opcao: Opcao) {
    if (!window.confirm(`Excluir a resposta "${opcao.texto}"?`)) return
    void executar(() => apagar(`/opcoes/${opcao.id}`), () => 'Resposta excluída.')
  }

  function abrirHistorico() {
    setAba('historico')
    request<Auditoria[]>(`${API}/auditoria?limite=100`)
      .then(setHistorico)
      .catch((e) => setErro(mensagemDeErro(e, 'Não foi possível carregar o histórico.')))
  }

  const nos = arvore?.nos ?? []
  const nomeDoNo = (id: number) => {
    const no = nos.find((n) => n.id === id)
    return no ? resumir(no.pergunta, 50) : `#${id}`
  }
  const problemas = arvore?.validacao.problemas ?? []
  const erros = problemas.filter((p) => p.gravidade === 'erro')
  const avisos = problemas.filter((p) => p.gravidade === 'aviso')

  return (
    <PageContainer titulo="Fluxos de triagem" subtitulo="Crie e edite as perguntas, respostas e soluções da triagem sem alterar o sistema.">
      {/* Validação de consistência */}
      {arvore && (
        <section
          className={`mb-5 rounded-2xl border px-5 py-4 ${erros.length > 0 ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'}`}
          aria-live="polite"
        >
          <p className={`flex items-center gap-2 text-sm font-semibold ${erros.length > 0 ? 'text-red-700' : 'text-green-800'}`}>
            {erros.length > 0 ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
            {erros.length > 0
              ? `A árvore ativa tem ${erros.length} problema(s) de consistência`
              : 'A árvore ativa está consistente: sem nós órfãos, ciclos ou perguntas sem saída'}
          </p>
          {erros.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-700">
              {erros.map((p, i) => (
                <li key={i}>{p.mensagem}</li>
              ))}
            </ul>
          )}
          {avisos.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-800">
              {avisos.map((p, i) => (
                <li key={i}>{p.mensagem}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {erro && <p className="mb-5 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{erro}</p>}
      {sucesso && <p className="mb-5 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{sucesso}</p>}

      {/* Abas */}
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1">
          <button
            type="button"
            onClick={() => setAba('arvore')}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${aba === 'arvore' ? 'bg-brand text-white' : 'text-slate-700 hover:bg-slate-100'}`}
          >
            Árvore
          </button>
          <button
            type="button"
            onClick={abrirHistorico}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${aba === 'historico' ? 'bg-brand text-white' : 'text-slate-700 hover:bg-slate-100'}`}
          >
            <History size={14} />
            Histórico
          </button>
        </div>
        {aba === 'arvore' && (
          <button type="button" onClick={() => setCriandoNo(true)} disabled={criandoNo} className={BOTAO_PRIMARIO}>
            <Plus size={16} />
            Novo nó
          </button>
        )}
      </div>

      {aba === 'historico' && <ListaHistorico itens={historico} />}

      {aba === 'arvore' && criandoNo && (
        <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-5">
          <NoForm ocupado={ocupado} onSalvar={criarNo} onCancelar={() => setCriandoNo(false)} />
        </section>
      )}

      {aba === 'arvore' && carregando && <p className="text-sm text-slate-500">Carregando a árvore…</p>}

      {aba === 'arvore' && !carregando && nos.length === 0 && (
        <p className="rounded-2xl border border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-500">
          Nenhum nó cadastrado. Crie a primeira pergunta e defina-a como pergunta inicial.
        </p>
      )}

      {aba === 'arvore' && (
        <div className="space-y-4">
          {nos.map((no) => (
            <article
              key={no.id}
              className={`rounded-2xl border bg-white p-5 ${no.ativo ? 'border-slate-200' : 'border-dashed border-amber-300'}`}
            >
              {editandoNo === no.id ? (
                <NoForm no={no} ocupado={ocupado} onSalvar={(d) => editarNo(no, d)} onCancelar={() => setEditandoNo(null)} />
              ) : (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`${BADGE} ${TIPOS[no.tipoNo].estilo}`}>{TIPOS[no.tipoNo].nome}</span>
                        {no.ehRaiz && (
                          <span className={`${BADGE} border-brand/30 bg-brand/10 text-brand`}>
                            <Flag size={10} className="mr-1 inline" />
                            Pergunta inicial
                          </span>
                        )}
                        {!no.ativo && <span className={`${BADGE} border-amber-200 bg-amber-50 text-amber-700`}>Rascunho</span>}
                        <span className="text-[11px] text-slate-400">
                          #{no.id} · v{no.versao}
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-medium text-slate-900">{no.pergunta}</p>
                      {no.tipoNo === 'sugestao_solucao' && no.solucaoSugerida && (
                        <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-sm text-slate-600">
                          {no.solucaoSugerida
                            .split('\n')
                            .filter((l) => l.trim() !== '')
                            .map((passo, i) => (
                              <li key={i}>{passo}</li>
                            ))}
                        </ol>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <button type="button" onClick={() => setEditandoNo(no.id)} aria-label="Editar nó" className={BOTAO_ICONE}>
                        <Pencil size={14} />
                      </button>
                      {!no.ehRaiz && (
                        <button
                          type="button"
                          onClick={() => excluirNo(no)}
                          disabled={ocupado}
                          aria-label="Excluir nó"
                          className={`${BOTAO_ICONE} hover:border-red-200 hover:bg-red-50 hover:text-red-600`}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  {no.tipoNo !== 'etapa_final' && (
                    <div className="mt-4">
                      <p className={LABEL}>Respostas</p>
                      {no.opcoes.length === 0 && <p className="text-xs text-slate-500">Nenhuma resposta cadastrada.</p>}
                      <ul className="space-y-1.5">
                        {no.opcoes.map((op) => (
                          <li key={op.id}>
                            {editandoOpcao === op.id ? (
                              <OpcaoForm
                                opcao={op}
                                origem={no}
                                destinos={nos}
                                ocupado={ocupado}
                                onSalvar={(d) => editarOpcao(op, d)}
                                onCancelar={() => setEditandoOpcao(null)}
                              />
                            ) : (
                              <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                                <span className="min-w-0 truncate">
                                  <span className="font-medium text-slate-900">{op.texto}</span>
                                  <span className="text-slate-500"> → {nomeDoNo(op.idNoDestino)}</span>
                                </span>
                                <span className="flex shrink-0 gap-1">
                                  <button type="button" onClick={() => setEditandoOpcao(op.id)} aria-label={`Editar resposta ${op.texto}`} className={BOTAO_ICONE}>
                                    <Pencil size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => excluirOpcao(op)}
                                    disabled={ocupado}
                                    aria-label={`Excluir resposta ${op.texto}`}
                                    className={`${BOTAO_ICONE} hover:border-red-200 hover:bg-red-50 hover:text-red-600`}
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </span>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                      {novaOpcaoPara === no.id ? (
                        <OpcaoForm
                          origem={no}
                          destinos={nos}
                          ocupado={ocupado}
                          onSalvar={(d) => criarOpcao(no, d)}
                          onCancelar={() => setNovaOpcaoPara(null)}
                        />
                      ) : (
                        <button type="button" onClick={() => setNovaOpcaoPara(no.id)} className={`${BOTAO_SECUNDARIO} mt-2`}>
                          <Plus size={12} />
                          Adicionar resposta
                        </button>
                      )}
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                    <button type="button" onClick={() => alternarRamo(no)} disabled={ocupado} className={BOTAO_SECUNDARIO}>
                      {no.ativo ? 'Desativar ramo' : 'Ativar ramo'}
                    </button>
                    {!no.ehRaiz && no.tipoNo === 'pergunta' && (
                      <button type="button" onClick={() => definirRaiz(no)} disabled={ocupado} className={BOTAO_SECUNDARIO}>
                        Definir como pergunta inicial
                      </button>
                    )}
                  </div>
                </>
              )}
            </article>
          ))}
        </div>
      )}
    </PageContainer>
  )
}

export default FluxosTriagem