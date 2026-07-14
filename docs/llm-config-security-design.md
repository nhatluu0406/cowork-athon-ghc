# LLM 設定連携 — セキュリティ設計資料

LLM設定を `service/src/provider` (TypeScript UI) から `app/backend/cmd` (Go バックエンド) に動的に連携するための セキュリティ設計。

---

## 1. 設計概要

### アーキテクチャ

```
┌─ UI サービス (service/src/provider) ────────────┐
│  ProviderPort (LLM プロバイダー管理)            │
│  - credentialRef (API キー参照)                  │
│  - baseUrl (エンドポイント URL、SSRF 検査済み)  │
│  - model (モデル名)                              │
│  API: POST /v1/providers/sync-backend           │
└─────────────────────────────────────────────────┘
            ↓ HTTPS (TLS)
            ↓ JWT 認証必須
┌─ Go バックエンド (app/backend/cmd) ─────────────┐
│  新規エンドポイント: POST /api/llm/config       │
│  ↓ config.go の LLMModel / LLMSvcAddr を更新   │
│  ↓ llm-svc に環境変数経由で反映                │
└─────────────────────────────────────────────────┘
            ↓
┌─ llm-svc (Rust gRPC) ──────────────────────────┐
│  LLM_API_BASE_URL / LLM_API_KEY を読み込み      │
│  NLP_MODE = 1 (CloudOnly, デフォルト)          │
└─────────────────────────────────────────────────┘
```

---

## 2. 脅威モデル（STRIDE）

### T1: APIキーの露出（ログ/レスポンス）
**脅威**: `LLM_API_KEY` がログ/ログファイル/エラーレスポンスに記録される

**対策**:
- ❌ `/api/llm/config` のレスポンスにはAPIキー値を含めない（成功時は `{ "ok": true }` のみ）
- ✅ `slog` でのログ出力時、APIキーを含むフィールドを自動マスク
- ✅ Go バックエンド側で `credentialService.scrubber` を使用して認証器にマスク情報を教える

**実装チェック**:
```go
// 🚫 NG: APIキーをレスポンスに含める
type LLMConfigResponse struct {
    APIKey string `json:"api_key"` // 含めない！
}

// ✅ OK: 成功/失敗のみ返す
type LLMConfigResponse struct {
    OK bool `json:"ok"`
}
```

---

### T2: 不正な base_url によるSSRF攻撃
**脅威**: 攻撃者が内部 IP (127.0.0.1:6379 など) を `base_url` に指定、内部リソースにアクセス

**対策**:
- ✅ `service/src/provider` の `SsrfPolicy` (CGHC-005 ADR) で検査済みの URL のみ Go バックエンドに転送
- ✅ Go バックエンドでは、SSRF 検査済みマークがある URL のみ受け入れ
- ✅ llm-svc は `LLM_API_BASE_URL` を環境変数経由で受け取り、HTTP/HTTPS のみ許可

**実装チェック**:
```go
// 🚫 NG: 任意の URL を受け入れる
baseURL := req.BaseURL // 直接使用

// ✅ OK: 事前検査済みマークの確認
if !req.HasSSRFValidation {
    return errors.New("base_url not SSRF-validated")
}
baseURL := req.BaseURL
```

---

### T3: 認証なしのLLM設定変更
**脅威**: 認証なしで `/api/llm/config` を呼び出し、LLM設定を改ざん

**対策**:
- ✅ `/api/llm/config` に JWT ミドルウェア適用（`api.HandleLLMConfig(jwtAuth, ...)`）
- ✅ JWT トークンに `user_id` / `email` を含める（Entra ID から取得）
- ✅ 設定変更ログに変更者 `user_id` を記録

**実装チェック**:
```go
// ✅ OK: JWT 認証ミドルウェアを通す
router.Register("/api/llm/config", 
    middleware.JWT(jwtAuth)(api.HandleLLMConfig(...)))
```

---

### T4: 中間者攻撃によるAPIキー窃取
**脅威**: HTTP (平文) 通信で `POST /v1/providers/sync-backend` を送信、APIキーが傍受される

**対策**:
- ✅ UI → Go バックエンド: HTTPS/TLS 必須（localhost 開発環境以外）
- ✅ Go バックエンド → llm-svc: TLS 推奨（`LLMSVC_TLS=true`, `LLMSVC_CERT_FILE` 設定）
- ✅ 本番環境チェック: TLS なし環境では警告ログを出力

**実装チェック**:
```bash
# 本番環境での必須設定
export LLMSVC_TLS=true
export LLMSVC_CERT_FILE=/etc/certs/server.crt
```

---

### T5: LLM設定の不正プロバイダーへの書き換え
**脅威**: 攻撃者が `provider: "attacker-llm"` に変更、返された回答が改ざんされる

**対策**:
- ✅ Provider の許可リスト: `openai`, `anthropic`, `azure`, `custom` のみ受け入れ
- ✅ `custom` の場合、`baseUrl` は SSRF ポリシー通過が前提
- ✅ Admin ロール確認: デフォルトプロバイダー変更は管理者のみ（将来実装）

