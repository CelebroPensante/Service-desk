package remote

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

type memoryRepo struct {
	mu     sync.Mutex
	events []Event
	fail   bool
}

func (m *memoryRepo) Ticket(context.Context, int) (Ticket, error) { return Ticket{OwnerID: 1}, nil }
func (m *memoryRepo) Record(_ context.Context, e Event) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.fail {
		return errors.New("database unavailable")
	}
	m.events = append(m.events, e)
	return nil
}
func (m *memoryRepo) History(context.Context, int) ([]Event, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]Event{}, m.events...), nil
}
func setup(t *testing.T) (*Server, *httptest.Server, *memoryRepo) {
	t.Helper()
	repo := &memoryRepo{}
	auth := func(_ context.Context, token string) (User, error) {
		switch token {
		case "owner":
			return User{ID: 1, Level: 1, Name: "Solicitante", Expires: time.Now().Add(time.Hour)}, nil
		case "tech":
			return User{ID: 2, Level: 2, Name: "Técnico", Expires: time.Now().Add(time.Hour)}, nil
		case "other":
			return User{ID: 3, Level: 1, Expires: time.Now().Add(time.Hour)}, nil
		case "tech2":
			return User{ID: 4, Level: 2, Expires: time.Now().Add(time.Hour)}, nil
		}
		return User{}, errors.New("invalid token")
	}
	s := New(auth, repo, "http://localhost:5173", nil)
	mux := http.NewServeMux()
	s.Register(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	t.Cleanup(s.Close)
	return s, srv, repo
}
func request(t *testing.T, srv *httptest.Server, method, token string) int {
	t.Helper()
	req, _ := http.NewRequest(method, srv.URL+"/api/remoto/chamados/10", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	return res.StatusCode
}
func connect(t *testing.T, srv *httptest.Server, token string) *websocket.Conn {
	t.Helper()
	h := http.Header{}
	h.Set("Origin", "http://localhost:5173")
	c, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http")+"/api/remoto/chamados/10/ws", h)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Close() })
	send(t, c, Message{Type: "auth", Token: token})
	return c
}
func send(t *testing.T, c *websocket.Conn, m Message) {
	t.Helper()
	if err := c.WriteJSON(m); err != nil {
		t.Fatal(err)
	}
}
func receive(t *testing.T, c *websocket.Conn, typ string) Message {
	t.Helper()
	c.SetReadDeadline(time.Now().Add(3 * time.Second))
	for {
		var m Message
		if err := c.ReadJSON(&m); err != nil {
			t.Fatal(err)
		}
		if m.Type == typ {
			return m
		}
	}
}
func TestSessionAuthorization(t *testing.T) {
	_, srv, _ := setup(t)
	for _, tc := range []struct {
		token  string
		status int
	}{{"bad", 401}, {"owner", 403}, {"other", 403}, {"tech", 201}, {"tech2", 409}} {
		if got := request(t, srv, "POST", tc.token); got != tc.status {
			t.Fatalf("%s: got %d want %d", tc.token, got, tc.status)
		}
	}
	if got := request(t, srv, "GET", "other"); got != 403 {
		t.Fatal(got)
	}
	c := connect(t, srv, "tech2")
	if m := receive(t, c, "error"); m.Error == "" {
		t.Fatal("competing technician connected")
	}
}
func TestConsentPairingAndRevocation(t *testing.T) {
	_, srv, _ := setup(t)
	if request(t, srv, "POST", "tech") != 201 {
		t.Fatal("create")
	}
	tech := connect(t, srv, "tech")
	receive(t, tech, "state")
	owner := connect(t, srv, "owner")
	receive(t, owner, "state")
	send(t, tech, Message{Type: "input", Input: &Input{Kind: "move", X: .5, Y: .5}})
	receive(t, tech, "error")
	send(t, tech, Message{Type: "share"})
	receive(t, tech, "error")
	send(t, owner, Message{Type: "share"})
	if !receive(t, owner, "state").Session.Sharing {
		t.Fatal("screen consent not saved")
	}
	send(t, tech, Message{Type: "request_control"})
	if !receive(t, owner, "state").Session.ControlRequested {
		t.Fatal("no control request")
	}
	code := strings.Repeat("a", 32)
	agent, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http")+"/api/remoto/agente/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer agent.Close()
	send(t, agent, Message{Type: "register", PairCode: code})
	receive(t, agent, "registered")
	send(t, owner, Message{Type: "allow_control", PairCode: code})
	grant := receive(t, agent, "grant")
	if grant.SessionID == "" {
		t.Fatal("missing session id")
	}
	send(t, agent, Message{Type: "ready", SessionID: grant.SessionID})
	for {
		m := receive(t, owner, "state")
		if m.Session.Control {
			break
		}
	}
	send(t, tech, Message{Type: "input", Input: &Input{Kind: "move", X: .5, Y: .5}})
	if m := receive(t, agent, "input"); m.SessionID != grant.SessionID {
		t.Fatal("wrong session")
	}
	send(t, tech, Message{Type: "input", Input: &Input{Kind: "move", X: 2, Y: .5}})
	receive(t, tech, "error")
	send(t, owner, Message{Type: "revoke_control"})
	receive(t, agent, "revoke")
	send(t, tech, Message{Type: "input", Input: &Input{Kind: "key", Key: "a", Down: true}})
	receive(t, tech, "error")
	send(t, owner, Message{Type: "end"})
	receive(t, tech, "ended")
	if got := request(t, srv, "GET", "owner"); got != 200 {
		t.Fatal(got)
	}
}
func TestDisconnectEndsSession(t *testing.T) {
	_, srv, repo := setup(t)
	request(t, srv, "POST", "tech")
	tech := connect(t, srv, "tech")
	receive(t, tech, "state")
	owner := connect(t, srv, "owner")
	receive(t, owner, "state")
	owner.Close()
	receive(t, tech, "ended")
	repo.mu.Lock()
	defer repo.mu.Unlock()
	if len(repo.events) < 2 || repo.events[len(repo.events)-1].Action != "ended" {
		t.Fatal(repo.events)
	}
}
func TestAuditFailurePreventsSession(t *testing.T) {
	_, srv, repo := setup(t)
	repo.fail = true
	if got := request(t, srv, "POST", "tech"); got != 503 {
		t.Fatal(got)
	}
}
func TestInvalidInput(t *testing.T) {
	for _, i := range []Input{{Kind: "move", X: -1}, {Kind: "button", Button: 7}, {Kind: "key", Key: "exec"}, {Kind: "scroll", Delta: 5000}, {Kind: "shell"}} {
		if i.Valid() {
			t.Fatalf("accepted %+v", i)
		}
	}
	if !(Input{Kind: "key", Key: "ArrowLeft", Down: true}).Valid() {
		t.Fatal("arrow key rejected")
	}
}

func TestBrowserHarness(t *testing.T) {
	if os.Getenv("REMOTE_BROWSER_HARNESS") != "true" {
		t.Skip("opt-in browser integration fixture")
	}
	s, _, _ := setup(t)
	mux := http.NewServeMux()
	s.Register(mux)
	t.Log("Browser integration coordinator: http://127.0.0.1:18081")
	if err := http.ListenAndServe("127.0.0.1:18081", CORS("http://localhost:5173,http://127.0.0.1:5173", mux)); err != nil {
		t.Fatal(err)
	}
}

func TestPairCodeExpiresAndIsConsumed(t *testing.T) {
	s, srv, _ := setup(t)
	request(t, srv, "POST", "tech")
	tech := connect(t, srv, "tech")
	receive(t, tech, "state")
	owner := connect(t, srv, "owner")
	receive(t, owner, "state")
	send(t, owner, Message{Type: "share"})
	receive(t, owner, "state")
	send(t, tech, Message{Type: "request_control"})
	receive(t, owner, "state")
	register := func(code string) *websocket.Conn {
		c, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http")+"/api/remoto/agente/ws", nil)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { c.Close() })
		send(t, c, Message{Type: "register", PairCode: code})
		receive(t, c, "registered")
		return c
	}
	expired := strings.Repeat("b", 32)
	register(expired)
	s.mu.Lock()
	s.agents[expired].pairExpires = time.Now().Add(-time.Second)
	s.mu.Unlock()
	send(t, owner, Message{Type: "allow_control", PairCode: expired})
	receive(t, owner, "error")
	code := strings.Repeat("c", 32)
	agent := register(code)
	send(t, owner, Message{Type: "allow_control", PairCode: code})
	grant := receive(t, agent, "grant")
	send(t, agent, Message{Type: "ready", SessionID: grant.SessionID})
	for {
		if receive(t, owner, "state").Session.Control {
			break
		}
	}
	send(t, owner, Message{Type: "revoke_control"})
	receive(t, agent, "revoke")
	receive(t, owner, "state")
	send(t, tech, Message{Type: "request_control"})
	receive(t, owner, "state")
	send(t, owner, Message{Type: "allow_control", PairCode: code})
	receive(t, owner, "error")
}

func TestInputWireKeepsZeroAndReleaseValues(t *testing.T) {
	for _, input := range []Input{{Kind: "move", X: 0, Y: 0}, {Kind: "button", Button: 0, Down: false}, {Kind: "key", Key: "Shift", Down: false}} {
		raw, err := json.Marshal(input)
		if err != nil {
			t.Fatal(err)
		}
		var fields map[string]any
		json.Unmarshal(raw, &fields)
		for _, key := range []string{"x", "y", "button", "down"} {
			if _, ok := fields[key]; !ok {
				t.Fatalf("missing %s in %s", key, raw)
			}
		}
	}
}

func TestSharingWaitsForTechnicianConnection(t *testing.T) {
	_, srv, _ := setup(t)
	request(t, srv, "POST", "tech")
	owner := connect(t, srv, "owner")
	if receive(t, owner, "state").Session.TechnicianConnected {
		t.Fatal("technician falsely ready")
	}
	send(t, owner, Message{Type: "share"})
	receive(t, owner, "error")
	tech := connect(t, srv, "tech")
	receive(t, tech, "state")
	if !receive(t, owner, "state").Session.TechnicianConnected {
		t.Fatal("technician readiness not published")
	}
	send(t, owner, Message{Type: "share"})
	if !receive(t, owner, "state").Session.Sharing {
		t.Fatal("share rejected after readiness")
	}
}
