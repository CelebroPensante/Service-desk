import Comentarios from './Comentarios'

// ChamadoDetalhes.tsx
interface ChamadoDetalhesProps {
  idChamado: number
  token: string
  idUsuarioLogado: number
  onVoltar: () => void
}

function ChamadoDetalhes({ idChamado, token, idUsuarioLogado, onVoltar }: ChamadoDetalhesProps) {
  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-md mx-auto space-y-4">
        <button onClick={onVoltar} className="text-sm text-blue-600 hover:underline">
          ← Voltar
        </button>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs text-slate-400">Chamado #{idChamado}</p>
          <h1 className="text-lg font-semibold text-slate-900">
            (placeholder — tela real de chamado ainda não existe)
          </h1>
        </div>

        <Comentarios idChamado={idChamado} token={token} idUsuarioLogado={idUsuarioLogado} />
      </div>
    </div>
  )
}

export default ChamadoDetalhes