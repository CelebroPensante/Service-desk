-- ============================================================
-- ServiceDesk — Chamados
-- CRUD inicial das OS 05, 06 e 07.
-- ============================================================

-- ------------------------------------------------------------
-- Categoria
-- ------------------------------------------------------------
CREATE TABLE categoria (
    id          SERIAL PRIMARY KEY,
    categoria   VARCHAR(100) NOT NULL UNIQUE,
    descricao   VARCHAR(255),
    ativo       BOOLEAN NOT NULL DEFAULT TRUE
);

-- ------------------------------------------------------------
-- Prioridade
-- ------------------------------------------------------------
CREATE TABLE prioridade (
    id          SERIAL PRIMARY KEY,
    nivel       INTEGER NOT NULL UNIQUE,
    prioridade  VARCHAR(100) NOT NULL UNIQUE,
    ativo       BOOLEAN NOT NULL DEFAULT TRUE
);

-- ------------------------------------------------------------
-- Status
-- ------------------------------------------------------------
CREATE TABLE status_chamado (
    id          SERIAL PRIMARY KEY,
    status      VARCHAR(100) NOT NULL UNIQUE,
    ativo       BOOLEAN NOT NULL DEFAULT TRUE
);

-- ------------------------------------------------------------
-- Chamado
--
-- id_atendente começa NULL porque um chamado recém-aberto ainda
-- pode não ter sido assumido por nenhum técnico.
-- ------------------------------------------------------------
CREATE TABLE chamado (
    id                  SERIAL PRIMARY KEY,

    id_usuario          INTEGER NOT NULL
                        REFERENCES usuario(id) ON DELETE RESTRICT,

    id_atendente        INTEGER
                        REFERENCES atendente(id) ON DELETE SET NULL,

    id_categoria        INTEGER NOT NULL
                        REFERENCES categoria(id) ON DELETE RESTRICT,

    id_prioridade       INTEGER NOT NULL
                        REFERENCES prioridade(id) ON DELETE RESTRICT,

    id_status           INTEGER NOT NULL
                        REFERENCES status_chamado(id) ON DELETE RESTRICT,

    titulo              VARCHAR(255) NOT NULL,

    descricao_detalhada TEXT NOT NULL,

    data_abertura       TIMESTAMP NOT NULL DEFAULT NOW(),
    data_resolucao      TIMESTAMP,
    data_atualizacao    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chamado_usuario
    ON chamado(id_usuario);

CREATE INDEX idx_chamado_atendente
    ON chamado(id_atendente);

CREATE INDEX idx_chamado_status
    ON chamado(id_status);

CREATE INDEX idx_chamado_data_abertura
    ON chamado(data_abertura DESC);

-- ------------------------------------------------------------
-- Seeds mínimos para o CRUD funcionar sem depender de telas
-- administrativas ainda não implementadas.
-- ------------------------------------------------------------

INSERT INTO categoria (categoria, descricao) VALUES
    ('Hardware', 'Problemas relacionados a equipamentos'),
    ('Software', 'Problemas relacionados a programas e sistemas'),
    ('Rede', 'Problemas de rede ou conectividade'),
    ('Acesso', 'Problemas de acesso, contas ou permissões'),
    ('Outros', 'Outros tipos de solicitação');

INSERT INTO prioridade (nivel, prioridade) VALUES
    (1, 'Baixa'),
    (2, U&'M\00E9dia'),
    (3, 'Alta'),
    (4, U&'Cr\00EDtica');

INSERT INTO status_chamado (status) VALUES
    ('Aberto'),
    ('Em atendimento'),
    ('Resolvido'),
    ('Fechado');
