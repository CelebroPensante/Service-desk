// aqui tem uma UI Bem basica, kaua pode modularizar isso aqui e deixar mais :waq
import { useEffect, useState, type FormEvent } from "react";
import type {
  CategoriaResumo,
  Chamado,
  PrioridadeResumo,
  Usuario,
} from "../types";

const API_URL = "http://localhost:8080";

type Modo = "lista" | "novo" | "detalhe" | "editar";

interface ChamadosScreenProps {
  usuario: Usuario;
  token: string;
  onSair: () => void;
}

interface ChamadoForm {
  titulo: string;
  descricaoDetalhada: string;
  idCategoria: string;
  idPrioridade: string;
}

const FORM_VAZIO: ChamadoForm = {
  titulo: "",
  descricaoDetalhada: "",
  idCategoria: "",
  idPrioridade: "",
};

function ChamadosScreen({ usuario, token, onSair }: ChamadosScreenProps) {
  const [chamados, setChamados] = useState<Chamado[]>([]);
  const [categorias, setCategorias] = useState<CategoriaResumo[]>([]);
  const [prioridades, setPrioridades] = useState<PrioridadeResumo[]>([]);

  const [modo, setModo] = useState<Modo>("lista");
  const [selecionado, setSelecionado] = useState<Chamado | null>(null);
  const [form, setForm] = useState<ChamadoForm>(FORM_VAZIO);

  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const headers = new Headers(options.headers);

    headers.set("Authorization", `Bearer ${token}`);

    if (options.body) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);

      throw new Error(data?.erro ?? `Erro na requisição (${response.status})`);
    }

    return response.json() as Promise<T>;
  }

  async function carregarChamados() {
    const resultado = await request<Chamado[]>("/api/chamados");
    setChamados(resultado);
  }

  async function carregarDados() {
    setLoading(true);
    setErro(null);

    try {
      const [novosChamados, novasCategorias, novasPrioridades] =
        await Promise.all([
          request<Chamado[]>("/api/chamados"),
          request<CategoriaResumo[]>("/api/chamados/categorias"),
          request<PrioridadeResumo[]>("/api/chamados/prioridades"),
        ]);

      setChamados(novosChamados);
      setCategorias(novasCategorias);
      setPrioridades(novasPrioridades);
    } catch (e) {
      setErro(
        e instanceof Error
          ? e.message
          : "Não foi possível carregar os chamados.",
      );
    } finally {
      setLoading(false);
    }
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

  async function abrirDetalhe(id: number) {
    setErro(null);

    try {
      const chamado = await request<Chamado>(`/api/chamados/${id}`);

      setSelecionado(chamado);
      setModo("detalhe");
    } catch (e) {
      setErro(
        e instanceof Error
          ? e.message
          : "Não foi possível consultar o chamado.",
      );
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

  async function salvarChamado(e: FormEvent) {
    e.preventDefault();

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
        await request<Chamado>(`/api/chamados/${selecionado.id}`, {
          method: "PUT",
          body,
        });
      } else {
        await request<Chamado>("/api/chamados", {
          method: "POST",
          body,
        });
      }

      await carregarChamados();

      setSelecionado(null);
      setForm(FORM_VAZIO);
      setModo("lista");
    } catch (e) {
      setErro(
        e instanceof Error ? e.message : "Não foi possível salvar o chamado.",
      );
    } finally {
      setSalvando(false);
    }
  }

  async function excluirChamado(chamado: Chamado) {
    const confirmado = window.confirm(
      `Deseja excluir o chamado "${chamado.titulo}"?`,
    );

    if (!confirmado) {
      return;
    }

    setErro(null);

    try {
      await request<{ mensagem: string }>(`/api/chamados/${chamado.id}`, {
        method: "DELETE",
      });

      await carregarChamados();

      if (selecionado?.id === chamado.id) {
        setSelecionado(null);
        setModo("lista");
      }
    } catch (e) {
      setErro(
        e instanceof Error ? e.message : "Não foi possível excluir o chamado.",
      );
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        Carregando chamados...
      </div>
    );
  }

  if (modo === "novo" || modo === "editar") {
    return (
      <div className="min-h-screen bg-slate-50 p-8">
        <div className="max-w-2xl mx-auto bg-white border rounded-lg p-6">
          <h1 className="text-xl font-semibold mb-6">
            {modo === "novo" ? "Abrir novo chamado" : "Editar chamado"}
          </h1>

          <form onSubmit={salvarChamado} className="space-y-4">
            <div>
              <label
                htmlFor="titulo"
                className="block text-sm font-medium mb-1"
              >
                Título
              </label>

              <input
                id="titulo"
                required
                value={form.titulo}
                onChange={(e) =>
                  setForm({
                    ...form,
                    titulo: e.target.value,
                  })
                }
                className="w-full border rounded-md px-3 py-2"
              />
            </div>

            <div>
              <label
                htmlFor="descricao"
                className="block text-sm font-medium mb-1"
              >
                Descrição
              </label>

              <textarea
                id="descricao"
                required
                rows={6}
                value={form.descricaoDetalhada}
                onChange={(e) =>
                  setForm({
                    ...form,
                    descricaoDetalhada: e.target.value,
                  })
                }
                className="w-full border rounded-md px-3 py-2"
              />
            </div>

            <div>
              <label
                htmlFor="categoria"
                className="block text-sm font-medium mb-1"
              >
                Categoria
              </label>

              <select
                id="categoria"
                required
                value={form.idCategoria}
                onChange={(e) =>
                  setForm({
                    ...form,
                    idCategoria: e.target.value,
                  })
                }
                className="w-full border rounded-md px-3 py-2"
              >
                <option value="">Selecione</option>

                {categorias.map((categoria) => (
                  <option key={categoria.id} value={categoria.id}>
                    {categoria.categoria}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="prioridade"
                className="block text-sm font-medium mb-1"
              >
                Prioridade
              </label>

              <select
                id="prioridade"
                required
                value={form.idPrioridade}
                onChange={(e) =>
                  setForm({
                    ...form,
                    idPrioridade: e.target.value,
                  })
                }
                className="w-full border rounded-md px-3 py-2"
              >
                <option value="">Selecione</option>

                {prioridades.map((prioridade) => (
                  <option key={prioridade.id} value={prioridade.id}>
                    {prioridade.prioridade}
                  </option>
                ))}
              </select>
            </div>

            {erro && <p className="text-sm text-red-600">{erro}</p>}

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={salvando}
                className="bg-blue-600 text-white rounded-md px-4 py-2 disabled:opacity-50"
              >
                {salvando
                  ? "Salvando..."
                  : modo === "novo"
                    ? "Abrir chamado"
                    : "Salvar alterações"}
              </button>

              <button
                type="button"
                onClick={() => setModo("lista")}
                className="border rounded-md px-4 py-2"
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  if (modo === "detalhe" && selecionado) {
    return (
      <div className="min-h-screen bg-slate-50 p-8">
        <div className="max-w-2xl mx-auto bg-white border rounded-lg p-6">
          <button
            onClick={() => setModo("lista")}
            className="text-blue-600 text-sm mb-5"
          >
            ← Voltar
          </button>

          <h1 className="text-2xl font-semibold">{selecionado.titulo}</h1>

          <p className="text-sm text-slate-500 mt-1">
            Chamado #{selecionado.id}
          </p>

          <div className="mt-6 space-y-3">
            <p>
              <strong>Status:</strong> {selecionado.status}
            </p>

            <p>
              <strong>Categoria:</strong> {selecionado.categoria}
            </p>

            <p>
              <strong>Prioridade:</strong> {selecionado.prioridade}
            </p>

            <div>
              <strong>Descrição:</strong>
              <p className="mt-1 whitespace-pre-wrap">
                {selecionado.descricaoDetalhada}
              </p>
            </div>

            <p className="text-sm text-slate-500">
              Aberto em:{" "}
              {new Date(selecionado.dataAbertura).toLocaleString("pt-BR")}
            </p>
          </div>

          <div className="flex gap-2 mt-6">
            <button
              onClick={() => abrirEdicao(selecionado)}
              className="bg-blue-600 text-white rounded-md px-4 py-2"
            >
              Editar
            </button>

            <button
              onClick={() => void excluirChamado(selecionado)}
              className="bg-red-600 text-white rounded-md px-4 py-2"
            >
              Excluir
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex justify-between items-start mb-8">
          <div>
            <h1 className="text-2xl font-semibold">Chamados</h1>

            <p className="text-sm text-slate-500 mt-1">
              Usuário: {usuario.nome}
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={abrirNovo}
              className="bg-blue-600 text-white rounded-md px-4 py-2"
            >
              Novo chamado
            </button>

            <button onClick={onSair} className="border rounded-md px-4 py-2">
              Sair
            </button>
          </div>
        </div>

        {erro && (
          <p className="mb-4 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">
            {erro}
          </p>
        )}

        {chamados.length === 0 ? (
          <div className="bg-white border rounded-lg p-8 text-center text-slate-500">
            Nenhum chamado encontrado.
          </div>
        ) : (
          <div className="bg-white border rounded-lg overflow-hidden">
            {chamados.map((chamado) => (
              <div
                key={chamado.id}
                className="p-4 border-b last:border-b-0 flex justify-between gap-4"
              >
                <div>
                  <h2 className="font-medium">
                    #{chamado.id} — {chamado.titulo}
                  </h2>

                  <p className="text-sm text-slate-500 mt-1">
                    {chamado.categoria} · {chamado.prioridade} ·{" "}
                    {chamado.status}
                  </p>
                </div>

                <div className="flex gap-2 items-center">
                  <button
                    onClick={() => void abrirDetalhe(chamado.id)}
                    className="text-blue-600 text-sm"
                  >
                    Ver
                  </button>

                  <button
                    onClick={() => abrirEdicao(chamado)}
                    className="text-blue-600 text-sm"
                  >
                    Editar
                  </button>

                  <button
                    onClick={() => void excluirChamado(chamado)}
                    className="text-red-600 text-sm"
                  >
                    Excluir
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ChamadosScreen;
