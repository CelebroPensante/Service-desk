// Tipos da triagem por árvore de decisão (US-20/US-21/US-22/US-23).
// Espelham a resposta da API em /api/triagem.

export interface NoTriagem {
  id: number
  pergunta: string
  tipoNo: 'pergunta' | 'sugestao_solucao' | 'etapa_final'
  solucaoSugerida: string | null
  // US-22: passo a passo da sugestão de solução (vazio nos outros tipos de nó)
  passos: string[]
}

export interface OpcaoTriagem {
  id: number
  texto: string
}

// US-23: como a etapa final preenche o chamado (cada campo é nulo se a etapa não o define)
export interface PreenchimentoChamado {
  idCategoria: number | null
  categoria: string | null
  idPrioridade: number | null
  prioridade: string | null
  idSetor: number | null
  setor: string | null
}

export interface EstadoTriagem {
  idFluxo: number
  concluido: boolean
  // 'abrir_chamado': chegou a uma etapa final | 'resolvido': usuário confirmou a solução sugerida
  resultado: 'abrir_chamado' | 'resolvido' | null
  noAtual: NoTriagem
  opcoes: OpcaoTriagem[]
  podeResolver: boolean
  // US-23: só vem na etapa final
  preenchimento: PreenchimentoChamado | null
}