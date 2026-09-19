import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import type {
  CategoriaResumo,
  Chamado,
  PrioridadeResumo,
  Usuario,
} from "../types";
import ChamadoDetail from "../components/chamados/ChamadoDetail";
import ChamadoForm, {
  type ChamadoFormData,
} from "../components/chamados/ChamadoForm";
import ChamadosList from "../components/chamados/ChamadosList";
import AppLayout, { type Pagina } from "../components/layout/AppLayout";
import DashboardView from "../components/dashboard/DashboardView";
import PageContainer from "../components/layout/PageContainer";
import TecnicoPanel from "../components/tecnico/TecnicoPanel";
import UsersManager from "./admin/UsersManager";
import RolesManager from "./admin/RolesManager";

const API_URL = "http://localhost:8080";
// NOVO: "dashboard" é a tela inicial agora
type Modo =
  | "dashboard"
  | "lista"
  | "novo"
  | "detalhe"
  | "editar"
  | "tecnico"
  | "usuarios"
  | "cargos";

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
  const [modo, setModo] = useState<Modo>("dashboard");
  const [selecionado, setSelecionado] = useState<Chamado | null>(null);
  const [form, setForm] = useState<ChamadoFormData>(FORM_VAZIO);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // NOVO: erros de carga (categorias, prioridades, chamados), separados do erro de ações
  const [erroDados, setErroDados] = useState<string | null>(null);

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
      return response.json() as Promise<T>;
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

    const [rChamados, rCategorias, rPrioridades] = await Promise.allSettled([
      request<Chamado[]>("/api/chamados"),
      request<CategoriaResumo[]>("/api/chamados/categorias"),
      request<PrioridadeResumo[]>("/api/chamados/prioridades"),
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

    if (falhas.length > 0) {
      console.error("Falha ao carregar dados:", falhas);
      setErroDados(falhas.join(" | "));
    }
    setLoading(false);
  }

  useEffect(() => {
    void carregarDados();
  }, []);

  function abrirNovo() {
    setSelecionado(null);
    setForm(FORM_VAZIO);
    setErro(null);
    setModo("novo");
  }

  // Navegação da sidebar
  function navegar(pagina: Pagina) {
    setErro(null);
    setSelecionado(null);
    if (pagina === "novo") abrirNovo();
    else if (pagina === "chamados") setModo("lista");
    else setModo(pagina); // dashboard, tecnico, usuarios, cargos
  }

  // Qual item da sidebar fica destacado
  const paginaAtiva: Pagina =
    modo === "dashboard" || modo === "tecnico" || modo === "usuarios" || modo === "cargos"
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
      });
      if (modo === "editar" && selecionado) {
        await request<Chamado>(`/api/chamados/${selecionado.id}`, { method: "PUT", body });
      } else {
        await request<Chamado>("/api/chamados", { method: "POST", body });
      }
      await carregarChamados();
      setSelecionado(null);
      setForm(FORM_VAZIO);
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

  if (modo === "usuarios" && usuario.nivelAcesso >= 5) {
    return comLayout(
      <PageContainer
        titulo="Gestão de Usuários"
        subtitulo="Atribua cargos e gerencie o acesso dos usuários do sistema."
      >
        <UsersManager token={token} />
      </PageContainer>,
    );
  }

  if (modo === "cargos" && usuario.nivelAcesso >= 5) {
    return comLayout(
      <PageContainer
        titulo="Gestão de Cargos"
        subtitulo="Crie e configure os papéis de acesso e permissões."
      >
        <RolesManager token={token} />
      </PageContainer>,
    );
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

  if (modo === "novo" || modo === "editar") {
    return comLayout(
      <ChamadoForm
        modo={modo}
        form={form}
        categorias={ordenarCategorias(categorias)}
        prioridades={prioridades}
        erro={erro ?? erroDados}
        salvando={salvando}
        onSubmit={salvarChamado}
        onChange={alterarCampo}
        onCancel={() => setModo("lista")}
      />,
    );
  }

  if (modo === "detalhe" && selecionado) {
    return comLayout(
      <ChamadoDetail
        chamado={selecionado}
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