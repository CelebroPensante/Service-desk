-- Add migration script here
-- US-23: Preenchimento automático do chamado pela triagem
-- Baseada no TCC (seção 2.3.3): "Ao final da triagem, o sistema pode [...]
-- preencher automaticamente informações relacionadas ao chamado, como
-- categoria, prioridade e setor responsável, ou encaminhar diretamente a
-- solicitação para a equipe mais adequada ao atendimento da ocorrência."
-- (Figura 4: FluxoTriagem.idChamado liga a triagem ao chamado que ela gerou.)
--
-- O que esta migration faz:
--   1) setor: equipes de atendimento (o "setor responsável" do TCC).
--   2) atendente.id_setor: a que equipe cada técnico pertence.
--   3) chamado.id_setor: equipe para a qual o chamado foi encaminhado.
--   4) no_decisao: a ETAPA FINAL passa a definir categoria, prioridade e setor.
--   5) fluxo_triagem.id_chamado: no máximo uma triagem por chamado (e vice-versa).
--   6) Seed: nós finais do "computador não liga" preenchidos.

-- ---------------------------------------------------------------
-- 1) Setores (equipes de atendimento)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS setor (
    id      SERIAL PRIMARY KEY,
    nome    VARCHAR(100) NOT NULL UNIQUE,
    ativo   BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO setor (nome) VALUES
    ('Infraestrutura'),
    ('Redes'),
    ('Sistemas'),
    ('Segurança e Acessos')
ON CONFLICT (nome) DO NOTHING;

-- ---------------------------------------------------------------
-- 2) e 3) Técnico e chamado passam a ter setor (opcional)
--     ON DELETE SET NULL: apagar um setor não apaga técnicos nem chamados.
-- ---------------------------------------------------------------
ALTER TABLE atendente
    ADD COLUMN IF NOT EXISTS id_setor INTEGER REFERENCES setor(id) ON DELETE SET NULL;

ALTER TABLE chamado
    ADD COLUMN IF NOT EXISTS id_setor INTEGER REFERENCES setor(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_atendente_setor ON atendente(id_setor);
CREATE INDEX IF NOT EXISTS idx_chamado_setor   ON chamado(id_setor);

-- ---------------------------------------------------------------
-- 4) A etapa final define como o chamado será preenchido.
--    Colunas opcionais (NULL = "a triagem não define; o usuário escolhe"),
--    mas só nós do tipo etapa_final podem tê-las.
-- ---------------------------------------------------------------
ALTER TABLE no_decisao
    ADD COLUMN IF NOT EXISTS id_categoria  INTEGER REFERENCES categoria(id)  ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS id_prioridade INTEGER REFERENCES prioridade(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS id_setor      INTEGER REFERENCES setor(id)      ON DELETE RESTRICT;

ALTER TABLE no_decisao
    ADD CONSTRAINT ck_no_preenchimento_so_etapa_final
    CHECK (tipo_no = 'etapa_final'
           OR (id_categoria IS NULL AND id_prioridade IS NULL AND id_setor IS NULL));

-- ---------------------------------------------------------------
-- 5) Uma triagem gera no máximo um chamado, e um chamado vem de no
--    máximo uma triagem (fluxo_triagem.id_chamado já existia desde a US-19).
-- ---------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_fluxo_triagem_chamado
    ON fluxo_triagem(id_chamado) WHERE id_chamado IS NOT NULL;

-- ---------------------------------------------------------------
-- 6) Seed: etapas finais da árvore "computador não liga".
--    Só preenche nós ainda sem definição (não sobrescreve edição manual).
-- ---------------------------------------------------------------
UPDATE no_decisao SET
    id_categoria  = (SELECT id FROM categoria  WHERE categoria  = 'Hardware'),
    id_prioridade = (SELECT id FROM prioridade WHERE prioridade = 'Alta'),
    id_setor      = (SELECT id FROM setor      WHERE nome       = 'Infraestrutura')
WHERE tipo_no = 'etapa_final'
  AND pergunta = 'Abrir chamado: falha de hardware'
  AND id_categoria IS NULL AND id_prioridade IS NULL AND id_setor IS NULL;

UPDATE no_decisao SET
    id_categoria  = (SELECT id FROM categoria  WHERE categoria  = 'Software'),
    id_prioridade = (SELECT id FROM prioridade WHERE prioridade = U&'M\00E9dia'),
    id_setor      = (SELECT id FROM setor      WHERE nome       = 'Sistemas')
WHERE tipo_no = 'etapa_final'
  AND pergunta = 'Abrir chamado: problema de software'
  AND id_categoria IS NULL AND id_prioridade IS NULL AND id_setor IS NULL;
