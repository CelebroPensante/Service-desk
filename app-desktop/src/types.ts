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