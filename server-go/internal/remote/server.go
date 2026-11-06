package remote

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type peer struct {
	conn        *websocket.Conn
	mu          sync.Mutex
	user        User
	sessionID   string
	code        string
	machineUID  string
	hostname    string
	monitors    []MonitorInfo
	pairExpires time.Time
}

func (p *peer) send(m Message) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.conn.SetWriteDeadline(time.Now().Add(3 * time.Second))
	return p.conn.WriteJSON(m)
}

func (p *peer) sendBinary(raw []byte) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.conn.SetWriteDeadline(time.Now().Add(3 * time.Second))
	return p.conn.WriteMessage(websocket.BinaryMessage, raw)
}

func (p *peer) close() { p.conn.Close() }

type Server struct {
	mu              sync.Mutex
	auth            Authenticator
	repo            Repository
	origin          string
	ice             any
	sessions        map[int]*Session
	machineSessions map[string]*Session
	agents          map[string]*peer
	agentsByMachine map[string]*peer
	stop            chan struct{}
	once            sync.Once
}

func New(auth Authenticator, repo Repository, origin string, ice any) *Server {
	s := &Server{
		auth:            auth,
		repo:            repo,
		origin:          origin,
		ice:             ice,
		sessions:        map[int]*Session{},
		machineSessions: map[string]*Session{},
		agents:          map[string]*peer{},
		agentsByMachine: map[string]*peer{},
		stop:            make(chan struct{}),
	}
	go s.watch()
	return s
}

func (s *Server) Close() {
	s.once.Do(func() {
		close(s.stop)
		s.mu.Lock()
		defer s.mu.Unlock()
		for _, v := range s.sessions {
			s.end(v, 0)
		}
		for _, v := range s.machineSessions {
			s.end(v, 0)
		}
		for _, a := range s.agents {
			a.close()
		}
		for _, a := range s.agentsByMachine {
			a.close()
		}
	})
}

func (s *Server) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/remoto/config", s.configuration)
	mux.HandleFunc("GET /api/remoto/ativas", s.activeSessionsHTTP)
	mux.HandleFunc("GET /api/remoto/maquinas", s.listMachinesHTTP)
	mux.HandleFunc("GET /api/remoto/maquinas/{uid}", s.machineHTTP)
	mux.HandleFunc("POST /api/remoto/maquinas/{uid}", s.machineHTTP)
	mux.HandleFunc("POST /api/remoto/maquinas/{uid}/autorizar", s.machineAuthorizeHTTP)
	mux.HandleFunc("GET /api/remoto/maquinas/{uid}/ws", s.machineWS)
	mux.HandleFunc("GET /api/remoto/chamados/{id}", s.ticketHTTP)
	mux.HandleFunc("POST /api/remoto/chamados/{id}", s.ticketHTTP)
	mux.HandleFunc("GET /api/remoto/chamados/{id}/historico", s.historyHTTP)
	mux.HandleFunc("GET /api/remoto/chamados/{id}/ws", s.ticketWS)
	mux.HandleFunc("GET /api/remoto/agente/ws", s.agentWS)
}

func respond(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func reject(w http.ResponseWriter, status int) {
	respond(w, status, map[string]string{"erro": http.StatusText(status)})
}

func rejectMsg(w http.ResponseWriter, status int, msg string) {
	respond(w, status, map[string]string{"erro": msg})
}

func (s *Server) identify(r *http.Request, token string) (User, Ticket, int, int) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id <= 0 {
		return User{}, Ticket{}, 0, 400
	}
	u, err := s.auth(r.Context(), token)
	if err != nil {
		return u, Ticket{}, id, 401
	}
	if s.repo == nil {
		return u, Ticket{}, id, 503
	}
	ticket, err := s.repo.Ticket(r.Context(), id)
	if err != nil {
		return u, ticket, id, 404
	}
	if u.ID != ticket.OwnerID && u.Level < 2 {
		return u, ticket, id, 403
	}
	return u, ticket, id, 0
}

func bearer(r *http.Request) string {
	return strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
}

