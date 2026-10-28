package storage

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"servicedesk/server-go/internal/hub"
)

type RelatorioAutoavaliacaoDTO struct {
	ID                 int               `json:"id"`
	IDChamado          *int              `json:"idChamado,omitempty"`
	IDMaquina          *int              `json:"idMaquina,omitempty"`
	MachineUID         string            `json:"machineUid"`
	Hostname           string            `json:"hostname"`
	UsuarioSO          string            `json:"usuarioSo"`
	SistemaOperacional string            `json:"sistemaOperacional"`
	VersaoSO           string            `json:"versaoSo"`
	ModeloCPU          string            `json:"modeloCpu"`
	NucleosCPU         uint32            `json:"nucleosCpu"`
	UptimeSegundos     uint64            `json:"uptimeSegundos"`
	CpuUsagePercent    float32           `json:"cpuUsagePercent"`
	MemoriaTotalMB     uint64            `json:"memoriaTotalMb"`
	MemoriaUsadaMB     uint64            `json:"memoriaUsadaMb"`
	MemoriaUsoPercent  float32           `json:"memoriaUsoPercent"`
	SwapTotalMB        uint64            `json:"swapTotalMb"`
	SwapUsadaMB        uint64            `json:"swapUsadaMb"`
	Discos             []hub.DiscoDTO    `json:"discos"`
	TopProcessos       []hub.ProcessoDTO `json:"topProcessos"`
	ColetadoEm         time.Time         `json:"coletadoEm"`
}

type PostgresStore struct {
	pool *pgxpool.Pool
}

func NewPostgresStore(ctx context.Context, databaseURL string) (*PostgresStore, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return &PostgresStore{pool: pool}, nil
}

func (s *PostgresStore) Close() {
	if s.pool != nil {
		s.pool.Close()
	}
}

func (s *PostgresStore) UpsertMaquinaFromSnapshot(ctx context.Context, snap hub.MachineTelemetryDTO) error {
	const query = `
		INSERT INTO maquina_monitorada (
			machine_uid, usuario_so, hostname, sistema_operacional, versao_so,
			modelo_cpu, nucleos_cpu, memoria_total_mb, swap_total_mb,
			status_conexao, ultimo_heartbeat, atualizado_em
		) VALUES (
			$1, $2, $3, $4, $5,
			$6, $7, $8, $9,
			'online', NOW(), NOW()
		)
		ON CONFLICT (machine_uid) DO UPDATE SET
			usuario_so          = EXCLUDED.usuario_so,
			hostname            = EXCLUDED.hostname,
			sistema_operacional = EXCLUDED.sistema_operacional,
			versao_so           = EXCLUDED.versao_so,
			modelo_cpu          = EXCLUDED.modelo_cpu,
			nucleos_cpu         = EXCLUDED.nucleos_cpu,
			memoria_total_mb    = EXCLUDED.memoria_total_mb,
			swap_total_mb       = EXCLUDED.swap_total_mb,
			status_conexao      = 'online',
			ultimo_heartbeat    = NOW(),
			atualizado_em       = NOW()
	`
	_, err := s.pool.Exec(
		ctx,
		query,
		snap.MachineUID,
		snap.UsuarioSO,
		snap.Hostname,
		snap.OSName,
		snap.OSVersion,
		snap.CpuBrand,
		int(snap.CpuCores),
		int64(snap.MemoriaTotalMB),
		int64(snap.SwapTotalMB),
	)
	return err
}

func (s *PostgresStore) UpdateHeartbeat(ctx context.Context, machineUID, hostname, usuarioSO string) error {
	const query = `
		INSERT INTO maquina_monitorada (
			machine_uid, hostname, usuario_so, sistema_operacional, status_conexao, ultimo_heartbeat, atualizado_em
		) VALUES (
			$1, COALESCE(NULLIF($2, ''), 'estacao'), $3, 'N/A', 'online', NOW(), NOW()
		)
		ON CONFLICT (machine_uid) DO UPDATE SET
			hostname         = COALESCE(NULLIF($2, ''), maquina_monitorada.hostname),
			usuario_so       = COALESCE(NULLIF($3, ''), maquina_monitorada.usuario_so),
			status_conexao   = 'online',
			ultimo_heartbeat = NOW(),
			atualizado_em    = NOW()
	`
	_, err := s.pool.Exec(ctx, query, machineUID, hostname, usuarioSO)
	return err
}

func (s *PostgresStore) MarkMaquinasOffline(ctx context.Context, machineUIDs []string) error {
	if len(machineUIDs) == 0 {
		return nil
	}
	const query = `
		UPDATE maquina_monitorada
		SET status_conexao = 'offline', atualizado_em = NOW()
		WHERE machine_uid = ANY($1)
	`
	_, err := s.pool.Exec(ctx, query, machineUIDs)
	return err
}

