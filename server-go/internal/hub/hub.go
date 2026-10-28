package hub

import (
	"context"
	"log"
	"sort"
	"sync"
	"time"

	"servicedesk/server-go/internal/pb"
)

type DiscoDTO struct {
	PontoMontagem   string  `json:"pontoMontagem"`
	SistemaArquivos string  `json:"sistemaArquivos"`
	TotalGB         float64 `json:"totalGb"`
	LivreGB         float64 `json:"livreGb"`
	UsoPercent      float32 `json:"usoPercent"`
}

type ProcessoDTO struct {
	PID             uint32  `json:"pid"`
	Nome            string  `json:"nome"`
	CpuUsagePercent float32 `json:"cpuUsagePercent"`
	MemoriaMB       uint64  `json:"memoriaMb"`
}

type MachineTelemetryDTO struct {
	MachineUID        string        `json:"machineUid"`
	Hostname          string        `json:"hostname"`
	UsuarioSO         string        `json:"usuarioSo"`
	OSName            string        `json:"osName"`
	OSVersion         string        `json:"osVersion"`
	CpuBrand          string        `json:"cpuBrand"`
	CpuCores          uint32        `json:"cpuCores"`
	UptimeSeconds     uint64        `json:"uptimeSeconds"`
	CpuUsagePercent   float32       `json:"cpuUsagePercent"`
	MemoriaTotalMB    uint64        `json:"memoriaTotalMb"`
	MemoriaUsadaMB    uint64        `json:"memoriaUsadaMb"`
	MemoriaUsoPercent float32       `json:"memoriaUsoPercent"`
	SwapTotalMB       uint64        `json:"swapTotalMb"`
	SwapUsadaMB       uint64        `json:"swapUsadaMb"`
	Discos            []DiscoDTO    `json:"discos"`
	TopProcessos      []ProcessoDTO `json:"topProcessos"`
	StatusConexao     string        `json:"statusConexao"`
	UltimoHeartbeat   time.Time     `json:"ultimoHeartbeat"`
	ColetadoEmUnixMs  int64         `json:"coletadoEmUnixMs"`
}

// PersistenceStore define os callbacks opcionais para persistência em banco de dados.
type PersistenceStore interface {
	UpsertMaquinaFromSnapshot(ctx context.Context, snap MachineTelemetryDTO) error
	UpdateHeartbeat(ctx context.Context, machineUID, hostname, usuarioSO string) error
	MarkMaquinasOffline(ctx context.Context, machineUIDs []string) error
}

type TelemetryHub struct {
	mu          sync.RWMutex
	machines    map[string]*MachineTelemetryDTO
	rawProtos   map[string]*pb.TelemetriaSnapshot
	subscribers map[string]map[chan MachineTelemetryDTO]struct{}
	store       PersistenceStore
}

func New(store PersistenceStore) *TelemetryHub {
	return &TelemetryHub{
		machines:    make(map[string]*MachineTelemetryDTO),
		rawProtos:   make(map[string]*pb.TelemetriaSnapshot),
		subscribers: make(map[string]map[chan MachineTelemetryDTO]struct{}),
		store:       store,
	}
}

func FromProtoSnapshot(snap *pb.TelemetriaSnapshot) MachineTelemetryDTO {
	discos := make([]DiscoDTO, 0, len(snap.GetDiscos()))
	for _, d := range snap.GetDiscos() {
		discos = append(discos, DiscoDTO{
			PontoMontagem:   d.GetPontoMontagem(),
			SistemaArquivos: d.GetSistemaArquivos(),
			TotalGB:         d.GetTotalGb(),
			LivreGB:         d.GetLivreGb(),
			UsoPercent:      d.GetUsoPercent(),
		})
	}

	processos := make([]ProcessoDTO, 0, len(snap.GetTopProcessos()))
	for _, p := range snap.GetTopProcessos() {
		processos = append(processos, ProcessoDTO{
			PID:             p.GetPid(),
			Nome:            p.GetNome(),
			CpuUsagePercent: p.GetCpuUsagePercent(),
			MemoriaMB:       p.GetMemoriaMb(),
		})
	}

	now := time.Now()
	coletadoMs := snap.GetColetadoEmUnixMs()
	if coletadoMs == 0 {
		coletadoMs = now.UnixMilli()
	}

	return MachineTelemetryDTO{
		MachineUID:        snap.GetMachineUid(),
		Hostname:          snap.GetHostname(),
		UsuarioSO:         snap.GetUsuarioSo(),
		OSName:            snap.GetOsName(),
		OSVersion:         snap.GetOsVersion(),
		CpuBrand:          snap.GetCpuBrand(),
		CpuCores:          snap.GetCpuCores(),
		UptimeSeconds:     snap.GetUptimeSeconds(),
		CpuUsagePercent:   snap.GetCpuUsagePercent(),
		MemoriaTotalMB:    snap.GetMemoriaTotalMb(),
		MemoriaUsadaMB:    snap.GetMemoriaUsadaMb(),
		MemoriaUsoPercent: snap.GetMemoriaUsoPercent(),
		SwapTotalMB:       snap.GetSwapTotalMb(),
		SwapUsadaMB:       snap.GetSwapUsadaMb(),
		Discos:            discos,
		TopProcessos:      processos,
		StatusConexao:     "online",
		UltimoHeartbeat:   now,
		ColetadoEmUnixMs:  coletadoMs,
	}
}

