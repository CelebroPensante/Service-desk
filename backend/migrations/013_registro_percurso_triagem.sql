-- Add migration script here
-- US-24: Registro do percurso da triagem
-- Baseada no TCC (seção 2.3.3): "Durante todo o processo de triagem, o sistema
-- registra as etapas percorridas pelo usuário, incluindo as perguntas
-- apresentadas e as respostas selecionadas. Essas informações são armazenadas
-- para fins de auditoria, análise de padrões de utilização e identificação de
-- problemas recorrentes." (Figura 4: FluxoTriagem.historico)
--
-- Decisão de modelagem:
--   * passo_triagem é a fonte da verdade: uma linha por pergunta respondida,
--     o que permite consultar e agregar (padrões, problemas recorrentes).
--   * fluxo_triagem.historico (TEXT, já existente) passa a guardar o mesmo
--     percurso em texto legível, pronto para o relatório de triagem (US-29).
--   * Pergunta e resposta são gravadas como TEXTO (cópia do momento): se o
--     fluxo for editado depois (US-25), o registro de auditoria não muda.

CREATE TABLE IF NOT EXISTS passo_triagem (
    id              SERIAL PRIMARY KEY,
    id_fluxo        INTEGER      NOT NULL REFERENCES fluxo_triagem(id) ON DELETE CASCADE,
    ordem           INTEGER      NOT NULL CHECK (ordem > 0),
    id_no           INTEGER      NOT NULL REFERENCES no_decisao(id) ON DELETE RESTRICT,
    pergunta        VARCHAR(500) NOT NULL,   -- pergunta apresentada (cópia)
    -- Nulo quando a resposta não é uma opção da árvore (ex.: "Resolveu o meu problema")
    id_opcao        INTEGER      REFERENCES opcao_resposta(id) ON DELETE SET NULL,
    resposta        VARCHAR(200) NOT NULL,   -- resposta selecionada (cópia)
    data_resposta   TIMESTAMP    NOT NULL DEFAULT NOW(),

    -- Os passos de uma triagem são numerados 1, 2, 3... sem repetição
    CONSTRAINT uq_passo_ordem_por_fluxo UNIQUE (id_fluxo, ordem)
);

CREATE INDEX IF NOT EXISTS idx_passo_triagem_no ON passo_triagem(id_no);

-- ---------------------------------------------------------------
-- Respostas mais frequentes por pergunta (padrões de utilização)
-- ---------------------------------------------------------------
CREATE OR REPLACE VIEW vw_respostas_frequentes AS
SELECT
    p.id_no,
    p.pergunta,
    p.resposta,
    COUNT(*) AS vezes,
    ROUND(
        100.0 * COUNT(*) / SUM(COUNT(*)) OVER (PARTITION BY p.id_no, p.pergunta),
        1
    ) AS percentual_da_pergunta
FROM passo_triagem p
GROUP BY p.id_no, p.pergunta, p.resposta;