**実装チェック**:
```go
// ✅ OK: 許可リスト確認
validProviders := map[string]bool{
    "openai": true, "anthropic": true, "azure": true, "custom": true,
}
if !validProviders[req.Provider] {
    return errors.New("invalid provider: " + req.Provider)
}
```

---

## 3. 実装ガイドライン

### 3.1 Go バックエンド側 (`app/backend/internal/api/handlers_llm.go`)

```go
package api

import (
    "encoding/json"
    "net/http"
    "log/slog"
    "github.com/rad-system/m365-knowledge-graph/internal/auth"
)

type LLMConfigRequest struct {
    Provider    string `json:"provider"`     // "openai", "anthropic", "azure", "custom"
    BaseURL     string `json:"base_url"`     // SSRF 検査済みのみ
    APIKey      string `json:"api_key"`      // スクラブ対象
    Model       string `json:"model"`        // e.g., "gpt-4o-mini"
    NLPMode     int    `json:"nlp_mode"`     // 1=cloud_only, 2=cloud+local, 3=local_only
}

type LLMConfigResponse struct {
    OK bool `json:"ok"`
}

// HandleLLMConfig はLLM設定変更エンドポイント
// JWT 認証必須、設定は session に保存（または環境変数経由で llm-svc に反映）
func HandleLLMConfig(jwtAuth *auth.JWTAuth) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if r.Method != http.MethodPost {
            http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
            return
        }

        // JWT 検証
        token := extractToken(r)
        if token == "" {
            http.Error(w, "Unauthorized", http.StatusUnauthorized)
            return
        }
        claims, err := jwtAuth.VerifyToken(r.Context(), token)
        if err != nil {
            slog.WarnContext(r.Context(), "LLM config: invalid JWT", "err", err)
            http.Error(w, "Unauthorized", http.StatusUnauthorized)
            return
        }

        // リクエスト解析
        var req LLMConfigRequest
        if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
            http.Error(w, "Bad request", http.StatusBadRequest)
            return
        }

        // 許可リスト確認
        validProviders := map[string]bool{
            "openai": true, "anthropic": true, "azure": true, "custom": true,
        }
        if !validProviders[req.Provider] {
            http.Error(w, "Invalid provider", http.StatusBadRequest)
            return
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

        // 設定を反映（環境変数 or 設定構造体に保存）
        // TODO: 実装詳細は app/backend/internal/config に委譲

        w.Header().Set("Content-Type", "application/json")
        json.NewEncoder(w).Encode(LLMConfigResponse{OK: true})
    })
}

func extractToken(r *http.Request) string {
    authHeader := r.Header.Get("Authorization")
    if len(authHeader) > 7 && authHeader[:7] == "Bearer " {
        return authHeader[7:]
    }
    return ""
}
```

### 3.2 TypeScript サービス側 (`service/src/provider/router.ts`)

新規エンドポイント `/v1/providers/sync-backend` を追加：

```typescript
// wiring.ts または router.ts の createProviderRouter に追加
{
  method: "POST",
  path: "/v1/providers/sync-backend",
  handler: async (ctx: RouteContext): Promise<RouteResult<{ synced: true }>> => {
    // 現在のアクティブプロバイダー設定を取得
    const activeModel = modelConfig.activeModelFor();
    if (activeModel === undefined) {
      throw new ProviderRequestError("No active model configured.");
    }

    // Go バックエンドへ POST /api/llm/config
    const config = {
      provider: activeModel.providerId,
      base_url: getProviderBaseUrl(activeModel.providerId),
      api_key: await getProviderAPIKey(activeModel.providerId),
      model: activeModel.modelId,
      nlp_mode: 1, // default: cloud_only
    };

    const response = await fetch("http://localhost:8080/api/llm/config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${ctx.token}`,
      },
      body: JSON.stringify(config),
    });

    if (!response.ok) {
      throw new ProviderRequestError(
        `Failed to sync backend: ${response.status}`
      );
    }

    return { status: 200, data: { synced: true } };
  },
}
```

---

## 4. セキュリティテストチェックリスト

実装完了後、以下をテストして確認：

- [ ] **T1 チェック**: `/api/llm/config` レスポンスに `api_key` フィールドがない
- [ ] **T1 チェック**: バックエンドログに "api_key=..." という出力がない（マスク確認）
- [ ] **T2 チェック**: `base_url: "http://127.0.0.1:6379"` を送信 → 拒否される
- [ ] **T2 チェック**: SSRF 検査済みマーク付き URL のみ受け入れ
- [ ] **T3 チェック**: JWT なしで `/api/llm/config` を呼び出し → 401 Unauthorized
- [ ] **T3 チェック**: 無効な JWT で呼び出し → 401 Unauthorized
- [ ] **T4 チェック**: 本番環境で `LLMSVC_TLS=false` → 警告ログ出力
- [ ] **T5 チェック**: `provider: "invalid-provider"` → 400 Bad Request
- [ ] **T5 チェック**: `provider: "custom"` で SSRF 検査済み URL → 受け入れ

---

## 5. 参考資料

- ADR 0003/0005: SSRF ポリシー設計
- CGHC-005: Provider セキュリティ要件
- CGHC-002: 境界ルーター設計

---

**作成日**: 2026-07-14  
**バージョン**: 1.0  
**ステータス**: セキュリティレビュー待ち
