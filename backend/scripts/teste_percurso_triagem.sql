-- Teste da US-24 (registro do percurso da triagem). Roda tudo dentro de uma
-- transação e termina com ROLLBACK, então NÃO deixa nada no banco.
--   psql -d servicedesk -v ON_ERROR_STOP=1 -f teste_percurso_triagem.sql
-- (no pgAdmin: cole no Query Tool e veja a aba Messages)
-- Requer a migration 013 aplicada.

BEGIN;

-- Limpa a árvore e as triagens só dentro desta transação (volta no ROLLBACK).
DELETE FROM fluxo_triagem;      -- apaga passo_triagem em cascata
DELETE FROM opcao_resposta;
DELETE FROM no_decisao;

CREATE FUNCTION pg_temp.deve_falhar(descricao TEXT, comando TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE comando;
    RAISE NOTICE 'FALHOU - o banco aceitou: %', descricao;
EXCEPTION WHEN integrity_constraint_violation THEN
    RAISE NOTICE 'OK     - rejeitado: %', descricao;
END $$;

CREATE FUNCTION pg_temp.confere(descricao TEXT, condicao BOOLEAN) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
    IF condicao IS TRUE THEN RAISE NOTICE 'OK     - %', descricao;
    ELSE RAISE NOTICE 'FALHOU - %', descricao;
    END IF;
END $$;

-- ---------------------------------------------------------------
-- Massa de teste: P (pergunta) --Sim/Não--> F (etapa final)
-- ---------------------------------------------------------------
INSERT INTO no_decisao (pergunta, tipo_no, eh_raiz) VALUES
  ('P: o computador liga?', 'pergunta',    TRUE),
  ('F: abrir chamado',      'etapa_final', FALSE);

INSERT INTO opcao_resposta (id_no_origem, tipo_no_origem, id_no_destino, texto, ordem)
SELECT o.id, o.tipo_no, d.id, v.texto, v.ordem
FROM (VALUES ('Sim', 1), ('Não', 2)) AS v(texto, ordem)
JOIN no_decisao o ON o.pergunta = 'P: o computador liga?'
JOIN no_decisao d ON d.pergunta = 'F: abrir chamado';

INSERT INTO usuario (id_cargo, nome, email, senha_hash)
SELECT id, 'Teste Percurso', 'teste_percurso@exemplo.com', 'x' FROM cargo LIMIT 1;

INSERT INTO fluxo_triagem (id_usuario, no_atual)
SELECT u.id, n.id FROM usuario u, no_decisao n
WHERE u.email = 'teste_percurso@exemplo.com' AND n.pergunta = 'P: o computador liga?';

CREATE TEMP TABLE t AS
SELECT (SELECT id FROM fluxo_triagem LIMIT 1)                                   AS fluxo,
       (SELECT id FROM no_decisao WHERE pergunta = 'P: o computador liga?')     AS no_p,
       (SELECT id FROM opcao_resposta WHERE texto = 'Sim')                      AS op_sim,
       (SELECT id FROM opcao_resposta WHERE texto = 'Não')                      AS op_nao;

-- ---------------------------------------------------------------
-- 1) Registros válidos
-- ---------------------------------------------------------------
INSERT INTO passo_triagem (id_fluxo, ordem, id_no, pergunta, id_opcao, resposta)
SELECT fluxo, 1, no_p, 'P: o computador liga?', op_nao, 'Não' FROM t;

-- Resposta que não é opção da árvore (ex.: "Resolveu o meu problema")
INSERT INTO passo_triagem (id_fluxo, ordem, id_no, pergunta, id_opcao, resposta)
SELECT fluxo, 2, no_p, 'P: o computador liga?', NULL, 'Resolveu o meu problema' FROM t;

SELECT pg_temp.confere('2 passos registrados', (SELECT count(*) FROM passo_triagem) = 2);

-- ---------------------------------------------------------------
-- 2) O banco deve REJEITAR todos estes casos
-- ---------------------------------------------------------------
SELECT pg_temp.deve_falhar('mesma ordem repetida na mesma triagem',
  $f$INSERT INTO passo_triagem (id_fluxo, ordem, id_no, pergunta, resposta)
     SELECT fluxo, 1, no_p, 'x', 'y' FROM t$f$);

