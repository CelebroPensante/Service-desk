-- ============================================================
-- ServiceDesk — Schema inicial: Autenticação, Cargos e Permissões
-- Alinhado ao Diagrama do Modelo Lógico Relacional (Figura 3) e
-- ao Diagrama de Classes (Figura 4) do TCC.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- para gen_random_uuid(), se necessário no futuro

-- ------------------------------------------------------------
-- NivelPermissao: define o grau de acesso (ex.: leitura, escrita,
-- administração total) que pode ser vinculado a um Cargo.
-- ------------------------------------------------------------
CREATE TABLE nivel_permissao (
    id          SERIAL PRIMARY KEY,
    nivel       INTEGER NOT NULL UNIQUE,          -- ex.: 1=Default, 2=Tecnico, 3=HelpDesk, 4=Gerente, 5=ADM
    descricao   VARCHAR(255) NOT NULL,
    ativo       BOOLEAN NOT NULL DEFAULT TRUE
);

-- ------------------------------------------------------------
-- Cargo: perfis atribuíveis a usuários (ADM, Gerente, HelpDesk,
-- Default, Tecnico), conforme Figura 1 — Diagrama de Cargos e
-- Permissões.
-- ------------------------------------------------------------
CREATE TABLE cargo (
    id                SERIAL PRIMARY KEY,
    id_permissao      INTEGER NOT NULL REFERENCES nivel_permissao(id) ON DELETE RESTRICT,
    cargo             VARCHAR(100) NOT NULL UNIQUE,
    criado_em         TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- Usuario: entidade central de autenticação. Corresponde à
-- classe Usuario do Diagrama de Classes.
-- ------------------------------------------------------------
CREATE TABLE usuario (
    id                SERIAL PRIMARY KEY,
    id_cargo          INTEGER NOT NULL REFERENCES cargo(id) ON DELETE RESTRICT,
    nome              VARCHAR(255) NOT NULL,
    email             VARCHAR(255) NOT NULL UNIQUE,
    senha_hash        VARCHAR(255) NOT NULL,       -- hash bcrypt, nunca a senha em texto puro
    setor             VARCHAR(100),
    data_admissao     TIMESTAMP,
    data_demissao     TIMESTAMP,
    data_cadastro     TIMESTAMP NOT NULL DEFAULT NOW(),
    ativo             BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX idx_usuario_email ON usuario (email);

-- ------------------------------------------------------------
-- Atendente: especialização de Usuario para quem desempenha
-- função técnica (gerencia chamados, inicia acesso remoto).
-- ------------------------------------------------------------
CREATE TABLE atendente (
    id                SERIAL PRIMARY KEY,
    id_usuario        INTEGER NOT NULL UNIQUE REFERENCES usuario(id) ON DELETE CASCADE,
    id_supervisor     INTEGER REFERENCES atendente(id) ON DELETE SET NULL,
    ativo             BOOLEAN NOT NULL DEFAULT TRUE
);

-- ------------------------------------------------------------
-- Seed inicial de níveis de permissão e cargos padrão
-- ------------------------------------------------------------
INSERT INTO nivel_permissao (nivel, descricao) VALUES
    (1, 'Acesso padrão — abrir e acompanhar os próprios chamados'),
    (2, 'Acesso técnico — atender, atualizar e resolver chamados'),
    (3, 'Acesso help desk — triagem e distribuição de chamados'),
    (4, 'Acesso gerencial — relatórios e supervisão de equipe'),
    (5, 'Acesso administrativo total — gestão de cargos e permissões');

INSERT INTO cargo (id_permissao, cargo) VALUES
    (1, 'Default'),
    (2, 'Tecnico'),
    (3, 'Help Desk'),
    (4, 'Gerente'),
    (5, 'ADM');
