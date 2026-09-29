-- Add migration script here

CREATE TABLE IF NOT EXISTS anexo (
    id              SERIAL PRIMARY KEY,
    id_chamado      INTEGER NOT NULL REFERENCES chamado(id) ON DELETE CASCADE,
    id_usuario      INTEGER NOT NULL REFERENCES usuario(id),
    nome_original   VARCHAR(255) NOT NULL,
    nome_armazenado VARCHAR(255) NOT NULL, -- nome físico no disco (uuid), nunca exposto na API
    caminho         VARCHAR(500) NOT NULL,
    tamanho_bytes   BIGINT NOT NULL,
    tipo_mime       VARCHAR(100) NOT NULL,
    data_upload     TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_anexo_chamado ON anexo (id_chamado);