-- Add migration script here
-- Tabelas de apoio (domínio de Chamados)
CREATE TABLE IF NOT EXISTS categoria (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    categoria varchar(100) NOT NULL,
    descricao varchar(512)
);

CREATE TABLE IF NOT EXISTS prioridade (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nivel integer NOT NULL,
    prioridade varchar(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS status (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    status varchar(100) NOT NULL,
    ativo boolean NOT NULL DEFAULT true
);

-- Chamados (simplificado: sem atendente/proprietário por enquanto)
CREATE TABLE IF NOT EXISTS chamados (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_usuario integer NOT NULL REFERENCES usuario (id),
    id_categoria integer NOT NULL REFERENCES categoria (id),
    id_prioridade integer NOT NULL REFERENCES prioridade (id),
    id_status integer NOT NULL REFERENCES status (id),
    titulo varchar(255) NOT NULL,
    descricao_detalhada varchar(2000),
    tempo_conclusao_h time,
    prazo_conclusao date,
    data_abertura timestamp NOT NULL DEFAULT now(),
    data_resolucao timestamp,
    data_desistencia timestamp,
    data_atualizacao timestamp NOT NULL DEFAULT now()
);

-- Comentário (US-10)
CREATE TABLE IF NOT EXISTS comentario (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_chamado integer NOT NULL REFERENCES chamados (id),
    id_usuario integer NOT NULL REFERENCES usuario (id),
    texto varchar(2000) NOT NULL,
    data_comentario timestamp NOT NULL DEFAULT now(),
    privado boolean NOT NULL DEFAULT false
);