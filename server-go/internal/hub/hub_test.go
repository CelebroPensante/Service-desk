package hub

import (
	"context"
	"sync"
	"testing"
	"time"

	"servicedesk/server-go/internal/pb"
)

type mockStore struct {
	mu           sync.Mutex
	upserts      int
	heartbeats   int
	offlineMarks []string
}

func (m *mockStore) UpsertMaquinaFromSnapshot(_ context.Context, _ MachineTelemetryDTO) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.upserts++
	return nil
}

func (m *mockStore) UpdateHeartbeat(_ context.Context, _, _, _ string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.heartbeats++
	return nil
}

func (m *mockStore) MarkMaquinasOffline(_ context.Context, uids []string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.offlineMarks = append(m.offlineMarks, uids...)
	return nil
}

func TestHubUpdateSnapshotAndListMachines(t *testing.T) {
	store := &mockStore{}
	h := New(store)

	snap := &pb.TelemetriaSnapshot{
		MachineUid:        "pc-financas-01",
		Hostname:          "FINANCAS-01",
		UsuarioSo:         "ana.pereira",
		OsName:            "Windows",
		OsVersion:         "11 Pro",
		CpuBrand:          "Intel Core i7",
		CpuCores:          8,
		UptimeSeconds:     7200,
		CpuUsagePercent:   42.5,
		MemoriaTotalMb:    16384,
		MemoriaUsadaMb:    8192,
		MemoriaUsoPercent: 50.0,
		SwapTotalMb:       4096,
		SwapUsadaMb:       512,
		Discos: []*pb.DiscoInfo{
			{PontoMontagem: "C:\\", SistemaArquivos: "NTFS", TotalGb: 500, LivreGb: 250, UsoPercent: 50},
		},
		TopProcessos: []*pb.ProcessoInfo{
			{Pid: 1234, Nome: "chrome.exe", CpuUsagePercent: 12.4, MemoriaMb: 1024},
		},
	}

	dto := h.UpdateSnapshot(context.Background(), snap)
	if dto.MachineUID != "pc-financas-01" || dto.StatusConexao != "online" {
		t.Fatalf("esperado machine_uid=pc-financas-01 online, obtido: %+v", dto)
	}

	got, ok := h.GetMachine("pc-financas-01")
	if !ok {
		t.Fatal("esperava encontrar máquina pc-financas-01 no hub")
	}
	if got.MemoriaTotalMB != 16384 || len(got.Discos) != 1 || len(got.TopProcessos) != 1 {
		t.Fatalf("dados inconsistentes no snapshot armazenado: %+v", got)
	}

	list := h.ListMachines()
	if len(list) != 1 {
		t.Fatalf("esperado 1 máquina na listagem, obtido %d", len(list))
	}

	if store.upserts != 1 {
		t.Fatalf("esperado 1 upsert no repositório, obtido %d", store.upserts)
	}
}

func TestHubPubSubSubscription(t *testing.T) {
	h := New(nil)
	ch, unsub := h.Subscribe("pc-suporte-02")
	defer unsub()

	h.UpdateSnapshot(context.Background(), &pb.TelemetriaSnapshot{
		MachineUid:      "pc-suporte-02",
		Hostname:        "SUPORTE-02",
		CpuUsagePercent: 77.3,
	})

	select {
	case received := <-ch:
		if received.CpuUsagePercent != 77.3 {
			t.Fatalf("esperado CPU=77.3%%, obtido %.2f%%", received.CpuUsagePercent)
		}
	case <-time.After(1 * time.Second):
		t.Fatal("timeout aguardando notificação Pub/Sub do Hub")
	}
}

func TestHubWatchdogMarksOffline(t *testing.T) {
	store := &mockStore{}
	h := New(store)

	h.RecordHeartbeat(context.Background(), "pc-timeout-01", "TIMEOUT-PC", "user1")

	// Força o último heartbeat para o passado para testar o vencimento da janela
	h.mu.Lock()
	h.machines["pc-timeout-01"].UltimoHeartbeat = time.Now().Add(-15 * time.Second)
	h.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 3500*time.Millisecond)
	defer cancel()
	h.StartWatchdog(ctx, 5*time.Second)

	m, ok := h.GetMachine("pc-timeout-01")
	if !ok {
		t.Fatal("máquina deveria continuar registrada no hub")
	}
	if m.StatusConexao != "offline" {
		t.Fatalf("esperado status 'offline' após watchdog, obtido '%s'", m.StatusConexao)
	}

	store.mu.Lock()
	defer store.mu.Unlock()
	if len(store.offlineMarks) != 1 || store.offlineMarks[0] != "pc-timeout-01" {
		t.Fatalf("esperado que watchdog marcasse pc-timeout-01 offline no banco, obtido: %v", store.offlineMarks)
	}
}