func (s *PostgresStore) CriarRelatorioAutoavaliacao(
	ctx context.Context,
	idChamado *int,
	snap hub.MachineTelemetryDTO,
) (*RelatorioAutoavaliacaoDTO, error) {
	discosJSON, err := json.Marshal(snap.Discos)
	if err != nil {
		discosJSON = []byte("[]")
	}
	processosJSON, err := json.Marshal(snap.TopProcessos)
	if err != nil {
		processosJSON = []byte("[]")
	}

	var idMaquina *int
	var foundID int
	if err := s.pool.QueryRow(ctx, `SELECT id FROM maquina_monitorada WHERE machine_uid = $1`, snap.MachineUID).Scan(&foundID); err == nil {
		idMaquina = &foundID
	}

	var validChamadoID *int
	if idChamado != nil && *idChamado > 0 {
		var exists bool
		if err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM chamado WHERE id = $1)`, *idChamado).Scan(&exists); err == nil && exists {
			validChamadoID = idChamado
		}
	}

	const query = `
		INSERT INTO relatorio_autoavaliacao (
			id_chamado, id_maquina, machine_uid, hostname, usuario_so,
			sistema_operacional, versao_so, modelo_cpu, nucleos_cpu, uptime_segundos,
			cpu_usage_percent, memoria_total_mb, memoria_usada_mb, memoria_uso_percent,
			swap_total_mb, swap_usada_mb, discos, top_processos
		) VALUES (
			$1, $2, $3, $4, $5,
			$6, $7, $8, $9, $10,
			$11, $12, $13, $14,
			$15, $16, $17, $18
		)
		RETURNING id, coletado_em
	`

	var relID int
	var coletadoEm time.Time
	err = s.pool.QueryRow(
		ctx,
		query,
		validChamadoID,
		idMaquina,
		snap.MachineUID,
		snap.Hostname,
		snap.UsuarioSO,
		snap.OSName,
		snap.OSVersion,
		snap.CpuBrand,
		int(snap.CpuCores),
		int64(snap.UptimeSeconds),
		snap.CpuUsagePercent,
		int64(snap.MemoriaTotalMB),
		int64(snap.MemoriaUsadaMB),
		snap.MemoriaUsoPercent,
		int64(snap.SwapTotalMB),
		int64(snap.SwapUsadaMB),
		discosJSON,
		processosJSON,
	).Scan(&relID, &coletadoEm)
	if err != nil {
		return nil, err
	}

	return &RelatorioAutoavaliacaoDTO{
		ID:                 relID,
		IDChamado:          idChamado,
		IDMaquina:          idMaquina,
		MachineUID:         snap.MachineUID,
		Hostname:           snap.Hostname,
		UsuarioSO:          snap.UsuarioSO,
		SistemaOperacional: snap.OSName,
		VersaoSO:           snap.OSVersion,
		ModeloCPU:          snap.CpuBrand,
		NucleosCPU:         snap.CpuCores,
		UptimeSegundos:     snap.UptimeSeconds,
		CpuUsagePercent:    snap.CpuUsagePercent,
		MemoriaTotalMB:     snap.MemoriaTotalMB,
		MemoriaUsadaMB:     snap.MemoriaUsadaMB,
		MemoriaUsoPercent:  snap.MemoriaUsoPercent,
		SwapTotalMB:        snap.SwapTotalMB,
		SwapUsadaMB:        snap.SwapUsadaMB,
		Discos:             snap.Discos,
		TopProcessos:       snap.TopProcessos,
		ColetadoEm:         coletadoEm,
	}, nil
}

func (s *PostgresStore) ListarRelatoriosPorChamado(ctx context.Context, idChamado int) ([]RelatorioAutoavaliacaoDTO, error) {
	const query = `
		SELECT
			id, id_chamado, id_maquina, machine_uid, hostname, COALESCE(usuario_so, ''),
			sistema_operacional, COALESCE(versao_so, ''), COALESCE(modelo_cpu, ''), nucleos_cpu, uptime_segundos,
			cpu_usage_percent, memoria_total_mb, memoria_usada_mb, memoria_uso_percent,
			swap_total_mb, swap_usada_mb, discos, top_processos, coletado_em
		FROM relatorio_autoavaliacao
		WHERE id_chamado = $1
		ORDER BY coletado_em DESC
	`

	rows, err := s.pool.Query(ctx, query, idChamado)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []RelatorioAutoavaliacaoDTO
	for rows.Next() {
		var item RelatorioAutoavaliacaoDTO
		var nucleos int
		var uptime, memTotal, memUsada, swapTotal, swapUsada int64
		var discosRaw, procRaw []byte

		if err := rows.Scan(
			&item.ID,
			&item.IDChamado,
			&item.IDMaquina,
			&item.MachineUID,
			&item.Hostname,
			&item.UsuarioSO,
			&item.SistemaOperacional,
			&item.VersaoSO,
			&item.ModeloCPU,
			&nucleos,
			&uptime,
			&item.CpuUsagePercent,
			&memTotal,
			&memUsada,
			&item.MemoriaUsoPercent,
			&swapTotal,
			&swapUsada,
			&discosRaw,
			&procRaw,
			&item.ColetadoEm,
		); err != nil {
			return nil, err
		}

		item.NucleosCPU = uint32(nucleos)
		item.UptimeSegundos = uint64(uptime)
		item.MemoriaTotalMB = uint64(memTotal)
		item.MemoriaUsadaMB = uint64(memUsada)
		item.SwapTotalMB = uint64(swapTotal)
		item.SwapUsadaMB = uint64(swapUsada)

		_ = json.Unmarshal(discosRaw, &item.Discos)
		_ = json.Unmarshal(procRaw, &item.TopProcessos)
		if item.Discos == nil {
			item.Discos = []hub.DiscoDTO{}
		}
		if item.TopProcessos == nil {
			item.TopProcessos = []hub.ProcessoDTO{}
		}

		result = append(result, item)
	}

	return result, rows.Err()
}
