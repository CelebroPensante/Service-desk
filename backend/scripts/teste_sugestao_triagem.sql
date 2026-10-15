-- Teste da US-22 (sugestão de solução imediata). Roda tudo dentro de uma
-- transação e termina com ROLLBACK, então NÃO deixa nada no banco.
--   psql -d servicedesk -v ON_ERROR_STOP=1 -f teste_sugestao_triagem.sql
-- (no pgAdmin: cole no Query Tool e veja a aba Messages)
-- Requer a migration 012 aplicada.

BEGIN;

-- Limpa a árvore e as triagens só dentro desta transação (volta no ROLLBACK).
DELETE FROM fluxo_triagem;      -- apaga sugestao_triagem em cascata
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
-- Massa de teste: 1 pergunta, 1 sugestão, 1 etapa final, 3 triagens
-- ---------------------------------------------------------------
INSERT INTO no_decisao (pergunta, tipo_no, solucao_sugerida, eh_raiz) VALUES
  ('Pergunta raiz',  'pergunta',         NULL, TRUE),
  ('Sugestão A',     'sugestao_solucao', E'Passo 1\nPasso 2\nPasso 3', FALSE),
  ('Etapa final',    'etapa_final',      NULL, FALSE);

INSERT INTO usuario (id_cargo, nome, email, senha_hash)
SELECT id, 'Teste Sugestao', 'teste_sugestao@exemplo.com', 'x' FROM cargo LIMIT 1;

-- f1: resolveu na triagem | f2: não resolveu e foi para chamado | f3: sem resposta
INSERT INTO fluxo_triagem (id_usuario, no_atual, concluido)
SELECT u.id, n.id, v.concluido
FROM usuario u
JOIN (VALUES ('Sugestão A', TRUE), ('Etapa final', TRUE), ('Sugestão A', FALSE))
     AS v(no, concluido) ON TRUE
JOIN no_decisao n ON n.pergunta = v.no
WHERE u.email = 'teste_sugestao@exemplo.com'
ORDER BY v.concluido DESC, n.id;

CREATE TEMP TABLE t_fluxo AS
SELECT row_number() OVER (ORDER BY f.id) AS n, f.id, f.no_atual, f.concluido FROM fluxo_triagem f;

-- ---------------------------------------------------------------
-- 1) Registros válidos
-- ---------------------------------------------------------------
INSERT INTO sugestao_triagem (id_fluxo, id_no, resolveu, data_exibicao, data_resposta)
SELECT f.id, n.id, TRUE,  NOW() - interval '90 seconds', NOW()
FROM t_fluxo f, no_decisao n WHERE f.n = 1 AND n.pergunta = 'Sugestão A';

INSERT INTO sugestao_triagem (id_fluxo, id_no, resolveu, data_resposta)
SELECT f.id, n.id, FALSE, NOW()
FROM t_fluxo f, no_decisao n WHERE f.n = 2 AND n.pergunta = 'Sugestão A';

INSERT INTO sugestao_triagem (id_fluxo, id_no)           -- pendente (sem resposta)
SELECT f.id, n.id
FROM t_fluxo f, no_decisao n WHERE f.n = 3 AND n.pergunta = 'Sugestão A';

SELECT pg_temp.confere('3 sugestões registradas', (SELECT count(*) FROM sugestao_triagem) = 3);

-- ---------------------------------------------------------------
-- 2) O banco deve REJEITAR todos estes casos
-- ---------------------------------------------------------------
SELECT pg_temp.deve_falhar('registrar um nó que não é sugestão de solução (FK composta)',
  format($f$INSERT INTO sugestao_triagem (id_fluxo, id_no)
            SELECT id, %s FROM t_fluxo WHERE n = 1$f$,
         (SELECT id FROM no_decisao WHERE pergunta = 'Pergunta raiz')));

SELECT pg_temp.deve_falhar('tipo_no diferente de sugestao_solucao',
  format($f$INSERT INTO sugestao_triagem (id_fluxo, id_no, tipo_no)
            SELECT id, %s, 'pergunta' FROM t_fluxo WHERE n = 1$f$,
         (SELECT id FROM no_decisao WHERE pergunta = 'Pergunta raiz')));

SELECT pg_temp.deve_falhar('resolveu preenchido sem data_resposta',
  format($f$INSERT INTO sugestao_triagem (id_fluxo, id_no, resolveu)
            SELECT id, %s, TRUE FROM t_fluxo WHERE n = 1$f$,
         (SELECT id FROM no_decisao WHERE pergunta = 'Sugestão A')));

SELECT pg_temp.deve_falhar('data_resposta sem resolveu',
  format($f$INSERT INTO sugestao_triagem (id_fluxo, id_no, data_resposta)
            SELECT id, %s, NOW() FROM t_fluxo WHERE n = 1$f$,
         (SELECT id FROM no_decisao WHERE pergunta = 'Sugestão A')));

SELECT pg_temp.deve_falhar('duas sugestões pendentes na mesma triagem',
  format($f$INSERT INTO sugestao_triagem (id_fluxo, id_no)
            SELECT id, %s FROM t_fluxo WHERE n = 3$f$,
         (SELECT id FROM no_decisao WHERE pergunta = 'Sugestão A')));

SELECT pg_temp.deve_falhar('triagem inexistente',
  format($f$INSERT INTO sugestao_triagem (id_fluxo, id_no) VALUES (999999, %s)$f$,
         (SELECT id FROM no_decisao WHERE pergunta = 'Sugestão A')));

SELECT pg_temp.deve_falhar('excluir sugestão que já tem registro de eficiência',
  $f$DELETE FROM no_decisao WHERE pergunta = 'Sugestão A'$f$);

-- ---------------------------------------------------------------
-- 3) Views de eficiência
-- ---------------------------------------------------------------
SELECT pg_temp.confere('vw_eficiencia_sugestao: 3 exibições, 1 resolvida, 1 não resolvida, 1 sem resposta',
  (SELECT exibicoes = 3 AND resolvidas = 1 AND nao_resolvidas = 1 AND sem_resposta = 1
   FROM vw_eficiencia_sugestao WHERE sugestao = 'Sugestão A'));

SELECT pg_temp.confere('vw_eficiencia_sugestao: taxa de resolução 50.0% (1 de 2 respondidas)',
  (SELECT taxa_resolucao_pct = 50.0 FROM vw_eficiencia_sugestao WHERE sugestao = 'Sugestão A'));

SELECT pg_temp.confere('vw_eficiencia_sugestao: tempo médio de resolução ~90 s',
  (SELECT tempo_medio_resolucao_s BETWEEN 89 AND 92 FROM vw_eficiencia_sugestao WHERE sugestao = 'Sugestão A'));

SELECT pg_temp.confere('vw_resumo_triagem: 3 triagens, 1 resolvida, 1 para chamado, 1 em andamento, taxa 50.0%',
  (SELECT total_triagens = 3 AND resolvidas_na_triagem = 1 AND encaminhadas_para_chamado = 1
          AND em_andamento_ou_abandonadas = 1 AND taxa_resolucao_pct = 50.0
   FROM vw_resumo_triagem));

SELECT * FROM vw_eficiencia_sugestao;
SELECT * FROM vw_resumo_triagem;

ROLLBACK;