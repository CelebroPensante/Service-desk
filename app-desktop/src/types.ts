export interface UsuarioResumo {
  id: number
  nome: string
  email: string
  cargo: string
  idCargo: number
  ativo: boolean
}

// tipos pra UI básica, o kaua falou que ele vai deixar tudo isso mais padronizado dps
export interface Chamado {
  id: number
  idUsuario: number
  idAtendente: number | null
  idCategoria: number
  idPrioridade: number
  idStatus: number
  titulo: string
  descricaoDetalhada: string
  categoria: string
  prioridade: string
  status: string
  dataAbertura: string
  dataResolucao: string | null
  dataAtualizacao: string
}

export interface CategoriaResumo {
  id: number
  categoria: string
}

export interface PrioridadeResumo {
  id: number
  nivel: number
  prioridade: string
}

export interface MensagemChat {
  id: number
  idChamado: number
  idUsuario: number
  texto: string
  dataEnvio: string
  nomeUsuario?: string
}