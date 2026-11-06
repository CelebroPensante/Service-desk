-- Auditoria de acesso remoto. Nenhum vídeo, tecla, código de pareamento ou JWT é armazenado.
CREATE TABLE evento_acesso_remoto (
    id BIGSERIAL PRIMARY KEY,
    sessao_id VARCHAR(32) NOT NULL,
    -- Identificador histórico: permanece após a exclusão normal do chamado.
    id_chamado INTEGER NOT NULL,
    id_usuario INTEGER REFERENCES usuario(id) ON DELETE SET NULL,
    acao VARCHAR(40) NOT NULL CHECK (acao IN (
        'requested', 'screen_allowed', 'control_requested', 'control_allowed',
        'control_revoked', 'agent_disconnected', 'ended'
    )),
    ocorrido_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_evento_remoto_chamado ON evento_acesso_remoto(id_chamado, ocorrido_em DESC);
