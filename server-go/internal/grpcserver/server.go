package grpcserver

import (
	"context"
	"io"
	"log"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"servicedesk/server-go/internal/hub"
	"servicedesk/server-go/internal/pb"
)

type TelemetryGrpcServer struct {
	pb.UnimplementedTelemetriaServiceServer
	hub *hub.TelemetryHub
}

func New(h *hub.TelemetryHub) *TelemetryGrpcServer {
	return &TelemetryGrpcServer{hub: h}
}

func (s *TelemetryGrpcServer) ObterTelemetria(
	ctx context.Context,
	_ *pb.TelemetriaRequest,
) (*pb.TelemetriaSnapshot, error) {
	snap, ok := s.hub.GetRawProto("")
	if !ok {
		return nil, status.Error(codes.NotFound, "nenhuma máquina monitorada disponível no momento")
	}
	return snap, nil
}

func (s *TelemetryGrpcServer) EnviarHeartbeat(
	ctx context.Context,
	req *pb.HeartbeatRequest,
) (*pb.HeartbeatResponse, error) {
	if req.GetMachineUid() == "" {
		return nil, status.Error(codes.InvalidArgument, "machine_uid é obrigatório")
	}

	s.hub.RecordHeartbeat(ctx, req.GetMachineUid(), req.GetHostname(), req.GetUsuarioSo())

	return &pb.HeartbeatResponse{
		Ok:                    true,
		ServerTimestampUnixMs: time.Now().UnixMilli(),
		IntervaloSegundos:     5,
	}, nil
}

func (s *TelemetryGrpcServer) StreamTelemetria(
	stream pb.TelemetriaService_StreamTelemetriaServer,
) error {
	var machineUID string
	var framesCount uint64

	for {
		snapshot, err := stream.Recv()
		if err == io.EOF {
			log.Printf("[gRPC] Stream encerrado normalmente pelo agente %s (%d snapshots recebidos)", machineUID, framesCount)
			return stream.SendAndClose(&pb.StreamControl{
				Aceito:            true,
				Mensagem:          "Stream recebido com sucesso pelo servidor Go",
				IntervaloSegundos: 2,
			})
		}
		if err != nil {
			if machineUID != "" {
				log.Printf("[gRPC] Conexão de stream interrompida para máquina %s: %v", machineUID, err)
			}
			return err
		}

		if machineUID == "" && snapshot.GetMachineUid() != "" {
			machineUID = snapshot.GetMachineUid()
			log.Printf("[gRPC] Novo stream de telemetria iniciado: machine_uid=%s hostname=%s SO=%s",
				machineUID, snapshot.GetHostname(), snapshot.GetOsName())
		}

		framesCount++
		s.hub.UpdateSnapshot(stream.Context(), snapshot)
	}
}
