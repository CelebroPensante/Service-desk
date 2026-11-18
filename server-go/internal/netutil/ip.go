// Package netutil normaliza endereços de clientes para identificar a estação de origem.
package netutil

import (
	"net"
	"strings"
)

// Loopback é o endereço usado para qualquer conexão vinda do próprio servidor.
const Loopback = "127.0.0.1"

// HostIP extrai o IP de um endereço "host:porta" (ex.: http.Request.RemoteAddr ou
// peer.Addr do gRPC). Conexões do próprio servidor, seja por localhost ou pelo IP
// de rede dele, viram Loopback: assim o agente local (conectado em 127.0.0.1) e o
// navegador local (que pode usar o IP da rede) são reconhecidos como a mesma estação.
func HostIP(addr string) string {
	host, _, err := net.SplitHostPort(strings.TrimSpace(addr))
	if err != nil {
		host = strings.TrimSpace(addr)
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return host
	}
	if ip.IsLoopback() || isLocal(ip) {
		return Loopback
	}
	if v4 := ip.To4(); v4 != nil {
		return v4.String()
	}
	return ip.String()
}

// isLocal informa se o IP pertence a uma interface desta máquina. A lista é lida a
// cada chamada porque o IP muda ao trocar de rede (ex.: hotspot).
func isLocal(ip net.IP) bool {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return false
	}
	for _, a := range addrs {
		if n, ok := a.(*net.IPNet); ok && n.IP.Equal(ip) {
			return true
		}
	}
	return false
}
