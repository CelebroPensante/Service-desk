package grpcserver

import (
	"context"
	"net"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	"servicedesk/server-go/internal/hub"
	"servicedesk/server-go/internal/pb"
)

func TestGrpcServerHeartbeatAndStreamTelemetria(t *testing.T) {
	h := hub.New(nil)
	lis, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("falha ao abrir listener local: %v", err)
	}

	srv := grpc.NewServer()
	pb.RegisterTelemetriaServiceServer(srv, New(h))
	go func() {
		_ = srv.Serve(lis)
	}()
	defer srv.Stop()

	conn, err := grpc.NewClient(lis.Addr().String(), grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("falha ao conectar cliente gRPC: %v", err)
	}
	defer conn.Close()

	client := pb.NewTelemetriaServiceClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// 1. Teste de Heartbeat via gRPC
	hbResp, err := client.EnviarHeartbeat(ctx, &pb.HeartbeatRequest{
		MachineUid:      "grpc-test-uid",
		Hostname:        "GRPC-TEST-HOST",
		UsuarioSo:       "luis.castro",
		TimestampUnixMs: time.Now().UnixMilli(),
	})
	if err != nil {
		t.Fatalf("erro em EnviarHeartbeat: %v", err)
	}
	if !hbResp.GetOk() {
		t.Fatalf("esperava ok=true no HeartbeatResponse")
	}

	// 2. Teste de Stream contínuo de Telemetria via gRPC
	stream, err := client.StreamTelemetria(ctx)
	if err != nil {
		t.Fatalf("erro ao abrir StreamTelemetria: %v", err)
	}

	frames := []*pb.TelemetriaSnapshot{
		{
			MachineUid:        "grpc-test-uid",
			Hostname:          "GRPC-TEST-HOST",
			UsuarioSo:         "luis.castro",
			OsName:            "Windows",
			OsVersion:         "11",
			CpuBrand:          "AMD Ryzen",
			CpuCores:          12,
			CpuUsagePercent:   25.4,
			MemoriaTotalMb:    32768,
			MemoriaUsadaMb:    12400,
			MemoriaUsoPercent: 37.8,
		},
		{
			MachineUid:        "grpc-test-uid",
			Hostname:          "GRPC-TEST-HOST",
			UsuarioSo:         "luis.castro",
			OsName:            "Windows",
			OsVersion:         "11",
			CpuBrand:          "AMD Ryzen",
			CpuCores:          12,
			CpuUsagePercent:   31.8,
			MemoriaTotalMb:    32768,
			MemoriaUsadaMb:    12950,
			MemoriaUsoPercent: 39.5,
		},
	}

	for _, f := range frames {
		if err := stream.Send(f); err != nil {
			t.Fatalf("erro ao enviar frame no stream: %v", err)
		}
	}

	ctrl, err := stream.CloseAndRecv()
	if err != nil {
		t.Fatalf("erro ao fechar stream: %v", err)
	}
	if !ctrl.GetAceito() {
		t.Fatalf("esperava StreamControl.Aceito = true")
	}

	// 3. Verifica ObterTelemetria após o stream
	gotSnap, err := client.ObterTelemetria(ctx, &pb.TelemetriaRequest{IncluirDiscos: true, IncluirProcessos: true})
	if err != nil {
		t.Fatalf("erro em ObterTelemetria: %v", err)
	}
	if gotSnap.GetCpuUsagePercent() != 31.8 || gotSnap.GetMemoriaUsadaMb() != 12950 {
		t.Fatalf("snapshot retornado diferente do último enviado no stream: %+v", gotSnap)
	}
}
