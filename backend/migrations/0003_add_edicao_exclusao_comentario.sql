-- Add migration script here
ALTER TABLE comentario 
    ADD COLUMN editado_em TIMESTAMP,
    ADD COLUMN excluido BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN excluido_em TIMESTAMP; 

