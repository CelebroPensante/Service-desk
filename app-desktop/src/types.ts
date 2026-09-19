export interface Usuario {
  id: number;
  idCargo: number;
  nome: string;
  email: string;
  setor?: string;
  dataCadastro: string;
  ativo: boolean;
  cargo: string;
  nivelAcesso: number;
}

export interface AuthResponse {
  token: string;
  usuario: Usuario;
}

export interface CargoResumo {
  id: number;
  idPermissao: number;
  cargo: string;
  nivel: number;
  descricao: string;
}

export interface NivelPermissao {
  id: number;
  nivel: number;
  descricao: string;
}

export interface UsuarioResumo {
  id: number;
  nome: string;
  email: string;
  cargo: string;
  idCargo: number;
  ativo: boolean;
}

// tipos pra UI basica, o kaua falou que ele vai deixar tudo isso mais padronizado dps
export interface Chamado {
  id: number;
  idUsuario: number;
  idAtendente: number | null;
  idCategoria: number;
  idPrioridade: number;
  idStatus: number;
  titulo: string;
  descricaoDetalhada: string;
  categoria: string;
  prioridade: string;
  status: string;
  dataAbertura: string;
  dataResolucao: string | null;
  dataAtualizacao: string;
}

export interface CategoriaResumo {
  id: number;
  categoria: string;
}

export interface PrioridadeResumo {
  id: number;
  nivel: number;
  prioridade: string;
}
