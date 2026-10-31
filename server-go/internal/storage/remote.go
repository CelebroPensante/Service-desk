package storage

import (
	"context"
	"servicedesk/server-go/internal/remote"
)

func (s *PostgresStore) Ticket(ctx context.Context, id int) (remote.Ticket, error) {
	var t remote.Ticket
	err := s.pool.QueryRow(ctx, "SELECT ch.id_usuario, ch.data_resolucao IS NOT NULL OR lower(st.status) IN ('resolvido','fechado','finalizado','cancelado') FROM chamado ch JOIN status_chamado st ON st.id=ch.id_status WHERE ch.id=$1", id).Scan(&t.OwnerID, &t.Closed)
	return t, err
}
func (s *PostgresStore) Record(ctx context.Context, e remote.Event) error {
	_, err := s.pool.Exec(ctx, "INSERT INTO evento_acesso_remoto (sessao_id,id_chamado,id_usuario,acao,ocorrido_em) VALUES ($1,$2,NULLIF($3,0),$4,$5)", e.SessionID, e.TicketID, e.UserID, e.Action, e.At)
	return err
}
func (s *PostgresStore) History(ctx context.Context, id int) ([]remote.Event, error) {
	rows, err := s.pool.Query(ctx, "SELECT sessao_id,id_chamado,COALESCE(id_usuario,0),acao,ocorrido_em FROM evento_acesso_remoto WHERE id_chamado=$1 ORDER BY ocorrido_em DESC,id DESC LIMIT 100", id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := []remote.Event{}
	for rows.Next() {
		var e remote.Event
		if err := rows.Scan(&e.SessionID, &e.TicketID, &e.UserID, &e.Action, &e.At); err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	return events, rows.Err()
}
