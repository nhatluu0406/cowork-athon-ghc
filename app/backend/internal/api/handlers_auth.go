package api

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/rad-system/m365-knowledge-graph/internal/auth"
)

type LoginRequest struct {
	Mode     string `json:"mode"` // "entra" (OIDC auth-code flow) or "" / "jwt" (username+password fallback)
	Code     string `json:"code,omitempty"`
	Username string `json:"username,omitempty"`
	Password string `json:"password,omitempty"`
}

type LoginResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
}

const (
	accessTokenTTLSeconds  = 3600      // 1 hour
	refreshTokenTTLSeconds = 7 * 86400 // 7 days
)

// HandleLogin wires POST /api/auth/login to the real auth backends
// (tasks.md T184):
//   - Mode "entra"/"entra_id" (or any request carrying a `code`): exchanges
//     the OIDC authorization code via internal/auth.EntraIDAuth, fetches the
//     user's MS Graph profile, and issues our own JWT via
//     GenerateTokenWithClaims — the Entra ID token itself is never handed to
//     the client.
//   - Otherwise: username/password fallback. There is no user store in this
//     service yet (per spec.md, identity is delegated to Entra ID), so this
//     path only succeeds when devUsername/devPassword are explicitly
//     configured (DEV_LOGIN_USERNAME/DEV_LOGIN_PASSWORD env vars) — intended
//     for local development and the smoke test, never for production
//     (those env vars are expected to be unset there, in which case this
//     path always returns 401).
func HandleLogin(entraAuth *auth.EntraIDAuth, jwtAuth *auth.JWTAuth, redirectURI, devUsername, devPassword string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req LoginRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}

		useEntra := req.Mode == "entra" || req.Mode == "entra_id" || (req.Mode == "" && req.Code != "")

		if useEntra {
			if req.Code == "" {
				http.Error(w, "code is required for entra login", http.StatusBadRequest)
				return
			}
			if entraAuth == nil {
				http.Error(w, "entra id auth not configured", http.StatusServiceUnavailable)
				return
			}

			tokenResp, err := entraAuth.ExchangeCode(r.Context(), req.Code, redirectURI)
			if err != nil {
				slog.ErrorContext(r.Context(), "entra code exchange failed", "err", err)
				http.Error(w, "authentication failed", http.StatusUnauthorized)
				return
			}

			userInfo, err := entraAuth.GetUserInfo(r.Context(), tokenResp.AccessToken)
			if err != nil {
				slog.ErrorContext(r.Context(), "failed to fetch entra user info", "err", err)
				http.Error(w, "authentication failed", http.StatusUnauthorized)
				return
			}

			accessToken, err := jwtAuth.GenerateTokenWithClaims(userInfo.UserID, userInfo.Email, userInfo.DisplayName, userInfo.ObjectID, accessTokenTTLSeconds)
			if err != nil {
				slog.ErrorContext(r.Context(), "failed to issue access token", "err", err)
				http.Error(w, "failed to issue access token", http.StatusInternalServerError)
				return
			}
			refreshToken, err := jwtAuth.GenerateTokenWithClaims(userInfo.UserID, userInfo.Email, userInfo.DisplayName, userInfo.ObjectID, refreshTokenTTLSeconds)
			if err != nil {
				slog.ErrorContext(r.Context(), "failed to issue refresh token", "err", err)
				http.Error(w, "failed to issue refresh token", http.StatusInternalServerError)
				return
			}

			writeLoginResponse(w, accessToken, refreshToken, accessTokenTTLSeconds)
			return
		}

		// Username/password fallback — only usable when explicitly configured.
		if devUsername == "" || devPassword == "" {
			http.Error(w, "username/password login is not enabled", http.StatusUnauthorized)
			return
		}
		if req.Username != devUsername || req.Password != devPassword {
			http.Error(w, "invalid credentials", http.StatusUnauthorized)
			return
		}

		accessToken, err := jwtAuth.GenerateToken(req.Username, req.Username, accessTokenTTLSeconds)
		if err != nil {
			slog.ErrorContext(r.Context(), "failed to issue access token", "err", err)
			http.Error(w, "failed to issue access token", http.StatusInternalServerError)
			return
		}
		refreshToken, err := jwtAuth.GenerateToken(req.Username, req.Username, refreshTokenTTLSeconds)
		if err != nil {
			slog.ErrorContext(r.Context(), "failed to issue refresh token", "err", err)
			http.Error(w, "failed to issue refresh token", http.StatusInternalServerError)
			return
		}

		writeLoginResponse(w, accessToken, refreshToken, accessTokenTTLSeconds)
	}
}

// HandleRefreshToken wires POST /api/auth/token/refresh to
// internal/auth.JWTAuth.VerifyToken (tasks.md T184): the caller's refresh
// token (itself a JWT minted by HandleLogin, since this service has no
// external refresh-token store) is verified and, if valid, a new access/
// refresh token pair is reissued carrying the same claims.
func HandleRefreshToken(jwtAuth *auth.JWTAuth) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req struct {
			RefreshToken string `json:"refresh_token"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		if req.RefreshToken == "" {
			http.Error(w, "refresh_token is required", http.StatusBadRequest)
			return
		}

		claims, err := jwtAuth.VerifyToken(req.RefreshToken)
		if err != nil {
			slog.WarnContext(r.Context(), "refresh token verification failed", "err", err)
			http.Error(w, "invalid or expired refresh token", http.StatusUnauthorized)
			return
		}

		accessToken, err := jwtAuth.GenerateTokenWithClaims(claims.UserID, claims.Email, claims.DisplayName, claims.ObjectID, accessTokenTTLSeconds)
		if err != nil {
			slog.ErrorContext(r.Context(), "failed to issue access token", "err", err)
			http.Error(w, "failed to issue access token", http.StatusInternalServerError)
			return
		}
		refreshToken, err := jwtAuth.GenerateTokenWithClaims(claims.UserID, claims.Email, claims.DisplayName, claims.ObjectID, refreshTokenTTLSeconds)
		if err != nil {
			slog.ErrorContext(r.Context(), "failed to issue refresh token", "err", err)
			http.Error(w, "failed to issue refresh token", http.StatusInternalServerError)
			return
		}

		writeLoginResponse(w, accessToken, refreshToken, accessTokenTTLSeconds)
	}
}

func writeLoginResponse(w http.ResponseWriter, accessToken, refreshToken string, expiresIn int) {
	resp := LoginResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    expiresIn,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
