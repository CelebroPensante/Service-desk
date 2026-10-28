import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import type {
  CategoriaResumo,
  Chamado,
  MachineTelemetry,
  PrioridadeResumo,
  SetorResumo,
  Usuario,
} from "../types";
import ChamadoDetail from "../components/chamados/ChamadoDetail";
import ChamadoForm, {
  type ChamadoFormData,
} from "../components/chamados/ChamadoForm";
import ChamadosList from "../components/chamados/ChamadosList";
import TriagemFluxo from "../components/chamados/TriagemFluxo";
import type { PreenchimentoChamado } from "../components/chamados/TriagemTipos";
import AppLayout, { type Pagina } from "../components/layout/AppLayout";
import DashboardView from "../components/dashboard/DashboardView";
import TecnicoPanel from "../components/tecnico/TecnicoPanel";
import GestaoUsuarios from "../components/admin/GestaoUsuarios";
import CargosPermissoes from "../components/admin/CargosPermissoes";
import TriagemPanel from "../components/triagem/TriagemPanel";
import RelatoriosPanel from "../components/relatorios/RelatoriosPanel";
import FluxosTriagem from "../components/admin/FluxosTriagem";

const API_URL = "http://localhost:8080";
export const TELEMETRIA_API_URL = "http://localhost:8081";

// NOVO: "dashboard" é a tela inicial agora
type Modo =
  | "dashboard"
  | "lista"
  | "novo"
  | "detalhe"
  | "editar"
  | "tecnico"
  | "triagem"
  | "relatorios"
  | "usuarios"
  | "cargos"
  | "fluxos";

interface ChamadosScreenProps {
  usuario: Usuario;
  token: string;
  onSair: () => void;
}

const FORM_VAZIO: ChamadoFormData = {
  titulo: "",
  descricaoDetalhada: "",
  idCategoria: "",
  idPrioridade: "",
  idSetor: "",
};

// NOVO: ordem alfabética, mas "Outros" sempre por último
function ordenarCategorias(lista: CategoriaResumo[]): CategoriaResumo[] {
  const eOutros = (c: CategoriaResumo) => c.categoria.trim().toLowerCase() === "outros";
  return [...lista].sort(
    (a, b) =>
      Number(eOutros(a)) - Number(eOutros(b)) || a.categoria.localeCompare(b.categoria),
  );
}

