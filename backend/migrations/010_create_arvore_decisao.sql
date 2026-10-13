-- Add migration script here
-- US-19: Modelagem da árvore de decisão (triagem) no banco
-- Baseada no TCC (seção 2.3.3 e diagrama de classes, Figura 4):
--   NoDecisao    -> no_decisao      (pergunta, tipoNo, solucaoSugerida, ativo)
--   FluxoTriagem -> fluxo_triagem   (execução da triagem de um usuário:
--                                    idChamado, idUsuario, noAtual, historico,
--                                    concluido, dataInicio)
--   Conexões entre nós por opção de resposta -> opcao_resposta
--     (o diagrama prevê NoDecisao.listarOpcoes(), mas não modela a tabela)

-- ---------------------------------------------------------------
-- Nó da árvore: pergunta, sugestão de solução ou etapa final
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS no_decisao (
    id                SERIAL PRIMARY KEY,
    pergunta          VARCHAR(500)  NOT NULL,   -- texto exibido ao usuário neste nó
    tipo_no           VARCHAR(50)   NOT NULL
                      CHECK (tipo_no IN ('pergunta', 'sugestao_solucao', 'etapa_final')),
    solucao_sugerida  VARCHAR(1000),            -- obrigatória em 'sugestao_solucao'
    eh_raiz           BOOLEAN       NOT NULL DEFAULT FALSE,
    ativo             BOOLEAN       NOT NULL DEFAULT TRUE,
    data_criacao      TIMESTAMP     NOT NULL DEFAULT NOW(),

    CONSTRAINT ck_no_solucao_obrigatoria
        CHECK (tipo_no <> 'sugestao_solucao' OR solucao_sugerida IS NOT NULL),

    -- Chave única auxiliar: permite FK composta (id, tipo_no) em opcao_resposta
    CONSTRAINT uq_no_decisao_id_tipo UNIQUE (id, tipo_no)
);

-- Uma única pergunta inicial ("pergunta principal") para toda a árvore
CREATE UNIQUE INDEX IF NOT EXISTS uq_no_decisao_raiz
    ON no_decisao (eh_raiz) WHERE eh_raiz;

-- ---------------------------------------------------------------
-- Opção de resposta: aresta da árvore (nó origem --resposta--> nó destino)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS opcao_resposta (
    id               SERIAL PRIMARY KEY,
    id_no_origem     INTEGER      NOT NULL,
    tipo_no_origem   VARCHAR(50)  NOT NULL,
    id_no_destino    INTEGER      NOT NULL REFERENCES no_decisao(id) ON DELETE CASCADE,
    texto            VARCHAR(200) NOT NULL,  -- ex.: "Sim", "Não", "Resolveu"
    ordem            INTEGER      NOT NULL DEFAULT 0,

    -- Etapa final é terminal: não pode ter opções saindo dela
    CONSTRAINT fk_opcao_origem FOREIGN KEY (id_no_origem, tipo_no_origem)
        REFERENCES no_decisao(id, tipo_no) ON DELETE CASCADE,
    CONSTRAINT ck_opcao_origem_nao_terminal
        CHECK (tipo_no_origem IN ('pergunta', 'sugestao_solucao')),

    CONSTRAINT ck_opcao_sem_autoreferencia CHECK (id_no_origem <> id_no_destino),
    CONSTRAINT uq_opcao_texto_por_no UNIQUE (id_no_origem, texto)
);

CREATE INDEX IF NOT EXISTS idx_opcao_origem  ON opcao_resposta(id_no_origem);
CREATE INDEX IF NOT EXISTS idx_opcao_destino ON opcao_resposta(id_no_destino);

-- ---------------------------------------------------------------
-- Fluxo de triagem: percurso de um usuário pela árvore
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fluxo_triagem (
    id            SERIAL PRIMARY KEY,
    -- Nulo enquanto a triagem não gerou chamado (vinculado ao concluir)
    id_chamado    INTEGER REFERENCES chamado(id) ON DELETE SET NULL,
    id_usuario    INTEGER NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
    no_atual      INTEGER NOT NULL REFERENCES no_decisao(id) ON DELETE RESTRICT,
    historico     TEXT    NOT NULL DEFAULT '',  -- etapas percorridas (perguntas e respostas)
    concluido     BOOLEAN NOT NULL DEFAULT FALSE,
    data_inicio   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fluxo_triagem_usuario ON fluxo_triagem(id_usuario);
CREATE INDEX IF NOT EXISTS idx_fluxo_triagem_chamado ON fluxo_triagem(id_chamado);
CREATE INDEX IF NOT EXISTS idx_fluxo_triagem_no_atual ON fluxo_triagem(no_atual);