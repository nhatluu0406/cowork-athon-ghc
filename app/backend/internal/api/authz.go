package api

import (
	"net/http"
	"strings"

	"github.com/rad-system/m365-knowledge-graph/internal/auth"
)

// requireUserID extracts and verifies the caller's identity from the
// "Authorization: Bearer <JWT>" header — the only trustworthy source of
// caller identity, since any other header (e.g. X-User-ID) is client-
// controlled and trivially spoofable. On success it returns the verified
// user ID; on failure it writes a 401 response itself and returns ok=false,
// in which case the caller must return immediately without doing further
// work.
func requireUserID(w http.ResponseWriter, r *http.Request, jwtAuth *auth.JWTAuth) (userID string, ok bool) {
	claims, ok := verifyBearerToken(w, r, jwtAuth)
	if !ok {
		return "", false
	}
	return claims.UserID, true
}

// requireAdmin verifies the caller's JWT and checks that the resulting user
// ID or email is present in adminIDs. Returns 401 for a missing/invalid
// token and 403 for a valid but non-admin caller.
func requireAdmin(w http.ResponseWriter, r *http.Request, jwtAuth *auth.JWTAuth, adminIDs []string) (userID string, ok bool) {
	claims, ok := verifyBearerToken(w, r, jwtAuth)
	if !ok {
		return "", false
	}
	if !isAdminUser(claims.UserID, claims.Email, adminIDs) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return "", false
	}
	return claims.UserID, true
}

func verifyBearerToken(w http.ResponseWriter, r *http.Request, jwtAuth *auth.JWTAuth) (*auth.Claims, bool) {
	if jwtAuth == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return nil, false
	}
	token := bearerToken(r)
	if token == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return nil, false
	}
	claims, err := jwtAuth.VerifyToken(token)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return nil, false
	}
	return claims, true
}

func bearerToken(r *http.Request) string {
	const prefix = "Bearer "
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, prefix) {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(header, prefix))
}

func isAdminUser(userID, email string, adminIDs []string) bool {
	for _, id := range adminIDs {
		if id != "" && (id == userID || id == email) {
			return true
		}
	}
	return false
}