function ChamadosScreen({ usuario, token, onSair }: ChamadosScreenProps) {
  const [chamados, setChamados] = useState<Chamado[]>([]);
  const [categorias, setCategorias] = useState<CategoriaResumo[]>([]);
  const [prioridades, setPrioridades] = useState<PrioridadeResumo[]>([]);
  const [setores, setSetores] = useState<SetorResumo[]>([]);
  const [modo, setModo] = useState<Modo>("dashboard");
  const [selecionado, setSelecionado] = useState<Chamado | null>(null);
  const [form, setForm] = useState<ChamadoFormData>(FORM_VAZIO);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  // US-21: a abertura de um chamado novo começa pela triagem guiada
  const [triagemAtiva, setTriagemAtiva] = useState(false);
  // US-23: triagem que vai originar o chamado novo (e o que ela preencheu)
  const [triagemOrigem, setTriagemOrigem] = useState<{
    idFluxo: number;
    preenchimento: PreenchimentoChamado | null;
  } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // NOVO: erros de carga (categorias, prioridades, chamados), separados do erro de ações
  const [erroDados, setErroDados] = useState<string | null>(null);

  // Estado da Autoavaliação da Máquina (coletada via Agente Rust -> Servidor Go)
  const [autoavaliacao, setAutoavaliacao] = useState<MachineTelemetry | null>(null);
  const [gerandoAutoavaliacao, setGerandoAutoavaliacao] = useState(false);
  const [erroAutoavaliacao, setErroAutoavaliacao] = useState<string | null>(null);

  // useCallback: a função só muda se o token mudar (o TecnicoPanel depende disso)
  const request = useCallback(
    async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
      const headers = new Headers(options.headers);
      headers.set("Authorization", `Bearer ${token}`);
      if (options.body) headers.set("Content-Type", "application/json");

      const response = await fetch(`${API_URL}${path}`, { ...options, headers });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.erro ?? `Erro na requisição (${response.status})`);
      }
      // Respostas sem corpo (ex: DELETE com 204) não quebram mais o JSON.parse
      if (response.status === 204) return undefined as T;
      const texto = await response.text();
      return (texto ? JSON.parse(texto) : undefined) as T;
    },
    [token],
  );

  async function carregarChamados() {
    setChamados(await request<Chamado[]>("/api/chamados"));
  }

  // NOVO: allSettled faz cada requisição valer por si só.
  // Antes, se UMA falhasse (ex: categorias), as outras eram descartadas.
  async function carregarDados() {
    setLoading(true);
    setErro(null);
    setErroDados(null);

    const [rChamados, rCategorias, rPrioridades, rSetores] = await Promise.allSettled([
      request<Chamado[]>("/api/chamados"),
      request<CategoriaResumo[]>("/api/chamados/categorias"),
      request<PrioridadeResumo[]>("/api/chamados/prioridades"),
      request<SetorResumo[]>("/api/chamados/setores"),
    ]);

    const falhas: string[] = [];
    const motivo = (r: PromiseRejectedResult) =>
      r.reason instanceof Error ? r.reason.message : "erro desconhecido";

    if (rChamados.status === "fulfilled") setChamados(rChamados.value);
    else falhas.push(`chamados: ${motivo(rChamados)}`);

    if (rCategorias.status === "fulfilled") setCategorias(rCategorias.value);
    else falhas.push(`categorias: ${motivo(rCategorias)}`);

    if (rPrioridades.status === "fulfilled") setPrioridades(rPrioridades.value);
    else falhas.push(`prioridades: ${motivo(rPrioridades)}`);

    // Setores só são exibidos/editados por técnicos; para os demais a falha não incomoda
    if (rSetores.status === "fulfilled") setSetores(rSetores.value);
    else if (usuario.nivelAcesso >= 2) falhas.push(`setores: ${motivo(rSetores)}`);

    if (falhas.length > 0) {
      console.error("Falha ao carregar dados:", falhas);
      setErroDados(falhas.join(" | "));
    }
    setLoading(false);
  }

  useEffect(() => {
    void carregarDados();
  }, []);

  async function gerarAutoavaliacao() {
    setGerandoAutoavaliacao(true);
    setErroAutoavaliacao(null);
    try {
      const resp = await fetch(`${TELEMETRIA_API_URL}/api/telemetria/maquinas/atual`);
      if (!resp.ok) {
        const body = await resp.json().catch(() => null);
        throw new Error(
          body?.erro ??
            "Não foi possível coletar a autoavaliação. Verifique se o Agente Rust e o Servidor Go estão em execução.",
        );
      }
      const snap = (await resp.json()) as MachineTelemetry;
      setAutoavaliacao(snap);
    } catch (e) {
      setErroAutoavaliacao(
        e instanceof Error
          ? e.message
          : "Falha ao conectar ao servidor de telemetria (porta 8081).",
      );
    } finally {
      setGerandoAutoavaliacao(false);
    }
  }

  function abrirNovo() {
    setSelecionado(null);
    setForm(FORM_VAZIO);
    setErro(null);
    setTriagemOrigem(null);
    setAutoavaliacao(null);
    setErroAutoavaliacao(null);
    setTriagemAtiva(true);
    setModo("novo");
  }

  // Navegação da sidebar
  function navegar(pagina: Pagina) {
    setErro(null);
    setSelecionado(null);
    if (pagina === "novo") abrirNovo();
    else if (pagina === "chamados") setModo("lista");
    else setModo(pagina);
  }

  // Qual item da sidebar fica destacado
  const paginaAtiva: Pagina =
    modo === "dashboard" || modo === "tecnico" || modo === "triagem" || modo === "relatorios" || modo === "usuarios" || modo === "cargos"  || modo === "fluxos"
      ? modo
      : modo === "novo"
        ? "novo"
        : "chamados";

  function alterarCampo(campo: keyof ChamadoFormData, valor: string) {
    setForm((formAtual) => ({ ...formAtual, [campo]: valor }));
  }

  async function abrirDetalhe(id: number) {
    setErro(null);
    try {
      setSelecionado(await request<Chamado>(`/api/chamados/${id}`));
      setModo("detalhe");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível consultar o chamado.");
    }
  }

  function abrirEdicao(chamado: Chamado) {
    setSelecionado(chamado);
    setForm({
      titulo: chamado.titulo,
      descricaoDetalhada: chamado.descricaoDetalhada,
      idCategoria: String(chamado.idCategoria),
      idPrioridade: String(chamado.idPrioridade),
      idSetor: chamado.idSetor != null ? String(chamado.idSetor) : "",
    });
    setErro(null);
    setModo("editar");
  }

  async function salvarChamado(event: FormEvent) {
    event.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      const body = JSON.stringify({
        titulo: form.titulo,
        descricaoDetalhada: form.descricaoDetalhada,
        idCategoria: Number(form.idCategoria),
        idPrioridade: Number(form.idPrioridade),
        // US-23: setor (o servidor só aceita de técnico) e triagem de origem
        idSetor: form.idSetor ? Number(form.idSetor) : undefined,
        idFluxoTriagem:
          modo === "novo" && triagemOrigem ? triagemOrigem.idFluxo : undefined,
      });
      if (modo === "editar" && selecionado) {
        await request<Chamado>(`/api/chamados/${selecionado.id}`, { method: "PUT", body });
      } else {
        const novoChamado = await request<Chamado>("/api/chamados", { method: "POST", body });
        // Se o usuário gerou a autoavaliação da máquina, vincula o relatório técnico ao chamado recém-criado
        if (autoavaliacao && novoChamado?.id) {
          await fetch(`${TELEMETRIA_API_URL}/api/telemetria/chamados/${novoChamado.id}/relatorio`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              machineUid: autoavaliacao.machineUid,
              snapshot: autoavaliacao,
            }),
          }).catch((err) => {
            console.warn("Aviso: chamado criado, mas não foi possível anexar relatório de telemetria:", err);
          });
        }
      }
      await carregarChamados();
      setSelecionado(null);
      setForm(FORM_VAZIO);
      setTriagemOrigem(null);
      setAutoavaliacao(null);
      setErroAutoavaliacao(null);
      setModo("lista");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível salvar o chamado.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluirChamado(chamado: Chamado) {
    if (!window.confirm(`Deseja excluir o chamado "${chamado.titulo}"?`)) return;
    setErro(null);
    try {
      await request<{ mensagem: string }>(`/api/chamados/${chamado.id}`, { method: "DELETE" });
      await carregarChamados();
      if (selecionado?.id === chamado.id) {
        setSelecionado(null);
        setModo("lista");
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível excluir o chamado.");
    }
  }

  // NOVO: toda tela passa a ser renderizada dentro da sidebar + topbar
  function comLayout(conteudo: ReactNode) {
    return (
      <AppLayout
        usuario={usuario}
        paginaAtiva={paginaAtiva}
        onNavegar={navegar}
        onSair={onSair}
      >
        {conteudo}
      </AppLayout>
    );
  }

  if (loading) {
    return comLayout(
      <div className="flex h-64 items-center justify-center text-sm text-slate-600">
        Carregando chamados...
      </div>,
    );
  }

  if (modo === "tecnico" && usuario.nivelAcesso >= 2) {
    return comLayout(
      <TecnicoPanel
        chamados={chamados}
        request={request}
        onRecarregar={carregarChamados}
        onDetalhe={(id) => void abrirDetalhe(id)}
      />,
    );
  }

  if (modo === "triagem" && usuario.nivelAcesso >= 3) {
    return comLayout(
      <TriagemPanel
        chamados={chamados}
        request={request}
        onRecarregar={carregarChamados}
        onDetalhe={(id) => void abrirDetalhe(id)}
      />,
    );
  }

  if (modo === "relatorios" && usuario.nivelAcesso >= 4) {
    return comLayout(<RelatoriosPanel chamados={chamados} request={request} />);
  }

  if (modo === "usuarios" && usuario.nivelAcesso >= 5) {
    return comLayout(<GestaoUsuarios request={request} />);
  }

  if (modo === "cargos" && usuario.nivelAcesso >= 5) {
    return comLayout(<CargosPermissoes request={request} />);
  }

  if (modo === "fluxos" && usuario.nivelAcesso >= 5) {
    return comLayout(<FluxosTriagem request={request} />);
  }

  if (modo === "dashboard") {
    return comLayout(
      <DashboardView
        chamados={chamados}
        erro={erro ?? erroDados}
        onNovo={abrirNovo}
        onVerTodos={() => setModo("lista")}
        onDetalhe={(id) => void abrirDetalhe(id)}
      />,
    );
  }

  if (modo === "novo" && triagemAtiva) {
    return comLayout(
      <TriagemFluxo
        request={request}
        onAbrirChamado={(estado) => {
          setTriagemAtiva(false);
          // US-23: seguindo pela etapa final, o formulário já vem preenchido
          if (estado?.resultado === "abrir_chamado") {
            const p = estado.preenchimento;
            setTriagemOrigem({ idFluxo: estado.idFluxo, preenchimento: p });
            setForm((atual) => ({
              ...atual,
              idCategoria: p?.idCategoria != null ? String(p.idCategoria) : atual.idCategoria,
              idPrioridade: p?.idPrioridade != null ? String(p.idPrioridade) : atual.idPrioridade,
              idSetor: p?.idSetor != null ? String(p.idSetor) : atual.idSetor,
            }));
          }
        }}
        onResolvido={() => {
          setTriagemAtiva(false);
          setModo("dashboard");
        }}
        onCancelar={() => {
          setTriagemAtiva(false);
          setModo("lista");
        }}
      />,
    );
  }

  if (modo === "novo" || modo === "editar") {
    // US-23: o que a triagem definiu fica visível; só a equipe técnica (nível >= 2) altera
    const tecnico = usuario.nivelAcesso >= 2;
    const editando = modo === "editar";
    const origemTriagem = editando
      ? selecionado?.idFluxoTriagem != null
      : triagemOrigem != null;
    const preenchimento = triagemOrigem?.preenchimento ?? null;
    const travarCategoria =
      !tecnico && (editando ? origemTriagem : preenchimento?.idCategoria != null);
    const travarPrioridade =
      !tecnico && (editando ? origemTriagem : preenchimento?.idPrioridade != null);
    const setorNome = editando ? (selecionado?.setor ?? null) : (preenchimento?.setor ?? null);

    return comLayout(
      <ChamadoForm
        modo={modo}
        form={form}
        categorias={ordenarCategorias(categorias)}
        prioridades={prioridades}
        setores={setores}
        origemTriagem={origemTriagem}
        travarCategoria={travarCategoria}
        travarPrioridade={travarPrioridade}
        podeEditarSetor={tecnico}
        setorNome={setorNome}
        erro={erro ?? erroDados}
        salvando={salvando}
        onSubmit={salvarChamado}
        onChange={alterarCampo}
        onCancel={() => {
          setTriagemOrigem(null);
          setAutoavaliacao(null);
          setErroAutoavaliacao(null);
          setModo("lista");
        }}
        onGerarAutoavaliacao={() => void gerarAutoavaliacao()}
        gerandoAutoavaliacao={gerandoAutoavaliacao}
        autoavaliacao={autoavaliacao}
        erroAutoavaliacao={erroAutoavaliacao}
        onRemoverAutoavaliacao={() => setAutoavaliacao(null)}
      />,
    );
  }

  if (modo === "detalhe" && selecionado) {
    return comLayout(
      <ChamadoDetail
        chamado={selecionado}
        token={token}
        idUsuarioLogado={usuario.id}
        nivelAcesso={usuario.nivelAcesso}
        onBack={() => setModo("lista")}
        onEdit={abrirEdicao}
        onDelete={(chamado) => void excluirChamado(chamado)}
      />,
    );
  }

  return comLayout(
    <ChamadosList
      usuarioNome={usuario.nome}
      chamados={chamados}
      erro={erro ?? erroDados}
      onNovo={abrirNovo}
      onDetalhe={(id) => void abrirDetalhe(id)}
      onEditar={abrirEdicao}
      onExcluir={(chamado) => void excluirChamado(chamado)}
      onSair={onSair}
    />,
  );
}

export default ChamadosScreen;
