-- Add migration script here
-- Comentário (US-10)
CREATE TABLE IF NOT EXISTS comentario (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_chamado integer NOT NULL REFERENCES chamado (id),
    id_usuario integer NOT NULL REFERENCES usuario (id),
    texto varchar(2000) NOT NULL,
    data_comentario timestamp NOT NULL DEFAULT now(),
    privado boolean NOT NULL DEFAULT false
);