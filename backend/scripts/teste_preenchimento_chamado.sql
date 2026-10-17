-- Teste da US-23 (preenchimento automático do chamado pela triagem).
-- Roda tudo dentro de uma transação e termina com ROLLBACK, então NÃO deixa
-- nada no banco.
--   psql -d servicedesk -v ON_ERROR_STOP=1 -f teste_preenchimento_chamado.sql
-- (no pgAdmin: cole no Query Tool e veja a aba Messages)
-- Requer a migration 014 aplicada.

BEGIN;

-- Limpa a árvore e as triagens só dentro desta transação (volta no ROLLBACK).
DELETE FROM fluxo_triagem;
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
-- Massa de teste
-- ---------------------------------------------------------------
INSERT INTO setor (nome) VALUES ('Setor de Teste');

INSERT INTO usuario (id_cargo, nome, email, senha_hash)
SELECT id, 'Teste Setor', 'teste_setor@exemplo.com', 'x' FROM cargo LIMIT 1;

CREATE TEMP TABLE t AS
SELECT (SELECT id FROM setor      WHERE nome = 'Setor de Teste')            AS setor,
       (SELECT id FROM categoria  ORDER BY id LIMIT 1)                      AS cat,
       (SELECT id FROM prioridade ORDER BY id LIMIT 1)                      AS pri,
       (SELECT id FROM status_chamado ORDER BY id LIMIT 1)                  AS sta,
       (SELECT id FROM usuario WHERE email = 'teste_setor@exemplo.com')     AS usr;

-- ---------------------------------------------------------------
-- 1) Etapa final pode definir categoria, prioridade e setor
-- ---------------------------------------------------------------
INSERT INTO no_decisao (pergunta, tipo_no, id_categoria, id_prioridade, id_setor)
SELECT 'Final completa', 'etapa_final', cat, pri, setor FROM t;

SELECT pg_temp.confere('etapa final aceita categoria, prioridade e setor',
  (SELECT id_categoria IS NOT NULL AND id_prioridade IS NOT NULL AND id_setor IS NOT NULL
   FROM no_decisao WHERE pergunta = 'Final completa'));

-- Etapa final sem classificação continua válida (o usuário escolhe no formulário)
INSERT INTO no_decisao (pergunta, tipo_no) VALUES ('Final sem classificação', 'etapa_final');
SELECT pg_temp.confere('etapa final sem classificação continua válida',
  (SELECT count(*) = 1 FROM no_decisao WHERE pergunta = 'Final sem classificação'));

-- ---------------------------------------------------------------
-- 2) O banco deve REJEITAR
-- ---------------------------------------------------------------
SELECT pg_temp.deve_falhar('pergunta com categoria (só etapa final classifica)',
  $f$INSERT INTO no_decisao (pergunta, tipo_no, id_categoria)
     SELECT 'P com categoria', 'pergunta', cat FROM t$f$);

SELECT pg_temp.deve_falhar('sugestão de solução com prioridade',
  $f$INSERT INTO no_decisao (pergunta, tipo_no, solucao_sugerida, id_prioridade)
     SELECT 'S com prioridade', 'sugestao_solucao', 'x', pri FROM t$f$);

SELECT pg_temp.deve_falhar('pergunta com setor',
  $f$INSERT INTO no_decisao (pergunta, tipo_no, id_setor)
     SELECT 'P com setor', 'pergunta', setor FROM t$f$);

SELECT pg_temp.deve_falhar('etapa final com categoria inexistente',
  $f$INSERT INTO no_decisao (pergunta, tipo_no, id_categoria)
     VALUES ('Final categoria inválida', 'etapa_final', 999999)$f$);

SELECT pg_temp.deve_falhar('etapa final com setor inexistente',
  $f$INSERT INTO no_decisao (pergunta, tipo_no, id_setor)
     VALUES ('Final setor inválido', 'etapa_final', 999999)$f$);

SELECT pg_temp.deve_falhar('excluir setor usado por uma etapa final (RESTRICT)',
  $f$DELETE FROM setor WHERE nome = 'Setor de Teste'$f$);

