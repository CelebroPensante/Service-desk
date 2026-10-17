-- Add migration script here
-- US-25: Gestão dos fluxos de triagem
-- Baseada no TCC (seção 2.3.3): "alterações nos fluxos de triagem [...] realizadas
-- diretamente nos dados armazenados, sem a necessidade de modificações no código-fonte"
-- e (seção 2.2.5.2.3): auditoria por triggers que "registram automaticamente cada
-- operação DML (INSERT, UPDATE, DELETE) nas tabelas monitoradas".
--
-- O que esta migration faz:
--   1) versao: contador de versão em no_decisao e opcao_resposta (sobe a cada edição).
--   2) auditoria_arvore: histórico de toda inclusão, edição e exclusão da árvore,
--      com o conteúdo antes e depois (JSONB) e quem alterou.
--   3) triggers que gravam a auditoria sozinhos, inclusive em alterações feitas
--      direto no banco (por SQL). Quem alterou vem da variável de sessão
--      app.usuario_id, que a API define a cada edição.

-- ---------------------------------------------------------------
-- 1) Versão de cada nó e de cada opção
-- ---------------------------------------------------------------
ALTER TABLE no_decisao     ADD COLUMN IF NOT EXISTS versao INTEGER NOT NULL DEFAULT 1;
ALTER TABLE opcao_resposta ADD COLUMN IF NOT EXISTS versao INTEGER NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION fn_arvore_incrementar_versao() RETURNS TRIGGER AS $$
BEGIN
    -- só conta como nova versão se algo mudou de fato
    IF to_jsonb(NEW) - 'versao' IS DISTINCT FROM to_jsonb(OLD) - 'versao' THEN
        NEW.versao := OLD.versao + 1;
    ELSE
        NEW.versao := OLD.versao;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_no_decisao_versao ON no_decisao;
CREATE TRIGGER trg_no_decisao_versao BEFORE UPDATE ON no_decisao
    FOR EACH ROW EXECUTE FUNCTION fn_arvore_incrementar_versao();

DROP TRIGGER IF EXISTS trg_opcao_resposta_versao ON opcao_resposta;
CREATE TRIGGER trg_opcao_resposta_versao BEFORE UPDATE ON opcao_resposta
    FOR EACH ROW EXECUTE FUNCTION fn_arvore_incrementar_versao();

-- ---------------------------------------------------------------
-- 2) Histórico de alterações da árvore
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auditoria_arvore (
    id                BIGSERIAL PRIMARY KEY,
    tabela            VARCHAR(30) NOT NULL CHECK (tabela IN ('no_decisao', 'opcao_resposta')),
    operacao          VARCHAR(10) NOT NULL CHECK (operacao IN ('INSERT', 'UPDATE', 'DELETE')),
    id_registro       INTEGER     NOT NULL,
    dados_anteriores  JSONB,      -- nulo em INSERT
    dados_novos       JSONB,      -- nulo em DELETE
    -- Nulo quando a alteração é feita direto no banco, sem passar pela API
    id_usuario        INTEGER     REFERENCES usuario(id) ON DELETE SET NULL,
    data_alteracao    TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auditoria_arvore_registro
    ON auditoria_arvore (tabela, id_registro, data_alteracao DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_arvore_data
    ON auditoria_arvore (data_alteracao DESC);

-- ---------------------------------------------------------------
-- 3) Triggers de auditoria
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_auditar_arvore() RETURNS TRIGGER AS $$
DECLARE
    v_usuario INTEGER;
BEGIN
    -- app.usuario_id é definido pela API (set_config local à transação)
    BEGIN
        v_usuario := NULLIF(current_setting('app.usuario_id', TRUE), '')::INTEGER;
    EXCEPTION WHEN OTHERS THEN
        v_usuario := NULL;
    END;

    IF TG_OP = 'INSERT' THEN
        INSERT INTO auditoria_arvore (tabela, operacao, id_registro, dados_novos, id_usuario)
        VALUES (TG_TABLE_NAME, TG_OP, NEW.id, to_jsonb(NEW), v_usuario);
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        -- ignora UPDATE que não mudou nada
        IF to_jsonb(NEW) - 'versao' IS NOT DISTINCT FROM to_jsonb(OLD) - 'versao' THEN
            RETURN NEW;
        END IF;
        INSERT INTO auditoria_arvore (tabela, operacao, id_registro, dados_anteriores, dados_novos, id_usuario)
        VALUES (TG_TABLE_NAME, TG_OP, NEW.id, to_jsonb(OLD), to_jsonb(NEW), v_usuario);
        RETURN NEW;
    ELSE
        INSERT INTO auditoria_arvore (tabela, operacao, id_registro, dados_anteriores, id_usuario)
        VALUES (TG_TABLE_NAME, TG_OP, OLD.id, to_jsonb(OLD), v_usuario);
        RETURN OLD;
    END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_no_decisao_auditoria ON no_decisao;
CREATE TRIGGER trg_no_decisao_auditoria AFTER INSERT OR UPDATE OR DELETE ON no_decisao
    FOR EACH ROW EXECUTE FUNCTION fn_auditar_arvore();

DROP TRIGGER IF EXISTS trg_opcao_resposta_auditoria ON opcao_resposta;
CREATE TRIGGER trg_opcao_resposta_auditoria AFTER INSERT OR UPDATE OR DELETE ON opcao_resposta
    FOR EACH ROW EXECUTE FUNCTION fn_auditar_arvore();