-- ============================================================
-- ServiceDesk — Módulo de Autoavaliação da Máquina e Telemetria
-- Armazena as estações monitoradas pelos agentes locais (Heartbeat)
-- e os relatórios técnicos automatizados anexados aos chamados.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Estações de trabalho monitoradas pelo Agente Rust
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS maquina_monitorada (
    id                  SERIAL PRIMARY KEY,
    machine_uid         VARCHAR(128) NOT NULL UNIQUE,
    id_usuario          INTEGER REFERENCES usuario(id) ON DELETE SET NULL,
    usuario_so          VARCHAR(150),
    hostname            VARCHAR(255) NOT NULL,
    sistema_operacional VARCHAR(255) NOT NULL,
    versao_so           VARCHAR(100),
    modelo_cpu          VARCHAR(255),
    nucleos_cpu         INTEGER NOT NULL DEFAULT 1,
    memoria_total_mb    BIGINT NOT NULL DEFAULT 0,
    swap_total_mb       BIGINT NOT NULL DEFAULT 0,
    status_conexao      VARCHAR(20) NOT NULL DEFAULT 'online'
                        CHECK (status_conexao IN ('online', 'offline')),
    ultimo_heartbeat    TIMESTAMP NOT NULL DEFAULT NOW(),
    criado_em           TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_maquina_monitorada_status
    ON maquina_monitorada (status_conexao, ultimo_heartbeat DESC);

CREATE INDEX IF NOT EXISTS idx_maquina_monitorada_usuario
    ON maquina_monitorada (id_usuario);

CREATE INDEX IF NOT EXISTS idx_maquina_monitorada_hostname
    ON maquina_monitorada (hostname);

-- ------------------------------------------------------------
-- 2) Relatórios Técnicos Automatizados de Autoavaliação
-- Gerados na abertura de um chamado ou sob demanda durante o suporte.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS relatorio_autoavaliacao (
    id                  SERIAL PRIMARY KEY,
    id_chamado          INTEGER REFERENCES chamado(id) ON DELETE CASCADE,
    id_maquina          INTEGER REFERENCES maquina_monitorada(id) ON DELETE SET NULL,
    machine_uid         VARCHAR(128) NOT NULL,
    hostname            VARCHAR(255) NOT NULL,
    usuario_so          VARCHAR(150),
    sistema_operacional VARCHAR(255) NOT NULL,
    versao_so           VARCHAR(100),
    modelo_cpu          VARCHAR(255),
    nucleos_cpu         INTEGER NOT NULL DEFAULT 1,
    uptime_segundos     BIGINT NOT NULL DEFAULT 0,
    cpu_usage_percent   REAL NOT NULL,
    memoria_total_mb    BIGINT NOT NULL,
    memoria_usada_mb    BIGINT NOT NULL,
    memoria_uso_percent REAL NOT NULL DEFAULT 0,
    swap_total_mb       BIGINT NOT NULL DEFAULT 0,
    swap_usada_mb       BIGINT NOT NULL DEFAULT 0,
    discos              JSONB NOT NULL DEFAULT '[]'::jsonb,
    top_processos       JSONB NOT NULL DEFAULT '[]'::jsonb,
    coletado_em         TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_relatorio_autoavaliacao_chamado
    ON relatorio_autoavaliacao (id_chamado, coletado_em DESC);

CREATE INDEX IF NOT EXISTS idx_relatorio_autoavaliacao_maquina
    ON relatorio_autoavaliacao (id_maquina, coletado_em DESC);