SELECT pg_temp.deve_falhar('chamado com setor inexistente',
  $f$INSERT INTO chamado (id_usuario, id_categoria, id_prioridade, id_status, id_setor, titulo, descricao_detalhada)
     SELECT usr, cat, pri, sta, 999999, 'x', 'y' FROM t$f$);

-- ---------------------------------------------------------------
-- 3) Chamado com setor; triagem vinculada ao chamado
-- ---------------------------------------------------------------
INSERT INTO chamado (id_usuario, id_categoria, id_prioridade, id_status, id_setor, titulo, descricao_detalhada)
SELECT usr, cat, pri, sta, setor, 'Chamado da triagem', 'desc' FROM t;

INSERT INTO fluxo_triagem (id_usuario, no_atual, concluido, id_chamado)
SELECT t.usr, n.id, TRUE, c.id
FROM t, no_decisao n, chamado c
WHERE n.pergunta = 'Final completa' AND c.titulo = 'Chamado da triagem';

SELECT pg_temp.confere('triagem vinculada ao chamado que gerou',
  (SELECT count(*) = 1 FROM fluxo_triagem f JOIN chamado c ON c.id = f.id_chamado
   WHERE c.titulo = 'Chamado da triagem'));

SELECT pg_temp.deve_falhar('duas triagens para o mesmo chamado',
  $f$INSERT INTO fluxo_triagem (id_usuario, no_atual, concluido, id_chamado)
     SELECT t.usr, n.id, TRUE, c.id
     FROM t, no_decisao n, chamado c
     WHERE n.pergunta = 'Final completa' AND c.titulo = 'Chamado da triagem'$f$);

-- Várias triagens sem chamado são permitidas (id_chamado nulo não conta)
INSERT INTO fluxo_triagem (id_usuario, no_atual)
SELECT t.usr, n.id FROM t, no_decisao n WHERE n.pergunta = 'Final completa';
INSERT INTO fluxo_triagem (id_usuario, no_atual)
SELECT t.usr, n.id FROM t, no_decisao n WHERE n.pergunta = 'Final completa';
SELECT pg_temp.confere('várias triagens sem chamado são permitidas',
  (SELECT count(*) = 2 FROM fluxo_triagem WHERE id_chamado IS NULL));

-- ---------------------------------------------------------------
-- 4) Setor em uso por técnico e chamado: excluir não apaga ninguém
-- ---------------------------------------------------------------
INSERT INTO atendente (id_usuario, id_setor) SELECT usr, setor FROM t;

-- libera a etapa final (RESTRICT) para testar o SET NULL de chamado/atendente
UPDATE no_decisao SET id_setor = NULL WHERE pergunta = 'Final completa';
DELETE FROM setor WHERE nome = 'Setor de Teste';

SELECT pg_temp.confere('excluir setor mantém o chamado (id_setor vira nulo)',
  (SELECT id_setor IS NULL FROM chamado WHERE titulo = 'Chamado da triagem'));
SELECT pg_temp.confere('excluir setor mantém o técnico (id_setor vira nulo)',
  (SELECT count(*) = 1 AND bool_and(id_setor IS NULL) FROM atendente a JOIN t ON t.usr = a.id_usuario));

-- Excluir o chamado mantém a triagem (id_chamado vira nulo)
DELETE FROM chamado WHERE titulo = 'Chamado da triagem';
SELECT pg_temp.confere('excluir o chamado mantém a triagem (id_chamado vira nulo)',
  (SELECT count(*) = 3 FROM fluxo_triagem WHERE id_chamado IS NULL));

-- ---------------------------------------------------------------
-- 5) Seed: setores padrão existem
-- ---------------------------------------------------------------
SELECT pg_temp.confere('setores padrão (Infraestrutura, Redes, Sistemas, Segurança e Acessos)',
  (SELECT count(*) = 4 FROM setor WHERE nome IN ('Infraestrutura', 'Redes', 'Sistemas', 'Segurança e Acessos')));

ROLLBACK;
