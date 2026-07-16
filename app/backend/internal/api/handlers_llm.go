package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/rad-system/m365-knowledge-graph/internal/auth"
	"github.com/rad-system/m365-knowledge-graph/internal/common"
)

type LLMConfigRequest struct {
	Provider string `json:"provider"`  // "openai", "anthropic", "azure", "custom", "fptcloud"
	BaseURL  string `json:"base_url"`  // Provider API base URL - SSRF validated (blocks private IPs, localhost, link-local)
	APIKey   string `json:"api_key"`   // API key - encrypted via pgcrypto pgp_sym_encrypt before storage
	Model    string `json:"model"`     // e.g., "gpt-4o-mini", "claude-3-5-sonnet-20241022"
	NLPMode  int    `json:"nlp_mode"`  // 1=cloud_only, 2=cloud+local, 3=local_only
}

type LLMConfigResponse struct {
	OK      bool   `json:"ok"`
	Message string `json:"message,omitempty"`
}

type LLMConfigView struct {
	Provider  string    `json:"provider"`
	BaseURL   string    `json:"base_url"`
	Model     string    `json:"model"`
	NLPMode   int       `json:"nlp_mode"`
	UpdatedAt time.Time `json:"updated_at"`
	UpdatedBy string    `json:"updated_by"`
	// APIKey is NOT returned for security
}

// HandleLLMConfig はLLM設定変更エンドポイント (POST only)
// JWT 認証必須、設定をPostgreSQLに永続化
// NOTE: Config changes require server restart to take effect (hot-reload not yet implemented)
func HandleLLMConfig(db *sql.DB, jwtAuth *auth.JWTAuth) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// JWT 検証
		token := extractBearerToken(r)
		if token == "" {
			slog.WarnContext(r.Context(), "LLM config POST: no token provided")
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		claims, err := jwtAuth.VerifyToken(token)
		if err != nil {
			slog.WarnContext(r.Context(), "LLM config POST: invalid JWT", "err", err)
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		// リクエスト解析
		var req LLMConfigRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			slog.WarnContext(r.Context(), "LLM config POST: invalid request body", "err", err)
			http.Error(w, "Bad request", http.StatusBadRequest)
			return
		}
		defer r.Body.Close()

		// 許可リスト確認
		validProviders := map[string]bool{
			"openai":    true,
			"anthropic": true,
			"azure":     true,
			"custom":    true,
			"fptcloud":  true,
		}
		if !validProviders[req.Provider] {
			slog.WarnContext(r.Context(), "LLM config POST: invalid provider", "provider", req.Provider)
			http.Error(w, "Invalid provider", http.StatusBadRequest)
			return
		}

		// NLP_MODE 検証
		if req.NLPMode < 1 || req.NLPMode > 3 {
			req.NLPMode = 1 // デフォルト: cloud_only
		}

		// SSRF validation for base_url
		if err := common.ValidateURL(req.BaseURL); err != nil {
			slog.WarnContext(r.Context(), "LLM config POST: SSRF validation failed", "err", err)
			http.Error(w, fmt.Sprintf("Invalid base_url: %v", err), http.StatusBadRequest)
			return
		}

		// ログ記録（APIキーはマスク）
		slog.InfoContext(r.Context(),
			"LLM config update requested",
			"user_id", claims.UserID,
			"provider", req.Provider,
			"model", req.Model,
			"nlp_mode", req.NLPMode,
		)
		// APIキーはログに出力しない！

		// PostgreSQLに永続化 (upsert)
		ctx := r.Context()
		err = upsertLLMConfig(ctx, db, req, claims.UserID)
		if err != nil {
			slog.ErrorContext(ctx, "LLM config POST: failed to persist config", "err", err)
			http.Error(w, "Failed to save config", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(LLMConfigResponse{
			OK:      true,
			Message: "Config saved. Restart server to apply changes.",
		})
	})
}

