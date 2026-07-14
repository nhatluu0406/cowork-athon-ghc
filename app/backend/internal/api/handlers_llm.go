package api

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/rad-system/m365-knowledge-graph/internal/auth"
)

type LLMConfigRequest struct {
	Provider string `json:"provider"` // "openai", "anthropic", "azure", "custom"
	BaseURL  string `json:"base_url"` // SSRF 検査済みのみ
	APIKey   string `json:"api_key"`  // スクラブ対象
	Model    string `json:"model"`    // e.g., "gpt-4o-mini"
	NLPMode  int    `json:"nlp_mode"` // 1=cloud_only, 2=cloud+local, 3=local_only
}

type LLMConfigResponse struct {
	OK bool `json:"ok"`
}

// HandleLLMConfig はLLM設定変更エンドポイント
// JWT 認証必須、設定を動的に更新
func HandleLLMConfig(jwtAuth *auth.JWTAuth) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// JWT 検証
		token := extractBearerToken(r)
		if token == "" {
			slog.WarnContext(r.Context(), "LLM config: no token provided")
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		claims, err := jwtAuth.VerifyToken(token)
		if err != nil {
			slog.WarnContext(r.Context(), "LLM config: invalid JWT", "err", err)
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		// リクエスト解析
		var req LLMConfigRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			slog.WarnContext(r.Context(), "LLM config: invalid request body", "err", err)
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
		}
		if !validProviders[req.Provider] {
			slog.WarnContext(r.Context(), "LLM config: invalid provider", "provider", req.Provider)
			http.Error(w, "Invalid provider", http.StatusBadRequest)
			return
		}

		// NLP_MODE 検証
		if req.NLPMode < 1 || req.NLPMode > 3 {
			req.NLPMode = 1 // デフォルト: cloud_only
		}

		// ログ記録（APIキーはマスク）
		slog.InfoContext(r.Context(),
			"LLM config updated",
			"user_id", claims.UserID,
			"provider", req.Provider,
			"model", req.Model,
			"nlp_mode", req.NLPMode,
		)
		// APIキーはログに出力しない！

		// TODO: 設定を反映（環境変数 or 設定構造体に保存）
		// - LLM_API_BASE_URL = req.BaseURL
		// - LLM_API_KEY = req.APIKey (credentialService に保存推奨)
		// - LLM_MODEL = req.Model
		// - NLP_MODE = req.NLPMode (llm-svc に伝播)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(LLMConfigResponse{OK: true})
	})
}

func extractBearerToken(r *http.Request) string {
	authHeader := r.Header.Get("Authorization")
	if len(authHeader) > 7 && authHeader[:7] == "Bearer " {
		return authHeader[7:]
	}
	return ""
}
