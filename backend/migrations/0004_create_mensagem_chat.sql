-- Add migration script here
CREATE TABLE IF NOT EXISTS mensagem_chat (
    id SERIAL PRIMARY KEY,
    id_chamado INTEGER NOT NULL REFERENCES chamados(id),
    id_usuario INTEGER NOT NULL REFERENCES usuario(id),
    texto VARCHAR(2000) NOT NULL,
    data_envio TIMESTAMP NOT NULL DEFAULT NOW()
);