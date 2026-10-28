package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/gorilla/websocket"

	"servicedesk/server-go/internal/hub"
	"servicedesk/server-go/internal/storage"
)

type Server struct {
	hub           *hub.TelemetryHub
	store         *storage.PostgresStore
	allowedOrigin string
	upgrader      websocket.Upgrader
}

func NewServer(h *hub.TelemetryHub, store *storage.PostgresStore, allowedOrigin string) *Server {
	return &Server{
		hub:           h,
		store:         store,
		allowedOrigin: allowedOrigin,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("GET /api/telemetria/maquinas", s.handleListarMaquinas)
	mux.HandleFunc("GET /api/telemetria/maquinas/{machine_uid}", s.handleObterMaquina)
	mux.HandleFunc("GET /api/telemetria/ws", s.handleWebSocket)
	mux.HandleFunc("GET /api/telemetria/maquinas/{machine_uid}/ws", s.handleWebSocket)
	mux.HandleFunc("POST /api/telemetria/chamados/{id}/relatorio", s.handleCriarRelatorioChamado)
	mux.HandleFunc("GET /api/telemetria/chamados/{id}/relatorio", s.handleListarRelatoriosChamado)

	return s.corsMiddleware(mux)
}

func (s *Server) corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := s.allowedOrigin
		if origin == "" {
			origin = "*"
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":    "ok",
		"servico":   "servicedesk-server-go",
		"timestamp": time.Now().Format(time.RFC3339),
	})
}

func (s *Server) handleListarMaquinas(w http.ResponseWriter, _ *http.Request) {
	maquinas := s.hub.ListMachines()
	writeJSON(w, http.StatusOK, maquinas)
}

func (s *Server) handleObterMaquina(w http.ResponseWriter, r *http.Request) {
	uid := r.PathValue("machine_uid")
	if uid == "atual" || uid == "default" {
		uid = ""
	}
	m, ok := s.hub.GetMachine(uid)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{
			"erro": "Nenhuma estação monitorada ativa encontrada",
		})
		return
	}
	writeJSON(w, http.StatusOK, m)
}

func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	uid := r.PathValue("machine_uid")
	if uid == "" || uid == "atual" || uid == "todas" {
		uid = "*"
	}

	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	// Envia estado imediato se disponível
	targetLookup := uid
	if targetLookup == "*" {
		targetLookup = ""
	}
	if initial, ok := s.hub.GetMachine(targetLookup); ok {
		_ = conn.WriteJSON(initial)
	}

	ch, unsubscribe := s.hub.Subscribe(uid)
	defer unsubscribe()

	// Goroutine que detecta fechamento pelo cliente
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()

	for {
		select {
		case <-done:
			return
		case <-r.Context().Done():
			return
		case snap, ok := <-ch:
			if !ok {
				return
			}
			_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if err := conn.WriteJSON(snap); err != nil {
				return
			}
		}
	}
}

type criarRelatorioBody struct {
	MachineUID string                   `json:"machineUid"`
	Snapshot   *hub.MachineTelemetryDTO `json:"snapshot,omitempty"`
}

func (s *Server) handleCriarRelatorioChamado(w http.ResponseWriter, r *http.Request) {
	idChamado, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || idChamado <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"erro": "ID do chamado inválido"})
		return
	}

	var body criarRelatorioBody
	_ = json.NewDecoder(r.Body).Decode(&body)

	var snap hub.MachineTelemetryDTO
	if body.Snapshot != nil && body.Snapshot.MachineUID != "" {
		snap = *body.Snapshot
	} else {
		found, ok := s.hub.GetMachine(body.MachineUID)
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]string{
				"erro": "Agente de telemetria não encontrado para capturar o relatório da máquina",
			})
			return
		}
		snap = found
	}

	if s.store == nil {
		// Fallback em memória caso o PostgreSQL não esteja ativo no ambiente de teste
		writeJSON(w, http.StatusCreated, storage.RelatorioAutoavaliacaoDTO{
			ID:                 1,
			IDChamado:          &idChamado,
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
			ColetadoEm:         time.Now(),
		})
		return
	}

	relatorio, err := s.store.CriarRelatorioAutoavaliacao(r.Context(), &idChamado, snap)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"erro": "Falha ao salvar relatório de autoavaliação no banco: " + err.Error(),
		})
		return
	}

	writeJSON(w, http.StatusCreated, relatorio)
}

func (s *Server) handleListarRelatoriosChamado(w http.ResponseWriter, r *http.Request) {
	idChamado, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || idChamado <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"erro": "ID do chamado inválido"})
		return
	}

	if s.store == nil {
		writeJSON(w, http.StatusOK, []storage.RelatorioAutoavaliacaoDTO{})
		return
	}

	relatorios, err := s.store.ListarRelatoriosPorChamado(r.Context(), idChamado)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"erro": "Falha ao consultar relatórios do chamado: " + err.Error(),
		})
		return
	}
	if relatorios == nil {
		relatorios = []storage.RelatorioAutoavaliacaoDTO{}
	}

	writeJSON(w, http.StatusOK, relatorios)
}
