package remote

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

// Delegate JWT validation and current role/active status to the existing API.
func APIAuth(baseURL string) Authenticator {
	client := &http.Client{Timeout: 5 * time.Second}
	return func(ctx context.Context, token string) (User, error) {
		var u User
		if len(token) > 8192 || len(strings.Split(token, ".")) != 3 {
			return u, errors.New("invalid JWT")
		}
		req, err := http.NewRequestWithContext(ctx, "GET", strings.TrimRight(baseURL, "/")+"/api/auth/me", nil)
		if err != nil {
			return u, err
		}
		req.Header.Set("Authorization", "Bearer "+token)
		res, err := client.Do(req)
		if err != nil {
			return u, err
		}
		defer res.Body.Close()
		if res.StatusCode != 200 {
			return u, errors.New("authentication failed")
		}
		if err = json.NewDecoder(http.MaxBytesReader(nil, res.Body, 16384)).Decode(&u); err != nil {
			return u, err
		}
		// The API verified the signature. Read exp only to cap this WebSocket's lifetime.
		payload, err := base64.RawURLEncoding.DecodeString(strings.Split(token, ".")[1])
		if err != nil {
			return u, err
		}
		var claims struct {
			Exp int64 `json:"exp"`
		}
		if err = json.Unmarshal(payload, &claims); err != nil {
			return u, err
		}
		u.Expires = time.Unix(claims.Exp, 0)
		if !u.Active || u.ID <= 0 || !u.Expires.After(time.Now()) {
			return u, errors.New("inactive or expired account")
		}
		return u, nil
	}
}
