// Tipos da triagem por árvore de decisão (US-20/US-21).
// Espelham a resposta da API em /api/triagem.

export interface NoTriagem {
  id: number
  pergunta: string
  tipoNo: 'pergunta' | 'sugestao_solucao' | 'etapa_final'
  solucaoSugerida: string | null
}

export interface OpcaoTriagem {
  id: number
  texto: string
}

export interface EstadoTriagem {
  idFluxo: number
  concluido: boolean
  // 'abrir_chamado': chegou a uma etapa final | 'resolvido': usuário confirmou a solução sugerida
  resultado: 'abrir_chamado' | 'resolvido' | null
  noAtual: NoTriagem
  opcoes: OpcaoTriagem[]
  podeResolver: boolean
}