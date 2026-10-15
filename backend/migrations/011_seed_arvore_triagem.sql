-- Add migration script here
-- Seed da árvore de triagem "computador não liga" (dados iniciais para a US-20).
-- Só insere se a árvore ainda estiver vazia, então é seguro rodar de novo.
--
-- Estrutura (sugestao_solucao: o usuário confirma que resolveu pelo endpoint
-- /resolver, ou escolhe "Não resolveu" e segue para abrir chamado):
--
--   O computador liga?
--     Sim -> Aparece imagem no monitor?
--              Sim -> [final] Abrir chamado: problema de software
--              Não -> [final] Abrir chamado: falha de hardware
--     Não -> O cabo de energia está conectado?
--              Sim -> [final] Abrir chamado: falha de hardware
--              Não -> [sugestão] Reconectar o cabo de energia
--                       Não resolveu -> [final] Abrir chamado: falha de hardware

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM no_decisao) THEN
        RETURN;
    END IF;

    INSERT INTO no_decisao (pergunta, tipo_no, solucao_sugerida, eh_raiz) VALUES
      ('O computador liga?',                     'pergunta',         NULL, TRUE),
      ('Aparece imagem no monitor?',             'pergunta',         NULL, FALSE),
      ('O cabo de energia está conectado?',      'pergunta',         NULL, FALSE),
      ('Sugestão: reconectar o cabo de energia', 'sugestao_solucao',
       'Conecte o cabo de energia na tomada e no computador e tente ligar novamente.', FALSE),
      ('Abrir chamado: falha de hardware',       'etapa_final',      NULL, FALSE),
      ('Abrir chamado: problema de software',    'etapa_final',      NULL, FALSE);

    INSERT INTO opcao_resposta (id_no_origem, tipo_no_origem, id_no_destino, texto, ordem)
    SELECT o.id, o.tipo_no, d.id, v.texto, v.ordem
    FROM (VALUES
      ('O computador liga?',                     'Sim',          'Aparece imagem no monitor?',             1),
      ('O computador liga?',                     'Não',          'O cabo de energia está conectado?',      2),
      ('Aparece imagem no monitor?',             'Sim',          'Abrir chamado: problema de software',    1),
      ('Aparece imagem no monitor?',             'Não',          'Abrir chamado: falha de hardware',       2),
      ('O cabo de energia está conectado?',      'Sim',          'Abrir chamado: falha de hardware',       1),
      ('O cabo de energia está conectado?',      'Não',          'Sugestão: reconectar o cabo de energia', 2),
      ('Sugestão: reconectar o cabo de energia', 'Não resolveu', 'Abrir chamado: falha de hardware',       1)
    ) AS v(origem, texto, destino, ordem)
    JOIN no_decisao o ON o.pergunta = v.origem
    JOIN no_decisao d ON d.pergunta = v.destino;
END $$;