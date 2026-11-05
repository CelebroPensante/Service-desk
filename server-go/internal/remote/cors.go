package remote

import (
	"net/http"
	"strings"
)

func isOriginAllowed(origins, origin string) bool {
	if origin == "" {
		return true
	}
	for _, o := range strings.Split(origins, ",") {
		trimmed := strings.TrimSpace(o)
		if trimmed == "*" || trimmed == origin {
			return true
		}
	}
	return false
}

func CORS(origins string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/remoto/") {
			origin := r.Header.Get("Origin")
			if origin != "" {
				if !isOriginAllowed(origins, origin) {
					reject(w, 403)
					return
				}
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Add("Vary", "Origin")
			}
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			if r.Method == "OPTIONS" {
				w.WriteHeader(204)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
