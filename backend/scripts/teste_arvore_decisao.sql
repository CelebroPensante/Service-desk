-- Teste da US-19 (árvore de decisão). Roda tudo dentro de uma transação e
-- termina com ROLLBACK, então NÃO deixa nada no banco.
--   psql -d servicedesk -v ON_ERROR_STOP=1 -f teste_arvore_decisao.sql
-- Cada teste de rejeição imprime "OK" (o banco bloqueou) ou "FALHOU".

BEGIN;

-- Limpa a árvore existente (ex.: a do seed) só dentro desta transação, para o
-- teste rodar sobre uma árvore vazia. Tudo volta no ROLLBACK final.
DELETE FROM fluxo_triagem;
DELETE FROM opcao_resposta;
DELETE FROM no_decisao;

-- Helpers temporários (somem no fim da sessão)
CREATE FUNCTION pg_temp.no(p TEXT) RETURNS INT
LANGUAGE sql AS $$ SELECT id FROM no_decisao WHERE pergunta = p $$;

CREATE FUNCTION pg_temp.deve_falhar(descricao TEXT, comando TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE comando;
    RAISE NOTICE 'FALHOU - o banco aceitou: %', descricao;
EXCEPTION WHEN integrity_constraint_violation THEN
    RAISE NOTICE 'OK     - rejeitado: %', descricao;
END $$;

-- ---------------------------------------------------------------
-- 1) Seed: árvore "computador não liga"
-- ---------------------------------------------------------------
INSERT INTO no_decisao (pergunta, tipo_no, solucao_sugerida, eh_raiz) VALUES
  ('O computador liga?',                          'pergunta',         NULL, TRUE),
  ('Aparece imagem no monitor?',                  'pergunta',         NULL, FALSE),
  ('O cabo de energia está conectado?',           'pergunta',         NULL, FALSE),
  ('Sugestão: reconectar o cabo de energia',      'sugestao_solucao', 'Conecte o cabo de energia na tomada e no computador e tente ligar novamente.', FALSE),
  ('Abrir chamado: falha de hardware',            'etapa_final',      NULL, FALSE),
  ('Abrir chamado: problema de software',         'etapa_final',      NULL, FALSE),
  ('Triagem concluída: problema resolvido',       'etapa_final',      NULL, FALSE);

INSERT INTO opcao_resposta (id_no_origem, tipo_no_origem, id_no_destino, texto, ordem)
SELECT o.id, o.tipo_no, pg_temp.no(v.destino), v.texto, v.ordem
FROM (VALUES
  ('O computador liga?',                     'Sim',          'Aparece imagem no monitor?',                 1),
  ('O computador liga?',                     'Não',          'O cabo de energia está conectado?',          2),
  ('Aparece imagem no monitor?',             'Sim',          'Abrir chamado: problema de software',        1),
  ('Aparece imagem no monitor?',             'Não',          'Abrir chamado: falha de hardware',           2),
  ('O cabo de energia está conectado?',      'Sim',          'Abrir chamado: falha de hardware',           1),
  ('O cabo de energia está conectado?',      'Não',          'Sugestão: reconectar o cabo de energia',     2),
  ('Sugestão: reconectar o cabo de energia', 'Resolveu',     'Triagem concluída: problema resolvido',      1),
  ('Sugestão: reconectar o cabo de energia', 'Não resolveu', 'Abrir chamado: falha de hardware',           2)
) AS v(origem, texto, destino, ordem)
JOIN no_decisao o ON o.pergunta = v.origem;

-- Usuário e execução de triagem válidos
INSERT INTO usuario (id_cargo, nome, email, senha_hash)
SELECT id, 'Teste Arvore', 'teste_arvore@exemplo.com', 'x' FROM cargo LIMIT 1;

INSERT INTO fluxo_triagem (id_usuario, no_atual)
SELECT u.id, pg_temp.no('O computador liga?')
FROM usuario u WHERE u.email = 'teste_arvore@exemplo.com';