// HandleLLMConfigGet returns the current LLM configuration (GET only)
// JWT 認証必須、APIキーはマスク
func HandleLLMConfigGet(db *sql.DB, jwtAuth *auth.JWTAuth) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// JWT 検証
		token := extractBearerToken(r)
		if token == "" {
			slog.WarnContext(r.Context(), "LLM config GET: no token provided")
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		_, err := jwtAuth.VerifyToken(token)
		if err != nil {
			slog.WarnContext(r.Context(), "LLM config GET: invalid JWT", "err", err)
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		// 設定を取得
		ctx := r.Context()
		config, err := getLLMConfig(ctx, db)
		if err != nil {
			if err == sql.ErrNoRows {
				// No config stored yet - return empty/default
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(LLMConfigView{
					Provider: "none",
					Model:    "",
					NLPMode:  1,
				})
				return
			}
			slog.ErrorContext(ctx, "LLM config GET: failed to retrieve config", "err", err)
			http.Error(w, "Failed to retrieve config", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(config)
	})
}

// upsertLLMConfig stores LLM configuration in PostgreSQL with encrypted API key
// Uses pgcrypto pgp_sym_encrypt with key from llm_config_encryption_key table
func upsertLLMConfig(ctx context.Context, db *sql.DB, req LLMConfigRequest, userID string) error {
	// Encrypt API key using pgcrypto with stored symmetric key
	query := `
		INSERT INTO llm_config (id, provider, base_url, api_key, model, nlp_mode, updated_at, updated_by)
		VALUES (
			1,
			$1,
			$2,
			pgp_sym_encrypt($3, (SELECT encryption_key FROM llm_config_encryption_key WHERE id = 1)),
			$4,
			$5,
			$6,
			$7
		)
		ON CONFLICT (id)
		DO UPDATE SET
			provider = EXCLUDED.provider,
			base_url = EXCLUDED.base_url,
			api_key = pgp_sym_encrypt($3, (SELECT encryption_key FROM llm_config_encryption_key WHERE id = 1)),
			model = EXCLUDED.model,
			nlp_mode = EXCLUDED.nlp_mode,
			updated_at = EXCLUDED.updated_at,
			updated_by = EXCLUDED.updated_by
	`
	_, err := db.ExecContext(ctx, query,
		req.Provider,
		req.BaseURL,
		req.APIKey, // Encrypted via pgp_sym_encrypt in SQL
		req.Model,
		req.NLPMode,
		time.Now(),
		userID,
	)
	return err
}

// getLLMConfig retrieves the current LLM configuration (APIKey masked - never returned)
func getLLMConfig(ctx context.Context, db *sql.DB) (*LLMConfigView, error) {
	query := `
		SELECT provider, base_url, model, nlp_mode, updated_at, updated_by
		FROM llm_config
		WHERE id = 1
	`
	var config LLMConfigView
	err := db.QueryRowContext(ctx, query).Scan(
		&config.Provider,
		&config.BaseURL,
		&config.Model,
		&config.NLPMode,
		&config.UpdatedAt,
		&config.UpdatedBy,
	)
	if err != nil {
		return nil, err
	}
	return &config, nil
}

// getDecryptedAPIKey retrieves and decrypts the API key (for internal use only, e.g., hot reload)
// WARNING: Never expose this value via HTTP response - security sensitive
func getDecryptedAPIKey(ctx context.Context, db *sql.DB) (string, error) {
	query := `
		SELECT pgp_sym_decrypt(
			api_key::bytea,
			(SELECT encryption_key FROM llm_config_encryption_key WHERE id = 1)
		)
		FROM llm_config
		WHERE id = 1
	`
	var apiKey string
	err := db.QueryRowContext(ctx, query).Scan(&apiKey)
	if err != nil {
		return "", err
	}
	return apiKey, nil
}

func extractBearerToken(r *http.Request) string {
	authHeader := r.Header.Get("Authorization")
	if len(authHeader) > 7 && authHeader[:7] == "Bearer " {
		return authHeader[7:]
	}
	return ""
}
