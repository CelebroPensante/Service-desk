package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"servicedesk/server-go/internal/hub"
	"servicedesk/server-go/internal/pb"
)

func TestHttpEndpointsAndWebSocket(t *testing.T) {
	h := hub.New(nil)
	h.UpdateSnapshot(context.Background(), &pb.TelemetriaSnapshot{
		MachineUid:        "ws-machine-01",
		Hostname:          "ESTACAO-TI-01",
		UsuarioSo:         "tecnico.ti",
		OsName:            "Windows",
		OsVersion:         "11",
		CpuBrand:          "Intel Core i5",
		CpuCores:          6,
		CpuUsagePercent:   18.5,
		MemoriaTotalMb:    16384,
		MemoriaUsadaMb:    6144,
		MemoriaUsoPercent: 37.5,
	})

	apiSrv := NewServer(h, nil, "*")
	ts := httptest.NewServer(apiSrv.Handler())
	defer ts.Close()

	// 1. GET /health
	resHealth, err := http.Get(ts.URL + "/health")
	if err != nil || resHealth.StatusCode != http.StatusOK {
		t.Fatalf("GET /health falhou: status=%v err=%v", resHealth, err)
	}
	resHealth.Body.Close()

	// 2. GET /api/telemetria/maquinas
	resMaq, err := http.Get(ts.URL + "/api/telemetria/maquinas")
	if err != nil || resMaq.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/telemetria/maquinas falhou: %v", err)
	}
	var maquinas []hub.MachineTelemetryDTO
	if err := json.NewDecoder(resMaq.Body).Decode(&maquinas); err != nil {
		t.Fatalf("erro ao decodificar JSON de máquinas: %v", err)
	}
	resMaq.Body.Close()
	if len(maquinas) != 1 || maquinas[0].MachineUID != "ws-machine-01" {
		t.Fatalf("lista de máquinas inesperada: %+v", maquinas)
	}

	// 3. POST /api/telemetria/chamados/1/relatorio
	bodyBytes, _ := json.Marshal(map[string]any{"machineUid": "ws-machine-01"})
	resRel, err := http.Post(ts.URL+"/api/telemetria/chamados/1/relatorio", "application/json", bytes.NewReader(bodyBytes))
	if err != nil || resRel.StatusCode != http.StatusCreated {
		t.Fatalf("POST /api/telemetria/chamados/1/relatorio falhou: status=%d err=%v", resRel.StatusCode, err)
	}
	resRel.Body.Close()

	// 4. WebSocket em tempo real (/api/telemetria/maquinas/ws-machine-01/ws)
	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/api/telemetria/maquinas/ws-machine-01/ws"
	wsConn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("falha ao conectar WebSocket: %v", err)
	}
	defer wsConn.Close()

	// Deve receber o snapshot inicial imediatamente ao conectar
	_ = wsConn.SetReadDeadline(time.Now().Add(2 * time.Second))
	var initial hub.MachineTelemetryDTO
	if err := wsConn.ReadJSON(&initial); err != nil {
		t.Fatalf("erro ao ler snapshot inicial do WebSocket: %v", err)
	}
	if initial.CpuUsagePercent != 18.5 {
		t.Fatalf("esperava CPU inicial 18.5, obteve %.2f", initial.CpuUsagePercent)
	}

	// Atualiza o Hub e verifica se o frame novo chega em tempo real via WebSocket
	h.UpdateSnapshot(context.Background(), &pb.TelemetriaSnapshot{
		MachineUid:      "ws-machine-01",
		Hostname:        "ESTACAO-TI-01",
		CpuUsagePercent: 64.2,
	})

	_ = wsConn.SetReadDeadline(time.Now().Add(2 * time.Second))
	var updated hub.MachineTelemetryDTO
	if err := wsConn.ReadJSON(&updated); err != nil {
		t.Fatalf("erro ao ler atualização em tempo real do WebSocket: %v", err)
	}
	if updated.CpuUsagePercent != 64.2 {
		t.Fatalf("esperava CPU atualizada 64.2, obteve %.2f", updated.CpuUsagePercent)
	}
}