SELECT pg_temp.deve_falhar('ordem zero',
  $f$INSERT INTO passo_triagem (id_fluxo, ordem, id_no, pergunta, resposta)
     SELECT fluxo, 0, no_p, 'x', 'y' FROM t$f$);

SELECT pg_temp.deve_falhar('triagem inexistente',
  $f$INSERT INTO passo_triagem (id_fluxo, ordem, id_no, pergunta, resposta)
     SELECT 999999, 1, no_p, 'x', 'y' FROM t$f$);

SELECT pg_temp.deve_falhar('nó inexistente',
  $f$INSERT INTO passo_triagem (id_fluxo, ordem, id_no, pergunta, resposta)
     SELECT fluxo, 3, 999999, 'x', 'y' FROM t$f$);

SELECT pg_temp.deve_falhar('pergunta ou resposta em branco (NULL)',
  $f$INSERT INTO passo_triagem (id_fluxo, ordem, id_no, pergunta, resposta)
     SELECT fluxo, 3, no_p, NULL, NULL FROM t$f$);

-- ---------------------------------------------------------------
-- 3) O registro é cópia: editar/inativar a árvore não altera o percurso
-- ---------------------------------------------------------------
UPDATE no_decisao SET pergunta = 'P: texto EDITADO depois' WHERE pergunta = 'P: o computador liga?';
UPDATE opcao_resposta SET texto = 'Nao (editado)' WHERE texto = 'Não';

SELECT pg_temp.confere('percurso guarda a pergunta original após editar o nó',
  (SELECT pergunta = 'P: o computador liga?' FROM passo_triagem WHERE ordem = 1));
SELECT pg_temp.confere('percurso guarda a resposta original após editar a opção',
  (SELECT resposta = 'Não' FROM passo_triagem WHERE ordem = 1));

-- Excluir a opção usada mantém o passo (id_opcao vira NULL)
DELETE FROM opcao_resposta WHERE texto = 'Nao (editado)';
SELECT pg_temp.confere('excluir a opção mantém o passo, com id_opcao nulo',
  (SELECT id_opcao IS NULL AND resposta = 'Não' FROM passo_triagem WHERE ordem = 1));

-- Excluir o nó que está no percurso é bloqueado (RESTRICT)
SELECT pg_temp.deve_falhar('excluir nó que já aparece no percurso (RESTRICT)',
  $f$DELETE FROM no_decisao WHERE pergunta = 'P: texto EDITADO depois'$f$);

-- ---------------------------------------------------------------
-- 4) View de respostas frequentes e cascata
-- ---------------------------------------------------------------
INSERT INTO fluxo_triagem (id_usuario, no_atual)
SELECT u.id, t.no_p FROM usuario u, t WHERE u.email = 'teste_percurso@exemplo.com';
INSERT INTO fluxo_triagem (id_usuario, no_atual)
SELECT u.id, t.no_p FROM usuario u, t WHERE u.email = 'teste_percurso@exemplo.com';

-- Mais duas triagens respondendo "Sim" -> Sim 2x, Não 1x (a de ordem 2 é outra resposta)
INSERT INTO passo_triagem (id_fluxo, ordem, id_no, pergunta, resposta)
SELECT f.id, 1, t.no_p, 'P: o computador liga?', 'Sim'
FROM fluxo_triagem f, t WHERE f.id <> t.fluxo;

SELECT pg_temp.confere('vw_respostas_frequentes: "Sim" aparece 2 vezes',
  (SELECT vezes = 2 FROM vw_respostas_frequentes
   WHERE pergunta = 'P: o computador liga?' AND resposta = 'Sim'));

SELECT pg_temp.confere('vw_respostas_frequentes: "Sim" = 50.0% das respostas da pergunta (2 de 4)',
  (SELECT percentual_da_pergunta = 50.0 FROM vw_respostas_frequentes
   WHERE pergunta = 'P: o computador liga?' AND resposta = 'Sim'));

SELECT pergunta, resposta, vezes, percentual_da_pergunta FROM vw_respostas_frequentes ORDER BY vezes DESC;

DELETE FROM fluxo_triagem WHERE id = (SELECT fluxo FROM t);
SELECT pg_temp.confere('apagar a triagem apaga o percurso dela (cascata)',
  (SELECT count(*) FROM passo_triagem WHERE id_fluxo = (SELECT fluxo FROM t)) = 0);

ROLLBACK;