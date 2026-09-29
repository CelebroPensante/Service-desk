-- Cria registros de atendente para usuários ativos que possuem nível técnico.
-- O painel usa o id de atendente para respeitar a FK de chamado.id_atendente.
INSERT INTO atendente (id_usuario)
SELECT u.id
FROM usuario u
JOIN cargo c ON c.id = u.id_cargo
JOIN nivel_permissao np ON np.id = c.id_permissao
WHERE u.ativo = TRUE
  AND np.nivel >= 2
  AND NOT EXISTS (
      SELECT 1
      FROM atendente a
      WHERE a.id_usuario = u.id
  );