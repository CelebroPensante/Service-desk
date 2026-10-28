package main

import (
	"context"
	"log"
	"net"
	"os"
	"os/signal"
	"syscall"

	"github.com/joho/godotenv"
	"google.golang.org/grpc"

	"servicedesk/server-go/internal/config"
	"servicedesk/server-go/internal/grpcserver"
	"servicedesk/server-go/internal/hub"
	"servicedesk/server-go/internal/pb"
)

func main() {
	_ = godotenv.Load()
	cfg := config.Load()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	telemetryHub := hub.New(nil)
	go telemetryHub.StartWatchdog(ctx, cfg.HeartbeatWindow)

	lis, err := net.Listen("tcp", ":"+cfg.GrpcPort)
	if err != nil {
		log.Fatalf("falha ao escutar na porta gRPC %s: %v", cfg.GrpcPort, err)
	}

	grpcSrv := grpc.NewServer()
	pb.RegisterTelemetriaServiceServer(grpcSrv, grpcserver.New(telemetryHub))

	go func() {
		<-ctx.Done()
		log.Println("Encerrando servidor Go de telemetria...")
		grpcSrv.GracefulStop()
	}()

	log.Printf("Servidor Go gRPC de Telemetria rodando na porta :%s (tolerância Heartbeat: %v)", cfg.GrpcPort, cfg.HeartbeatWindow)
	if err := grpcSrv.Serve(lis); err != nil {
		log.Fatalf("erro no servidor gRPC: %v", err)
	}
}