func (h *TelemetryHub) UpdateSnapshot(ctx context.Context, snap *pb.TelemetriaSnapshot) MachineTelemetryDTO {
	dto := FromProtoSnapshot(snap)

	h.mu.Lock()
	h.machines[dto.MachineUID] = &dto
	h.rawProtos[dto.MachineUID] = snap

	// Notifica assinantes específicos da máquina e assinantes globais ("*")
	var targets []chan MachineTelemetryDTO
	for ch := range h.subscribers[dto.MachineUID] {
		targets = append(targets, ch)
	}
	for ch := range h.subscribers["*"] {
		targets = append(targets, ch)
	}
	h.mu.Unlock()

	for _, ch := range targets {
		select {
		case ch <- dto:
		default:
		}
	}

	if h.store != nil {
		if err := h.store.UpsertMaquinaFromSnapshot(ctx, dto); err != nil {
			log.Printf("[Hub] aviso: falha ao persistir snapshot da máquina %s: %v", dto.MachineUID, err)
		}
	}

	return dto
}

func (h *TelemetryHub) RecordHeartbeat(ctx context.Context, machineUID, hostname, usuarioSO string) {
	now := time.Now()

	h.mu.Lock()
	if m, exists := h.machines[machineUID]; exists {
		m.StatusConexao = "online"
		m.UltimoHeartbeat = now
		if hostname != "" {
			m.Hostname = hostname
		}
		if usuarioSO != "" {
			m.UsuarioSO = usuarioSO
		}
	} else {
		h.machines[machineUID] = &MachineTelemetryDTO{
			MachineUID:      machineUID,
			Hostname:        hostname,
			UsuarioSO:       usuarioSO,
			StatusConexao:   "online",
			UltimoHeartbeat: now,
			Discos:          []DiscoDTO{},
			TopProcessos:    []ProcessoDTO{},
		}
	}
	h.mu.Unlock()

	if h.store != nil {
		if err := h.store.UpdateHeartbeat(ctx, machineUID, hostname, usuarioSO); err != nil {
			log.Printf("[Hub] aviso: falha ao atualizar heartbeat no banco (%s): %v", machineUID, err)
		}
	}
}

func (h *TelemetryHub) GetMachine(machineUID string) (MachineTelemetryDTO, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	if machineUID == "" {
		// Se não informado, retorna a máquina online mais recente
		for _, m := range h.machines {
			if m.StatusConexao == "online" {
				return *m, true
			}
		}
		for _, m := range h.machines {
			return *m, true
		}
		return MachineTelemetryDTO{}, false
	}

	m, ok := h.machines[machineUID]
	if !ok {
		return MachineTelemetryDTO{}, false
	}
	return *m, true
}

func (h *TelemetryHub) GetRawProto(machineUID string) (*pb.TelemetriaSnapshot, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	if machineUID == "" {
		for _, p := range h.rawProtos {
			return p, true
		}
		return nil, false
	}
	p, ok := h.rawProtos[machineUID]
	return p, ok
}

func (h *TelemetryHub) ListMachines() []MachineTelemetryDTO {
	h.mu.RLock()
	defer h.mu.RUnlock()

	list := make([]MachineTelemetryDTO, 0, len(h.machines))
	for _, m := range h.machines {
		list = append(list, *m)
	}

	sort.Slice(list, func(i, j int) bool {
		if list[i].StatusConexao != list[j].StatusConexao {
			return list[i].StatusConexao == "online"
		}
		return list[i].Hostname < list[j].Hostname
	})

	return list
}

func (h *TelemetryHub) Subscribe(machineUID string) (chan MachineTelemetryDTO, func()) {
	if machineUID == "" {
		machineUID = "*"
	}
	ch := make(chan MachineTelemetryDTO, 8)

	h.mu.Lock()
	if h.subscribers[machineUID] == nil {
		h.subscribers[machineUID] = make(map[chan MachineTelemetryDTO]struct{})
	}
	h.subscribers[machineUID][ch] = struct{}{}
	h.mu.Unlock()

	unsubscribe := func() {
		h.mu.Lock()
		if subs, ok := h.subscribers[machineUID]; ok {
			delete(subs, ch)
		}
		h.mu.Unlock()
		close(ch)
	}

	return ch, unsubscribe
}

// StartWatchdog monitora periodicamente a janela de tolerância de Heartbeat
// e classifica automaticamente como "offline" as máquinas que deixaram de enviar sinal.
func (h *TelemetryHub) StartWatchdog(ctx context.Context, tolerance time.Duration) {
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			var becameOffline []string

			h.mu.Lock()
			for uid, m := range h.machines {
				if m.StatusConexao == "online" && now.Sub(m.UltimoHeartbeat) > tolerance {
					m.StatusConexao = "offline"
					becameOffline = append(becameOffline, uid)
					log.Printf("[Watchdog] Máquina %s (%s) classificada como OFFLINE (sem sinal há > %v)", uid, m.Hostname, tolerance)
				}
			}
			h.mu.Unlock()

			if len(becameOffline) > 0 && h.store != nil {
				if err := h.store.MarkMaquinasOffline(ctx, becameOffline); err != nil {
					log.Printf("[Watchdog] falha ao marcar máquinas offline no banco: %v", err)
				}
			}
		}
	}
}
