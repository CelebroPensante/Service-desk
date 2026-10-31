package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"
	"google.golang.org/grpc"

	"servicedesk/server-go/internal/config"
	"servicedesk/server-go/internal/grpcserver"
	"servicedesk/server-go/internal/httpapi"
	"servicedesk/server-go/internal/hub"
	"servicedesk/server-go/internal/pb"
	"servicedesk/server-go/internal/remote"
	"servicedesk/server-go/internal/storage"
)

func main() {
	if err := godotenv.Load(); err != nil {
		_ = godotenv.Load("../backend/.env")
	}
	cfg := config.Load()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	var pgStore *storage.PostgresStore
	var persistence hub.PersistenceStore

	dbCtx, cancelDB := context.WithTimeout(ctx, 5*time.Second)
	store, err := storage.NewPostgresStore(dbCtx, cfg.DatabaseURL)
	cancelDB()
	if err != nil {
		log.Printf("[DB] Aviso: não foi possível conectar ao PostgreSQL (%v). Operando em modo memória em tempo real.", err)
	} else {
		log.Println("[DB] Conectado ao PostgreSQL com sucesso.")
		pgStore = store
		persistence = store
		defer pgStore.Close()
	}

	telemetryHub := hub.New(persistence)
	go telemetryHub.StartWatchdog(ctx, cfg.HeartbeatWindow)

	// Acesso remoto reutiliza a API de autenticação e o PostgreSQL existentes.
	var remoteRepo remote.Repository
	if pgStore != nil {
		remoteRepo = pgStore
	}
	var ice []map[string]any
	if raw := os.Getenv("REMOTE_ICE_SERVERS"); raw != "" {
		if err := json.Unmarshal([]byte(raw), &ice); err != nil {
			log.Fatalf("REMOTE_ICE_SERVERS inválido: %v", err)
		}
	}
	apiURL := os.Getenv("API_BASE_URL")
	if apiURL == "" {
		apiURL = "http://127.0.0.1:8080"
	}
	origins := os.Getenv("REMOTE_ALLOWED_ORIGINS")
	if origins == "" {
		origins = "http://localhost:5173,http://127.0.0.1:5173,http://tauri.localhost,tauri://localhost"
	}
	remoteServer := remote.New(remote.APIAuth(apiURL), remoteRepo, origins, ice)
	defer remoteServer.Close()
	mux := http.NewServeMux()
	remoteServer.Register(mux)
	mux.Handle("/", httpapi.NewServer(telemetryHub, pgStore, cfg.AllowedOrigin).Handler())
	// 1. Servidor HTTP / WebSocket (porta 8081)
	httpSrv := &http.Server{
		Addr:              ":" + cfg.HttpPort,
		Handler:           remote.CORS(origins, mux),
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		log.Printf("API HTTP/WebSocket de Telemetria rodando em http://0.0.0.0:%s", cfg.HttpPort)
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("erro no servidor HTTP: %v", err)
		}
	}()

	// 2. Servidor gRPC (porta 50051)
	lis, err := net.Listen("tcp", ":"+cfg.GrpcPort)
	if err != nil {
		log.Fatalf("falha ao escutar na porta gRPC %s: %v", cfg.GrpcPort, err)
	}

	grpcSrv := grpc.NewServer()
	pb.RegisterTelemetriaServiceServer(grpcSrv, grpcserver.New(telemetryHub))

	go func() {
		<-ctx.Done()
		log.Println("Encerrando servidor Go de telemetria...")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		remoteServer.Close()
		_ = httpSrv.Shutdown(shutdownCtx)
		grpcSrv.GracefulStop()
	}()

	log.Printf("Servidor Go gRPC de Telemetria rodando em 0.0.0.0:%s (tolerância Heartbeat: %v)", cfg.GrpcPort, cfg.HeartbeatWindow)
	if err := grpcSrv.Serve(lis); err != nil {
		log.Fatalf("erro no servidor gRPC: %v", err)
	}
}
