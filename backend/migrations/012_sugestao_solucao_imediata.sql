-- Add migration script here
-- US-22: Sugestão de solução imediata
-- Baseada no TCC (seção 2.3.3): "Ao final da triagem, o sistema pode apresentar
-- orientações para resolução imediata do problema" e "o sistema registra as
-- etapas percorridas pelo usuário [...] para fins de auditoria, análise de
-- padrões de utilização e identificação de problemas recorrentes".
--
-- O que esta migration faz:
--   1) sugestao_triagem: registra cada sugestão exibida em uma triagem e se o
--      usuário confirmou que ela resolveu (base da análise de eficiência).
--   2) vw_eficiencia_sugestao: taxa de resolução de cada sugestão de solução.
--   3) vw_resumo_triagem: quantas triagens resolveram sem chamado (chamados evitados).
--   4) Reescreve a sugestão do seed como passo a passo (um passo por linha).
--
-- Convenção do passo a passo: nó.solucao_sugerida guarda um passo por linha
-- (quebra de linha). A API devolve os passos separados em "passos".

-- ---------------------------------------------------------------
-- 1) Registro das sugestões exibidas e do resultado de cada uma
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sugestao_triagem (
    id              SERIAL PRIMARY KEY,
    id_fluxo        INTEGER      NOT NULL REFERENCES fluxo_triagem(id) ON DELETE CASCADE,
    id_no           INTEGER      NOT NULL,
    -- Sempre 'sugestao_solucao'; com a FK composta abaixo o banco garante que
    -- só nós desse tipo são registrados aqui (mesma técnica da US-19).
    tipo_no         VARCHAR(50)  NOT NULL DEFAULT 'sugestao_solucao'
                    CHECK (tipo_no = 'sugestao_solucao'),
    data_exibicao   TIMESTAMP    NOT NULL DEFAULT NOW(),
    -- TRUE: o usuário confirmou que resolveu | FALSE: seguiu para o chamado
    -- NULL: ainda sem resposta (ou triagem abandonada)
    resolveu        BOOLEAN,
    data_resposta   TIMESTAMP,

    CONSTRAINT fk_sugestao_no FOREIGN KEY (id_no, tipo_no)
        REFERENCES no_decisao(id, tipo_no) ON DELETE RESTRICT,
    CONSTRAINT ck_sugestao_resposta_coerente
        CHECK ((resolveu IS NULL) = (data_resposta IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_sugestao_triagem_fluxo ON sugestao_triagem(id_fluxo);
CREATE INDEX IF NOT EXISTS idx_sugestao_triagem_no    ON sugestao_triagem(id_no);

-- No máximo uma sugestão aguardando resposta por triagem
CREATE UNIQUE INDEX IF NOT EXISTS uq_sugestao_pendente_por_fluxo
    ON sugestao_triagem (id_fluxo) WHERE resolveu IS NULL;

-- ---------------------------------------------------------------
-- 2) Eficiência por sugestão de solução
-- ---------------------------------------------------------------
CREATE OR REPLACE VIEW vw_eficiencia_sugestao AS
SELECT
    n.id                                                   AS id_no,
    n.pergunta                                             AS sugestao,
    COUNT(*)                                               AS exibicoes,
    COUNT(*) FILTER (WHERE s.resolveu IS TRUE)             AS resolvidas,
    COUNT(*) FILTER (WHERE s.resolveu IS FALSE)            AS nao_resolvidas,
    COUNT(*) FILTER (WHERE s.resolveu IS NULL)             AS sem_resposta,
    -- taxa sobre as sugestões respondidas (sem contar as abandonadas)
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE s.resolveu IS TRUE)
        / NULLIF(COUNT(*) FILTER (WHERE s.resolveu IS NOT NULL), 0),
        1
    )                                                      AS taxa_resolucao_pct,
    -- tempo entre ver a sugestão e confirmar que resolveu
    ROUND(AVG(EXTRACT(EPOCH FROM (s.data_resposta - s.data_exibicao)))
          FILTER (WHERE s.resolveu IS TRUE))::INTEGER      AS tempo_medio_resolucao_s
FROM sugestao_triagem s
JOIN no_decisao n ON n.id = s.id_no
GROUP BY n.id, n.pergunta;

-- ---------------------------------------------------------------
-- 3) Resumo geral: quantas triagens evitaram a abertura de chamado
-- ---------------------------------------------------------------
CREATE OR REPLACE VIEW vw_resumo_triagem AS
SELECT
    COUNT(*)                                                           AS total_triagens,
    COUNT(*) FILTER (WHERE f.concluido AND n.tipo_no = 'sugestao_solucao') AS resolvidas_na_triagem,
    COUNT(*) FILTER (WHERE f.concluido AND n.tipo_no = 'etapa_final')      AS encaminhadas_para_chamado,
    COUNT(*) FILTER (WHERE NOT f.concluido)                            AS em_andamento_ou_abandonadas,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE f.concluido AND n.tipo_no = 'sugestao_solucao')
        / NULLIF(COUNT(*) FILTER (WHERE f.concluido), 0),
        1
    )                                                                  AS taxa_resolucao_pct
FROM fluxo_triagem f
JOIN no_decisao n ON n.id = f.no_atual;

-- ---------------------------------------------------------------
-- 4) Seed: sugestão do "computador não liga" como passo a passo.
--    Só altera se o texto ainda for o original (não sobrescreve edição manual).
-- ---------------------------------------------------------------
UPDATE no_decisao
SET solucao_sugerida =
    E'Verifique se o cabo de energia está bem encaixado na parte de trás do computador.\n'
 || E'Confira se a outra ponta está firme na tomada ou no filtro de linha (se puder, teste em outra tomada).\n'
 || E'Se o cabo estiver dobrado, amassado ou com a capa danificada, não o use e solicite a troca.\n'
 || E'Pressione o botão de ligar e aguarde alguns segundos.'
WHERE tipo_no = 'sugestao_solucao'
  AND pergunta = 'Sugestão: reconectar o cabo de energia'
  AND solucao_sugerida = 'Conecte o cabo de energia na tomada e no computador e tente ligar novamente.';