func (s *Server) configuration(w http.ResponseWriter, r *http.Request) {
	if _, err := s.auth(r.Context(), bearer(r)); err != nil {
		reject(w, 401)
		return
	}
	ice := s.ice
	if ice == nil || (reflect.ValueOf(ice).Kind() == reflect.Slice && reflect.ValueOf(ice).IsNil()) {
		ice = []any{}
	}
	respond(w, 200, map[string]any{"iceServers": ice})
}

func (s *Server) activeSessionsHTTP(w http.ResponseWriter, r *http.Request) {
	u, err := s.auth(r.Context(), bearer(r))
	if err != nil {
		reject(w, 401)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	active := []*Session{}
	for _, v := range s.sessions {
		if v.OwnerID == u.ID || u.Level >= 2 {
			active = append(active, v)
		}
	}
	for _, v := range s.machineSessions {
		active = append(active, v)
	}
	respond(w, 200, map[string]any{"sessions": active})
}

func (s *Server) listMachinesHTTP(w http.ResponseWriter, r *http.Request) {
	u, err := s.auth(r.Context(), bearer(r))
	if err != nil {
		reject(w, 401)
		return
	}
	if u.Level < 2 {
		reject(w, 403)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	list := []AgentStatus{}
	for uid, a := range s.agentsByMachine {
		st := AgentStatus{
			MachineUID: uid,
			Hostname:   a.hostname,
			Online:     true,
			Monitors:   a.monitors,
			InSession:  a.sessionID != "",
		}
		if sess := s.machineSessions[uid]; sess != nil {
			st.Technician = sess.TechnicianName
		}
		list = append(list, st)
	}
	respond(w, 200, list)
}

func (s *Server) machineHTTP(w http.ResponseWriter, r *http.Request) {
	uid := strings.TrimSpace(r.PathValue("uid"))
	if uid == "" {
		reject(w, 400)
		return
	}
	u, err := s.auth(r.Context(), bearer(r))
	if err != nil {
		reject(w, 401)
		return
	}
	if u.Level < 2 {
		reject(w, 403)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	agent := s.agentsByMachine[uid]
	if r.Method == "GET" {
		v := s.machineSessions[uid]
		var status *AgentStatus
		if agent != nil {
			st := AgentStatus{
				MachineUID: uid,
				Hostname:   agent.hostname,
				Online:     true,
				Monitors:   agent.monitors,
				InSession:  agent.sessionID != "",
			}
			status = &st
		}
		respond(w, 200, map[string]any{"session": v, "agent": status})
		return
	}

	if agent == nil {
		rejectMsg(w, 404, "O agente de acesso remoto desta estação não está conectado.")
		return
	}
	if existing := s.machineSessions[uid]; existing != nil {
		if existing.TechnicianID == u.ID {
			respond(w, 200, map[string]any{"session": existing})
			return
		}
		rejectMsg(w, 409, "Esta estação já possui uma solicitação ou sessão remota ativa.")
		return
	}

	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		reject(w, 500)
		return
	}
	v := &Session{
		ID:             hex.EncodeToString(b),
		TicketID:       0,
		MachineUID:     uid,
		Hostname:       agent.hostname,
		OwnerID:        0,
		TechnicianID:   u.ID,
		TechnicianName: u.Name,
		Sharing:        false,
		Control:        false,
		AgentStreaming: false,
		Monitors:       agent.monitors,
		ActiveMonitor:  0,
		Expires:        time.Now().Add(2 * time.Minute),
		agent:          agent,
		agentPending:   true,
	}
	if s.repo != nil && !s.record(v, u.ID, "requested") {
		reject(w, 503)
		return
	}
	agent.sessionID = v.ID
	// Solicita permissão ao usuário na máquina alvo (via diálogo nativo do Agente Rust e/ou banner no frontend)
	if err := agent.send(Message{Type: "prompt_consent", SessionID: v.ID, TechnicianName: u.Name}); err != nil {
		agent.sessionID = ""
		rejectMsg(w, 503, "Agente desconectado")
		return
	}
	s.machineSessions[uid] = v
	respond(w, 201, map[string]any{"session": v})
}

// Permite ao usuário na estação autorizar ou recusar uma solicitação de acesso remoto pelo banner do frontend.
func (s *Server) machineAuthorizeHTTP(w http.ResponseWriter, r *http.Request) {
	uid := strings.TrimSpace(r.PathValue("uid"))
	u, err := s.auth(r.Context(), bearer(r))
	if err != nil {
		reject(w, 401)
		return
	}
	var req struct {
		Allow bool `json:"allow"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)

	s.mu.Lock()
	defer s.mu.Unlock()
	v := s.machineSessions[uid]
	if v == nil {
		rejectMsg(w, 404, "Sessão não encontrada")
		return
	}
	if !req.Allow {
		if v.technician != nil {
			v.technician.send(Message{Type: "error", Error: "O usuário recusou a solicitação de acesso remoto."})
		}
		s.end(v, u.ID)
		respond(w, 200, map[string]any{"ok": true})
		return
	}
	v.Sharing = true
	v.AgentStreaming = true
	v.Expires = time.Now().Add(time.Hour)
	_ = s.record(v, u.ID, "screen_allowed")
	_ = s.record(v, u.ID, "control_allowed")
	if v.agent != nil {
		_ = v.agent.send(Message{Type: "grant", SessionID: v.ID, TechnicianName: v.TechnicianName})
	}
	s.broadcast(v)
	respond(w, 200, map[string]any{"session": v})
}

func (s *Server) findAvailableAgentLocked(preferredUID string) *peer {
	if preferredUID != "" {
		if a := s.agentsByMachine[preferredUID]; a != nil && a.sessionID == "" {
			return a
		}
	}
	for _, a := range s.agentsByMachine {
		if a.sessionID == "" {
			return a
		}
	}
	return nil
}

func (s *Server) attachAgentLocked(v *Session, a *peer) error {
	if a == nil {
		return errors.New("Agente indisponível")
	}
	v.agent = a
	v.agentPending = true
	v.MachineUID = a.machineUID
	v.Hostname = a.hostname
	v.Monitors = a.monitors
	a.sessionID = v.ID
	if err := a.send(Message{Type: "grant", SessionID: v.ID, TechnicianName: v.TechnicianName}); err != nil {
		s.revoke(v)
		return errors.New("Agente desconectado")
	}
	return nil
}

func (s *Server) ticketHTTP(w http.ResponseWriter, r *http.Request) {
	u, ticket, id, status := s.identify(r, bearer(r))
	if status != 0 {
		reject(w, status)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if r.Method == "GET" {
		v := s.sessions[id]
		if v != nil && u.ID != v.OwnerID && u.ID != v.TechnicianID {
			reject(w, 403)
			return
		}
		respond(w, 200, map[string]any{"session": v})
		return
	}
	if u.Level < 2 || u.ID == ticket.OwnerID {
		reject(w, 403)
		return
	}
	if ticket.Closed {
		reject(w, 409)
		return
	}
	if s.sessions[id] != nil || len(s.sessions) >= 64 {
		reject(w, 409)
		return
	}

	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		reject(w, 500)
		return
	}
	v := &Session{
		ID:             hex.EncodeToString(b),
		TicketID:       id,
		OwnerID:        ticket.OwnerID,
		TechnicianID:   u.ID,
		TechnicianName: u.Name,
		Expires:        time.Now().Add(2 * time.Minute),
	}
	if !s.record(v, u.ID, "requested") {
		reject(w, 503)
		return
	}

	s.sessions[id] = v
	respond(w, 201, map[string]any{"session": v})
}

func (s *Server) historyHTTP(w http.ResponseWriter, r *http.Request) {
	_, _, id, status := s.identify(r, bearer(r))
	if status != 0 {
		reject(w, status)
		return
	}
	events, err := s.repo.History(r.Context(), id)
	if err != nil {
		reject(w, 503)
		return
	}
	respond(w, 200, events)
}

func (s *Server) record(v *Session, user int, action string) bool {
	if s.repo == nil {
		return true
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	err := s.repo.Record(ctx, Event{SessionID: v.ID, TicketID: v.TicketID, UserID: user, Action: action, At: time.Now().UTC()})
	if err != nil {
		log.Printf("[Remoto] falha na auditoria da sessão %s (%s): %v", v.ID, action, err)
	}
	return err == nil
}

func (s *Server) allowed(r *http.Request) bool {
	return isOriginAllowed(s.origin, r.Header.Get("Origin"))
}

func (s *Server) upgrade(w http.ResponseWriter, r *http.Request) (*peer, error) {
	up := websocket.Upgrader{
		CheckOrigin:     s.allowed,
		ReadBufferSize:  65536,
		WriteBufferSize: 65536,
	}
	c, err := up.Upgrade(w, r, nil)
	if err != nil {
		return nil, err
	}
	if tcpConn, ok := c.UnderlyingConn().(*net.TCPConn); ok {
		_ = tcpConn.SetNoDelay(true)
	}
	c.SetReadLimit(4 * 1024 * 1024)
	c.SetReadDeadline(time.Now().Add(10 * time.Second))
	return &peer{conn: c}, nil
}

func (s *Server) machineWS(w http.ResponseWriter, r *http.Request) {
	uid := strings.TrimSpace(r.PathValue("uid"))
	p, err := s.upgrade(w, r)
	if err != nil {
		return
	}
	defer p.close()
	var first Message
	if p.conn.ReadJSON(&first) != nil || first.Type != "auth" {
		return
	}
	u, err := s.auth(r.Context(), first.Token)
	if err != nil || u.Level < 2 {
		p.send(Message{Type: "error", Error: "Acesso não autorizado"})
		return
	}
	p.user = u
	s.mu.Lock()
	v := s.machineSessions[uid]
	if v == nil || u.ID != v.TechnicianID {
		s.mu.Unlock()
		p.send(Message{Type: "error", Error: "Sessão indisponível para este técnico"})
		return
	}
	if v.technician != nil {
		s.mu.Unlock()
		p.send(Message{Type: "error", Error: "Este técnico já está conectado"})
		return
	}
	v.technician = p
	v.TechnicianConnected = true
	p.sessionID = v.ID
	s.broadcast(v)
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		if current := s.machineSessions[uid]; current == v {
			s.end(v, u.ID)
		}
	}()

	s.read(p, func(m Message) {
		if m.Type == "input" {
			s.mu.Lock()
			active := s.machineSessions[uid] == v && v.Sharing && v.Control
			agent := v.agent
			s.mu.Unlock()
			if !active || agent == nil || m.Input == nil || !m.Input.Valid() {
				p.send(Message{Type: "error", Error: "Ação não permitida no estado atual"})
				return
			}
			if err := agent.send(Message{Type: "input", SessionID: v.ID, Input: m.Input}); err != nil {
				s.mu.Lock()
				s.revoke(v)
				s.broadcast(v)
				s.mu.Unlock()
			}
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.machineSessions[uid] != v {
			return
		}
		if err := s.apply(v, p, m); err != nil {
			p.send(Message{Type: "error", Error: err.Error()})
		}
	}, nil)
}

func (s *Server) ticketWS(w http.ResponseWriter, r *http.Request) {
	p, err := s.upgrade(w, r)
	if err != nil {
		return
	}
	defer p.close()
	var first Message
	if p.conn.ReadJSON(&first) != nil || first.Type != "auth" {
		return
	}
	u, _, id, status := s.identify(r, first.Token)
	if status != 0 {
		p.send(Message{Type: "error", Error: "Acesso não autorizado"})
		return
	}
	p.user = u
	s.mu.Lock()
	v := s.sessions[id]
	if v == nil || (u.ID != v.OwnerID && u.ID != v.TechnicianID) {
		s.mu.Unlock()
		p.send(Message{Type: "error", Error: "Sessão indisponível para este usuário"})
		return
	}
	if (u.ID == v.OwnerID && v.owner != nil) || (u.ID == v.TechnicianID && v.technician != nil) {
		s.mu.Unlock()
		p.send(Message{Type: "error", Error: "Este participante já está conectado"})
		return
	}
	if u.ID == v.OwnerID {
		v.owner = p
		v.OwnerConnected = true
	} else {
		v.technician = p
		v.TechnicianConnected = true
	}
	p.sessionID = v.ID
	s.broadcast(v)
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		if current := s.sessions[id]; current == v {
			s.end(v, u.ID)
		}
	}()
	s.read(p, func(m Message) {
		if m.Type == "input" {
			s.mu.Lock()
			tech := p == v.technician
			active := s.sessions[id] == v && tech && v.Sharing && v.Control
			agent := v.agent
			s.mu.Unlock()
			if !active || agent == nil || m.Input == nil || !m.Input.Valid() {
				p.send(Message{Type: "error", Error: "Ação não permitida no estado atual"})
				return
			}
			if err := agent.send(Message{Type: "input", SessionID: v.ID, Input: m.Input}); err != nil {
				s.mu.Lock()
				s.revoke(v)
				s.broadcast(v)
				s.mu.Unlock()
			}
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.sessions[id] != v {
			return
		}
		if err := s.apply(v, p, m); err != nil {
			p.send(Message{Type: "error", Error: err.Error()})
		}
	}, nil)
}

func (s *Server) read(p *peer, handle func(Message), handleBinary func([]byte)) {
	deadline := func() time.Time {
		d := time.Now().Add(45 * time.Second)
		if !p.user.Expires.IsZero() && p.user.Expires.Before(d) {
			return p.user.Expires
		}
		return d
	}
	p.conn.SetReadDeadline(deadline())
	p.conn.SetPongHandler(func(string) error { return p.conn.SetReadDeadline(deadline()) })
	done := make(chan struct{})
	defer close(done)
	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				p.mu.Lock()
				err := p.conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(3*time.Second))
				p.mu.Unlock()
				if err != nil {
					p.close()
					return
				}
			}
		}
	}()
	for {
		msgType, raw, err := p.conn.ReadMessage()
		if err != nil {
			return
		}
		_ = p.conn.SetReadDeadline(deadline())
		if msgType == websocket.BinaryMessage {
			if handleBinary != nil {
				handleBinary(raw)
			}
			continue
		}
		var m Message
		if json.Unmarshal(raw, &m) != nil {
			return
		}
		handle(m)
	}
}

func (s *Server) broadcast(v *Session) {
	for _, p := range []*peer{v.owner, v.technician} {
		if p != nil {
			p.send(Message{Type: "state", Session: v})
		}
	}
}

func (s *Server) revoke(v *Session) {
	if v.agent != nil {
		v.agent.send(Message{Type: "revoke", SessionID: v.ID})
		v.agent.sessionID = ""
		if v.agent.machineUID == "" {
			v.agent.close()
		}
	}
	v.agent = nil
	v.agentPending = false
	v.Control = false
	v.ControlRequested = false
	v.AgentStreaming = false
}

func (s *Server) end(v *Session, uid int) {
	s.revoke(v)
	s.record(v, uid, "ended")
	if v.TicketID > 0 {
		delete(s.sessions, v.TicketID)
	}
	if v.MachineUID != "" && s.machineSessions[v.MachineUID] == v {
		delete(s.machineSessions, v.MachineUID)
	}
	for _, p := range []*peer{v.owner, v.technician} {
		if p != nil {
			p.send(Message{Type: "ended", SessionID: v.ID})
			p.close()
		}
	}
}

func (s *Server) apply(v *Session, p *peer, m Message) error {
	owner := p == v.owner
	tech := p == v.technician
	denied := errors.New("Ação não permitida no estado atual")
	switch m.Type {
	case "share":
		if !owner || v.Sharing || v.technician == nil {
			return denied
		}
		if !s.record(v, p.user.ID, "screen_allowed") {
			s.end(v, p.user.ID)
			return errors.New("Falha na auditoria")
		}
		v.Sharing = true
		v.Expires = time.Now().Add(time.Hour)
		// Unifica permissão de tela + teclado/mouse automaticamente quando há um agente da estação conectado
		if v.agent == nil {
			if a := s.findAvailableAgentLocked(m.MachineUID); a != nil {
				_ = s.record(v, p.user.ID, "control_allowed")
				_ = s.attachAgentLocked(v, a)
				v.AgentStreaming = true
			}
		}
	case "select_monitor":
		if !tech || v.agent == nil {
			return denied
		}
		v.ActiveMonitor = m.MonitorID
		if err := v.agent.send(Message{Type: "select_monitor", SessionID: v.ID, MonitorID: m.MonitorID}); err != nil {
			return errors.New("Falha ao alternar monitor no agente")
		}
	case "offer", "answer", "ice":
		if !v.Sharing {
			return denied
		}
		target := v.technician
		if m.Type == "offer" && !owner || m.Type == "answer" && !tech {
			return denied
		}
		if tech {
			target = v.owner
		}
		if target == nil {
			return denied
		}
		if m.Type == "ice" {
			if len(m.Candidate) == 0 || len(m.Candidate) > 8192 {
				return denied
			}
		} else if len(m.SDP) == 0 {
			return denied
		}
		return target.send(Message{Type: m.Type, SDP: m.SDP, Candidate: m.Candidate})
	case "request_control":
		if !tech || !v.Sharing || v.Control || v.ControlRequested {
			return denied
		}
		if !s.record(v, p.user.ID, "control_requested") {
			s.end(v, p.user.ID)
			return denied
		}
		if a := s.findAvailableAgentLocked(v.MachineUID); a != nil {
			_ = s.record(v, p.user.ID, "control_allowed")
			if err := s.attachAgentLocked(v, a); err == nil {
				v.AgentStreaming = true
				s.broadcast(v)
				return nil
			}
		}
		v.ControlRequested = true
	case "allow_control":
		if !owner || !v.Sharing || !v.ControlRequested || v.agent != nil {
			return denied
		}
		var a *peer
		if m.PairCode != "" {
			a = s.agents[m.PairCode]
			if a == nil || a.sessionID != "" || time.Now().After(a.pairExpires) {
				return errors.New("Código do agente inválido ou já em uso")
			}
			delete(s.agents, m.PairCode)
		} else {
			a = s.findAvailableAgentLocked(v.MachineUID)
			if a == nil {
				return errors.New("Agente não encontrado")
			}
		}
		if !s.record(v, p.user.ID, "control_allowed") {
			s.end(v, p.user.ID)
			return denied
		}
		if err := s.attachAgentLocked(v, a); err != nil {
			return err
		}
	case "revoke_control":
		if !owner && !tech {
			return denied
		}
		s.revoke(v)
		if !s.record(v, p.user.ID, "control_revoked") {
			s.end(v, p.user.ID)
			return denied
		}
	case "input":
		if !tech || !v.Sharing || !v.Control || v.agent == nil || m.Input == nil || !m.Input.Valid() {
			return denied
		}
		if err := v.agent.send(Message{Type: "input", SessionID: v.ID, Input: m.Input}); err != nil {
			s.revoke(v)
			s.broadcast(v)
			return err
		}
		return nil
	case "end":
		s.end(v, p.user.ID)
		return nil
	default:
		return denied
	}
	s.broadcast(v)
	return nil
}

func (s *Server) agentWS(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Origin") != "" {
		reject(w, 403)
		return
	}
	p, err := s.upgrade(w, r)
	if err != nil {
		return
	}
	defer p.close()
	var first Message
	if p.conn.ReadJSON(&first) != nil || first.Type != "register" || len(first.PairCode) != 32 {
		return
	}
	if _, err := hex.DecodeString(first.PairCode); err != nil {
		return
	}
	p.code = first.PairCode
	p.machineUID = strings.TrimSpace(first.MachineUID)
	p.hostname = strings.TrimSpace(first.Hostname)
	p.monitors = first.Monitors
	if p.machineUID != "" {
		p.pairExpires = time.Now().Add(365 * 24 * time.Hour)
	} else {
		p.pairExpires = time.Now().Add(2 * time.Minute)
	}

	s.mu.Lock()
	if len(s.agents) >= 128 || s.agents[p.code] != nil {
		s.mu.Unlock()
		return
	}
	s.agents[p.code] = p
	if p.machineUID != "" {
		if old := s.agentsByMachine[p.machineUID]; old != nil && old != p {
			old.close()
		}
		s.agentsByMachine[p.machineUID] = p
	}
	s.mu.Unlock()

	p.send(Message{Type: "registered"})
	defer func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.agents[p.code] == p {
			delete(s.agents, p.code)
		}
		if p.machineUID != "" && s.agentsByMachine[p.machineUID] == p {
			delete(s.agentsByMachine, p.machineUID)
		}
		for _, v := range s.sessions {
			if v.agent == p {
				s.revoke(v)
				if !s.record(v, 0, "agent_disconnected") {
					s.end(v, 0)
				} else {
					s.broadcast(v)
				}
			}
		}
		for _, v := range s.machineSessions {
			if v.agent == p {
				s.revoke(v)
				s.end(v, 0)
			}
		}
	}()

	s.read(p, func(m Message) {
		if m.Type == "frame" {
			s.mu.Lock()
			var tech, owner *peer
			for _, v := range s.sessions {
				if v.agent == p && v.ID == m.SessionID {
					tech = v.technician
					owner = v.owner
					break
				}
			}
			if tech == nil {
				for _, v := range s.machineSessions {
					if v.agent == p && v.ID == m.SessionID {
						tech = v.technician
						break
					}
				}
			}
			s.mu.Unlock()
			frameMsg := Message{
				Type:      "frame",
				SessionID: m.SessionID,
				MonitorID: m.MonitorID,
				Width:     m.Width,
				Height:    m.Height,
				Frame:     m.Frame,
			}
			if tech != nil {
				_ = tech.send(frameMsg)
			}
			if owner != nil {
				_ = owner.send(frameMsg)
			}
			return
		}

		s.mu.Lock()
		defer s.mu.Unlock()
		allSessions := make([]*Session, 0, len(s.sessions)+len(s.machineSessions))
		for _, v := range s.sessions {
			allSessions = append(allSessions, v)
		}
		for _, v := range s.machineSessions {
			allSessions = append(allSessions, v)
		}
		for _, v := range allSessions {
			if v.agent == p && v.ID == m.SessionID {
				switch m.Type {
				case "ready":
					if v.agentPending {
						v.Sharing = true
						v.Control = true
						v.AgentStreaming = true
						v.agentPending = false
						v.Expires = time.Now().Add(time.Hour)
						if len(m.Monitors) > 0 {
							v.Monitors = m.Monitors
							p.monitors = m.Monitors
						}
						v.ActiveMonitor = m.ActiveMonitor
						_ = s.record(v, 0, "screen_allowed")
						_ = s.record(v, 0, "control_allowed")
						s.broadcast(v)
					}
				case "consent_denied":
					if v.technician != nil {
						v.technician.send(Message{Type: "error", Error: m.Error})
					}
					s.end(v, 0)
				case "monitor_selected":
					v.ActiveMonitor = m.ActiveMonitor
					if len(m.Monitors) > 0 {
						v.Monitors = m.Monitors
						p.monitors = m.Monitors
					}
					s.broadcast(v)
				case "error":
					s.revoke(v)
					s.broadcast(v)
					if v.owner != nil {
						v.owner.send(Message{Type: "error", Error: "Agente não pôde controlar o sistema: " + m.Error})
					}
					if v.technician != nil {
						v.technician.send(Message{Type: "error", Error: "Agente não pôde controlar o sistema: " + m.Error})
					}
				}
				return
			}
		}
	}, func(raw []byte) {
		if len(raw) < 6 {
			return
		}
		s.mu.Lock()
		var tech, owner *peer
		for _, v := range s.sessions {
			if v.agent == p {
				tech = v.technician
				owner = v.owner
				break
			}
		}
		if tech == nil {
			for _, v := range s.machineSessions {
				if v.agent == p {
					tech = v.technician
					break
				}
			}
		}
		s.mu.Unlock()
		if tech != nil {
			_ = tech.sendBinary(raw)
		}
		if owner != nil {
			_ = owner.sendBinary(raw)
		}
	})
}

func (s *Server) watch() {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-s.stop:
			return
		case now := <-ticker.C:
			s.mu.Lock()
			for code, a := range s.agents {
				if now.After(a.pairExpires) {
					delete(s.agents, code)
					if a.machineUID != "" && s.agentsByMachine[a.machineUID] == a {
						delete(s.agentsByMachine, a.machineUID)
					}
					a.close()
				}
			}
			for _, v := range s.sessions {
				if now.After(v.Expires) {
					s.end(v, 0)
				}
			}
			for _, v := range s.machineSessions {
				if now.After(v.Expires) {
					s.end(v, 0)
				}
			}
			s.mu.Unlock()
		}
	}
}
