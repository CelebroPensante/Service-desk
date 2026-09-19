export interface Usuario {
  id: number
  idCargo: number
  nome: string
  email: string
  setor?: string
  dataCadastro: string
  ativo: boolean
  cargo: string
  nivelAcesso: number
}

export interface AuthResponse {
  token: string
  usuario: Usuario
}

export interface CargoResumo {
  id: number
  idPermissao: number
  cargo: string
  nivel: number
  descricao: string
}

export interface NivelPermissao {
  id: number
  nivel: number
  descricao: string
}

export interface UsuarioResumo {
  id: number
  nome: string
  email: string
  cargo: string
  idCargo: number
  ativo: boolean
}

export interface MensagemChat {
  id: number
  idChamado: number
  idUsuario: number
  texto: string
  dataEnvio: string
  nomeUsuario?: string // ainda não vem do backend, ver pendências
}