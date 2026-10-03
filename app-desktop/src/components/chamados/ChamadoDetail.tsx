import type { Chamado } from "../../types";
import Comentarios from "./Comentarios";
import Chat from "./Chat";
import Anexos from "./Anexos";

interface ChamadoDetailProps {
  chamado: Chamado;
  token: string;
  idUsuarioLogado: number;
  onBack: () => void;
  onEdit: (chamado: Chamado) => void;
  onDelete: (chamado: Chamado) => void;
}

// Cores dos badges (ajuste as chaves conforme os valores reais do seu backend)
const prioridadeStyles: Record<string, string> = {
  alta: "bg-red-50 text-red-600 border-red-200",
  media: "bg-amber-50 text-amber-600 border-amber-200",
  média: "bg-amber-50 text-amber-600 border-amber-200",
  baixa: "bg-emerald-50 text-emerald-600 border-emerald-200",
};

const statusStyles: Record<string, string> = {
  aberto: "bg-amber-50 text-amber-600 border-amber-200",
  "em andamento": "bg-blue-50 text-blue-600 border-blue-200",
  fechado: "bg-slate-100 text-slate-600 border-slate-200",
  finalizado: "bg-emerald-50 text-emerald-600 border-emerald-200",
};

function Badge({ text, styles }: { text: string; styles: Record<string, string> }) {
  const cls = styles[text?.toLowerCase()] ?? "bg-slate-100 text-slate-600 border-slate-200";
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${cls}`}>
      {text}
    </span>
  );
}

function formatarData(data: string) {
  const d = new Date(data);
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ChamadoDetail({
  chamado,
  token,
  idUsuarioLogado,
  onBack,
  onEdit,
  onDelete,
}: ChamadoDetailProps) {
  const codigo = `CHM-${String(chamado.id).padStart(4, "0")}`;

  return (
    <div className="min-h-screen bg-slate-50 px-8 py-6">
      <div className="max-w-6xl mx-auto">
        {/* Voltar */}
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 mb-5"
        >
          <span aria-hidden>←</span> Voltar para chamados
        </button>

        {/* Cabeçalho do chamado */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-mono text-slate-500">{codigo}</span>
                <Badge text={chamado.prioridade} styles={prioridadeStyles} />
                <Badge text={chamado.status} styles={statusStyles} />
              </div>

              <h1 className="text-2xl font-bold text-slate-900 break-words">
                {chamado.titulo}
              </h1>

              <p className="mt-2 text-sm text-slate-500 whitespace-pre-wrap">
                {chamado.descricaoDetalhada}
              </p>

              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-500">
                <span>
                  Categoria:{" "}
                  <strong className="text-slate-800 font-semibold">{chamado.categoria}</strong>
                </span>
                <span>
                  Aberto em:{" "}
                  <strong className="text-slate-800 font-semibold">
                    {formatarData(chamado.dataAbertura)}
                  </strong>
                </span>
              </div>
            </div>

            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => onEdit(chamado)}
                className="border border-slate-300 bg-white text-slate-800 text-sm font-medium rounded-lg px-4 py-2 hover:bg-slate-50"
              >
                Editar
              </button>
              <button
                onClick={() => onDelete(chamado)}
                className="bg-red-600 text-white text-sm font-medium rounded-lg px-4 py-2 hover:bg-red-700"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>

        {/* Conteúdo em duas colunas */}
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Coluna esquerda: conversa */}
          <section className="lg:col-span-3">
            <h2 className="text-sm font-semibold text-slate-800 mb-2">Conversa</h2>
            <Chat idChamado={chamado.id} token={token} idUsuarioLogado={idUsuarioLogado} />
          </section>

          {/* Coluna direita: anexos e comentários */}
          <aside className="lg:col-span-2 space-y-6">
            <div>
              <h2 className="text-sm font-semibold text-slate-800 mb-2">Anexos</h2>
              <Anexos idChamado={chamado.id} token={token} idUsuarioLogado={idUsuarioLogado} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-800 mb-2">Comentários</h2>
              <Comentarios
                idChamado={chamado.id}
                token={token}
                idUsuarioLogado={idUsuarioLogado}
              />
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}