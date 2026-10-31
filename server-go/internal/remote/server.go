package remote

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"net/http"
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
	pairExpires time.Time
}

func (p *peer) send(m Message) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.conn.SetWriteDeadline(time.Now().Add(3 * time.Second))
	return p.conn.WriteJSON(m)
}
func (p *peer) close() { p.conn.Close() }

type Server struct {
	mu       sync.Mutex
	auth     Authenticator
	repo     Repository
	origin   string
	ice      any
	sessions map[int]*Session
	agents   map[string]*peer
	stop     chan struct{}
	once     sync.Once
}

func New(auth Authenticator, repo Repository, origin string, ice any) *Server {
	s := &Server{auth: auth, repo: repo, origin: origin, ice: ice, sessions: map[int]*Session{}, agents: map[string]*peer{}, stop: make(chan struct{})}
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
		for _, a := range s.agents {
			a.close()
		}
	})
}
func (s *Server) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/remoto/config", s.configuration)
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
	if ice == nil {
		ice = []any{}
	}
	respond(w, 200, map[string]any{"iceServers": ice})
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
	v := &Session{ID: hex.EncodeToString(b), TicketID: id, OwnerID: ticket.OwnerID, TechnicianID: u.ID, TechnicianName: u.Name, Expires: time.Now().Add(2 * time.Minute)}
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
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	err := s.repo.Record(ctx, Event{SessionID: v.ID, TicketID: v.TicketID, UserID: user, Action: action, At: time.Now().UTC()})
	if err != nil {
		log.Printf("[Remoto] falha na auditoria da sessão %s (%s): %v", v.ID, action, err)
	}
	return err == nil
}
func (s *Server) allowed(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	for _, o := range strings.Split(s.origin, ",") {
		if strings.TrimSpace(o) == origin {
			return true
		}
	}
	return false
}
func (s *Server) upgrade(w http.ResponseWriter, r *http.Request) (*peer, error) {
	up := websocket.Upgrader{CheckOrigin: s.allowed}
	c, err := up.Upgrade(w, r, nil)
	if err != nil {
		return nil, err
	}
	c.SetReadLimit(65536)
	c.SetReadDeadline(time.Now().Add(5 * time.Second))
	return &peer{conn: c}, nil
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
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.sessions[id] != v {
			return
		}
		if err := s.apply(v, p, m); err != nil {
			p.send(Message{Type: "error", Error: err.Error()})
		}
	})
}
func (s *Server) read(p *peer, handle func(Message)) {
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
		var m Message
		if p.conn.ReadJSON(&m) != nil {
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
		v.agent.close()
	}
	v.agent = nil
	v.agentPending = false
	v.Control = false
	v.ControlRequested = false
}
func (s *Server) end(v *Session, uid int) {
	s.revoke(v)
	s.record(v, uid, "ended")
	delete(s.sessions, v.TicketID)
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
		v.ControlRequested = true
	case "allow_control":
		if !owner || !v.Sharing || !v.ControlRequested || v.agent != nil {
			return denied
		}
		a := s.agents[m.PairCode]
		if a == nil || a.sessionID != "" || time.Now().After(a.pairExpires) {
			return errors.New("Código do agente inválido ou já em uso")
		}
		if !s.record(v, p.user.ID, "control_allowed") {
			s.end(v, p.user.ID)
			return denied
		}
		delete(s.agents, m.PairCode) // Código consumido; reconexão gera outro.
		v.agent = a
		v.agentPending = true
		a.sessionID = v.ID
		if err := a.send(Message{Type: "grant", SessionID: v.ID}); err != nil {
			s.revoke(v)
			return errors.New("Agente desconectado")
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
	// Native agent only. Browser JavaScript must use the ticket consent flow.
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
	p.pairExpires = time.Now().Add(2 * time.Minute)
	s.mu.Lock()
	if len(s.agents) >= 128 || s.agents[p.code] != nil {
		s.mu.Unlock()
		return
	}
	s.agents[p.code] = p
	s.mu.Unlock()
	p.send(Message{Type: "registered"})
	defer func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.agents[p.code] == p {
			delete(s.agents, p.code)
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
	}()
	s.read(p, func(m Message) {
		s.mu.Lock()
		defer s.mu.Unlock()
		for _, v := range s.sessions {
			if v.agent == p && v.ID == m.SessionID {
				if m.Type == "ready" && v.agentPending {
					v.Control = true
					v.agentPending = false
					s.broadcast(v)
				} else if m.Type == "error" {
					s.revoke(v)
					s.broadcast(v)
					if v.owner != nil {
						v.owner.send(Message{Type: "error", Error: "Agente não pôde controlar o sistema: " + m.Error})
					}
				}
				return
			}
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
					a.close()
				}
			}
			for _, v := range s.sessions {
				if now.After(v.Expires) {
					s.end(v, 0)
				}
			}
			s.mu.Unlock()
		}
	}
}
