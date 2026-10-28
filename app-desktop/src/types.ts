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
  // US-23: equipe para a qual o chamado foi encaminhado e triagem que o originou
  idSetor: number | null
  setor: string | null
  idFluxoTriagem: number | null
  dataAbertura: string
  dataResolucao: string | null
  dataAtualizacao: string
}

export interface CategoriaResumo {
  id: number
  categoria: string
}

// US-23: setor (equipe de atendimento)
export interface SetorResumo {
  id: number
  nome: string
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

export interface Anexo {
  id: number
  idChamado: number
  idUsuario: number
  nomeUsuario: string
  nomeOriginal: string
  tamanhoBytes: number
  tipoMime: string
  dataUpload: string
}

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

export interface DiscoTelemetria {
  pontoMontagem: string
  sistemaArquivos: string
  totalGb: number
  livreGb: number
  usoPercent: number
}

export interface ProcessoTelemetria {
  pid: number
  nome: string
  cpuUsagePercent: number
  memoriaMb: number
}

export interface MachineTelemetry {
  machineUid: string
  hostname: string
  usuarioSo: string
  osName: string
  osVersion: string
  cpuBrand: string
  cpuCores: number
  uptimeSeconds: number
  cpuUsagePercent: number
  memoriaTotalMb: number
  memoriaUsadaMb: number
  memoriaUsoPercent: number
  swapTotalMb: number
  swapUsadaMb: number
  discos: DiscoTelemetria[]
  topProcessos: ProcessoTelemetria[]
  statusConexao: 'online' | 'offline' | string
  ultimoHeartbeat: string
  coletadoEmUnixMs: number
}

export interface RelatorioAutoavaliacao {
  id: number
  idChamado?: number
  idMaquina?: number
  machineUid: string
  hostname: string
  usuarioSo: string
  sistemaOperacional: string
  versaoSo: string
  modeloCpu: string
  nucleosCpu: number
  uptimeSegundos: number
  cpuUsagePercent: number
  memoriaTotalMb: number
  memoriaUsadaMb: number
  memoriaUsoPercent: number
  swapTotalMb: number
  swapUsadaMb: number
  discos: DiscoTelemetria[]
  topProcessos: ProcessoTelemetria[]
  coletadoEm: string
}
