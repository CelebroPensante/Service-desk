package config

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	GrpcPort        string
	HttpPort        string
	DatabaseURL     string
	HeartbeatWindow time.Duration
	AllowedOrigin   string
}

func Load() Config {
	grpcPort := getEnv("GRPC_PORT", "50051")
	httpPort := getEnv("HTTP_PORT", "8081")
	dbURL := getEnv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/servicedesk?sslmode=disable")
	allowedOrigin := getEnv("ALLOWED_ORIGIN", "*")

	timeoutSecs, err := strconv.Atoi(getEnv("HEARTBEAT_TIMEOUT_SECS", "12"))
	if err != nil || timeoutSecs < 3 {
		timeoutSecs = 12
	}

	return Config{
		GrpcPort:        grpcPort,
		HttpPort:        httpPort,
		DatabaseURL:     dbURL,
		HeartbeatWindow: time.Duration(timeoutSecs) * time.Second,
		AllowedOrigin:   allowedOrigin,
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
