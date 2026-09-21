import type { Chamado } from "../../types";
import Comentarios from "./Comentarios";
import Chat from "./Chat";

interface ChamadoDetailProps {
  chamado: Chamado;
  token: string;
  idUsuarioLogado: number;
  onBack: () => void;
  onEdit: (chamado: Chamado) => void;
  onDelete: (chamado: Chamado) => void;
}

export default function ChamadoDetail({
  chamado,
  token,
  idUsuarioLogado,
  onBack,
  onEdit,
  onDelete,
}: ChamadoDetailProps) {
  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="max-w-2xl mx-auto bg-white border rounded-lg p-6">
        <button onClick={onBack} className="text-blue-600 text-sm mb-5">
          ← Voltar
        </button>
        <h1 className="text-2xl font-semibold">{chamado.titulo}</h1>
        <p className="text-sm text-slate-500 mt-1">Chamado #{chamado.id}</p>

        <div className="mt-6 space-y-3">
          <p><strong>Status:</strong> {chamado.status}</p>
          <p><strong>Categoria:</strong> {chamado.categoria}</p>
          <p><strong>Prioridade:</strong> {chamado.prioridade}</p>
          <div>
            <strong>Descrição:</strong>
            <p className="mt-1 whitespace-pre-wrap">{chamado.descricaoDetalhada}</p>
          </div>
          <p className="text-sm text-slate-500">
            Aberto em: {new Date(chamado.dataAbertura).toLocaleString("pt-BR")}
          </p>
        </div>

        <div className="flex gap-2 mt-6">
          <button onClick={() => onEdit(chamado)} className="bg-blue-600 text-white rounded-md px-4 py-2">
            Editar
          </button>
          <button onClick={() => onDelete(chamado)} className="bg-red-600 text-white rounded-md px-4 py-2">
            Excluir
          </button>
        </div>

        <div className="mt-8 space-y-6">
          <Comentarios
            idChamado={chamado.id}
            token={token}
            idUsuarioLogado={idUsuarioLogado}
          />
          <Chat idChamado={chamado.id} token={token} />
        </div>
      </div>
    </div>
  );
}