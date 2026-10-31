package remote

import (
	"context"
	"encoding/json"
	"math"
	"strings"
	"time"
	"unicode/utf8"
)

type User struct {
	ID      int       `json:"id"`
	Name    string    `json:"nome"`
	Level   int       `json:"nivelAcesso"`
	Active  bool      `json:"ativo"`
	Expires time.Time `json:"-"`
}
type Ticket struct {
	OwnerID int
	Closed  bool
}
type Event struct {
	SessionID string    `json:"sessionId"`
	TicketID  int       `json:"ticketId"`
	UserID    int       `json:"userId"`
	Action    string    `json:"action"`
	At        time.Time `json:"at"`
}
type Repository interface {
	Ticket(context.Context, int) (Ticket, error)
	Record(context.Context, Event) error
	History(context.Context, int) ([]Event, error)
}
type Authenticator func(context.Context, string) (User, error)
type Session struct {
	ID                  string    `json:"id"`
	TicketID            int       `json:"ticketId"`
	OwnerID             int       `json:"ownerId"`
	TechnicianID        int       `json:"technicianId"`
	TechnicianName      string    `json:"technicianName"`
	TechnicianConnected bool      `json:"technicianConnected"`
	OwnerConnected      bool      `json:"ownerConnected"`
	Sharing             bool      `json:"sharing"`
	ControlRequested    bool      `json:"controlRequested"`
	Control             bool      `json:"control"`
	Expires             time.Time `json:"expires"`
	owner, technician   *peer
	agent               *peer
	agentPending        bool
}
type Input struct {
	Kind   string  `json:"kind"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Button int     `json:"button"`
	Down   bool    `json:"down"`
	Key    string  `json:"key"`
	Delta  int     `json:"delta"`
}

func (i Input) Valid() bool {
	switch i.Kind {
	case "move":
		return !math.IsNaN(i.X) && !math.IsNaN(i.Y) && !math.IsInf(i.X, 0) && !math.IsInf(i.Y, 0) && i.X >= 0 && i.X <= 1 && i.Y >= 0 && i.Y <= 1
	case "button":
		return i.Button >= 0 && i.Button <= 2
	case "scroll":
		return i.Delta >= -10 && i.Delta <= 10
	case "key":
		if utf8.RuneCountInString(i.Key) == 1 {
			r, _ := utf8.DecodeRuneInString(i.Key)
			return r >= 32 && r != 127
		}
		return strings.Contains("|Enter|Tab|Escape|Backspace|Delete|Insert|Home|End|PageUp|PageDown|ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Shift|Control|Alt|Meta|CapsLock|F1|F2|F3|F4|F5|F6|F7|F8|F9|F10|F11|F12|", "|"+i.Key+"|") && i.Key != ""
	}
	return false
}

type Message struct {
	Type      string          `json:"type"`
	Token     string          `json:"token,omitempty"`
	PairCode  string          `json:"pairCode,omitempty"`
	SessionID string          `json:"sessionId,omitempty"`
	Session   *Session        `json:"session,omitempty"`
	Input     *Input          `json:"input,omitempty"`
	SDP       json.RawMessage `json:"sdp,omitempty"`
	Candidate json.RawMessage `json:"candidate,omitempty"`
	Error     string          `json:"error,omitempty"`
}