-- Conferência do que foi inserido
SELECT (SELECT count(*) FROM no_decisao)     AS nos_esperado_7,
       (SELECT count(*) FROM opcao_resposta) AS opcoes_esperado_8,
       (SELECT count(*) FROM fluxo_triagem)  AS fluxos_esperado_1;

-- ---------------------------------------------------------------
-- 2) O banco deve REJEITAR todos estes casos
-- ---------------------------------------------------------------
SELECT pg_temp.deve_falhar('opção saindo de uma etapa_final',
  format($f$INSERT INTO opcao_resposta (id_no_origem, tipo_no_origem, id_no_destino, texto)
            VALUES (%s, 'etapa_final', %s, 'x')$f$,
         pg_temp.no('Abrir chamado: falha de hardware'), pg_temp.no('O computador liga?')));

SELECT pg_temp.deve_falhar('tipo_no_origem diferente do tipo real do nó (FK composta)',
  format($f$INSERT INTO opcao_resposta (id_no_origem, tipo_no_origem, id_no_destino, texto)
            VALUES (%s, 'sugestao_solucao', %s, 'x')$f$,
         pg_temp.no('O computador liga?'), pg_temp.no('Aparece imagem no monitor?')));

SELECT pg_temp.deve_falhar('segunda raiz',
  $f$INSERT INTO no_decisao (pergunta, tipo_no, eh_raiz) VALUES ('Outra raiz', 'pergunta', TRUE)$f$);

SELECT pg_temp.deve_falhar('sugestao_solucao sem solucao_sugerida',
  $f$INSERT INTO no_decisao (pergunta, tipo_no) VALUES ('Sugestão vazia', 'sugestao_solucao')$f$);

SELECT pg_temp.deve_falhar('tipo_no inválido',
  $f$INSERT INTO no_decisao (pergunta, tipo_no) VALUES ('Tipo errado', 'banana')$f$);

SELECT pg_temp.deve_falhar('opção apontando para o próprio nó',
  format($f$INSERT INTO opcao_resposta (id_no_origem, tipo_no_origem, id_no_destino, texto)
            VALUES (%1$s, 'pergunta', %1$s, 'loop')$f$,
         pg_temp.no('O computador liga?')));

SELECT pg_temp.deve_falhar('opção com destino inexistente',
  format($f$INSERT INTO opcao_resposta (id_no_origem, tipo_no_origem, id_no_destino, texto)
            VALUES (%s, 'pergunta', 999999, 'fantasma')$f$,
         pg_temp.no('O computador liga?')));

SELECT pg_temp.deve_falhar('texto de opção repetido no mesmo nó',
  format($f$INSERT INTO opcao_resposta (id_no_origem, tipo_no_origem, id_no_destino, texto)
            VALUES (%s, 'pergunta', %s, 'Sim')$f$,
         pg_temp.no('O computador liga?'), pg_temp.no('Abrir chamado: falha de hardware')));

SELECT pg_temp.deve_falhar('fluxo_triagem com no_atual inexistente',
  $f$INSERT INTO fluxo_triagem (id_usuario, no_atual)
     SELECT id, 999999 FROM usuario WHERE email = 'teste_arvore@exemplo.com'$f$);

SELECT pg_temp.deve_falhar('fluxo_triagem com usuário inexistente',
  format($f$INSERT INTO fluxo_triagem (id_usuario, no_atual) VALUES (999999, %s)$f$,
         pg_temp.no('O computador liga?')));

SELECT pg_temp.deve_falhar('excluir nó que está em uso por uma triagem',
  $f$DELETE FROM no_decisao WHERE pergunta = 'O computador liga?'$f$);

-- ---------------------------------------------------------------
-- 3) Visualização da árvore (origem --resposta--> destino)
-- ---------------------------------------------------------------
SELECT o.pergunta AS origem, r.texto AS resposta, d.pergunta AS destino, d.tipo_no AS tipo_destino
FROM opcao_resposta r
JOIN no_decisao o ON o.id = r.id_no_origem
JOIN no_decisao d ON d.id = r.id_no_destino
ORDER BY o.id, r.ordem;

ROLLBACK;