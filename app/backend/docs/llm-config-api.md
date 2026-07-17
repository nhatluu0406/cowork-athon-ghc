# LLM Configuration API

## Overview

The LLM Configuration API allows authenticated users to configure the LLM provider settings dynamically without modifying environment variables. Configuration is persisted in PostgreSQL and requires a server restart to take effect.

## Endpoints

### POST /api/llm/config

Update LLM provider configuration.

**Authentication:** JWT Bearer token required

**Request Body:**
```json
{
  "provider": "openai",
  "base_url": "https://api.openai.com/v1",
  "api_key": "sk-...",
  "model": "gpt-4o-mini",
  "nlp_mode": 1
}
```

**Fields:**
- `provider` (string, required): One of `openai`, `anthropic`, `azure`, `custom`
- `base_url` (string, optional): Provider API base URL (empty for default)
- `api_key` (string, required): API key for the provider
- `model` (string, required): Model identifier (e.g., `gpt-4o-mini`, `claude-3-5-sonnet-20241022`)
- `nlp_mode` (integer, optional): NLP processing mode
  - `1` = cloud_only (keyword fallback)
  - `2` = cloud+local (hybrid)
  - `3` = local_only (LLM-based)

**Response (200 OK):**
```json
{
  "ok": true,
  "message": "Config saved. Restart server to apply changes."
}
```

**Error Responses:**
- `400 Bad Request`: Invalid provider or malformed request
- `401 Unauthorized`: Missing or invalid JWT token
- `500 Internal Server Error`: Database error

---

### GET /api/llm/config/current

Retrieve current LLM configuration (API key masked).

**Authentication:** JWT Bearer token required

**Response (200 OK):**
```json
{
  "provider": "openai",
  "base_url": "https://api.openai.com/v1",
  "model": "gpt-4o-mini",
  "nlp_mode": 1,
  "updated_at": "2026-07-16T14:30:00Z",
  "updated_by": "user@example.com"
}
```

**Note:** `api_key` is never returned for security.

**Error Responses:**
- `401 Unauthorized`: Missing or invalid JWT token
- `500 Internal Server Error`: Database error

---

## Database Schema

Configuration is stored in the `llm_config` table (singleton pattern):

```sql
CREATE TABLE llm_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),  -- Singleton: only one row
    provider VARCHAR(50) NOT NULL,
    base_url TEXT NOT NULL DEFAULT '',
    api_key TEXT NOT NULL DEFAULT '',       -- TODO: Encrypt at rest
    model VARCHAR(100) NOT NULL,
    nlp_mode INTEGER NOT NULL DEFAULT 1 CHECK (nlp_mode BETWEEN 1 AND 3),
    updated_at TIMESTAMP NOT NULL,
    updated_by VARCHAR(255) NOT NULL
);
```

**Migration:** `migrations/004_llm_config.sql`

---

## Implementation Status

### ✅ Completed

- [x] HTTP handlers for POST and GET endpoints
- [x] JWT authentication enforcement
- [x] PostgreSQL persistence (singleton pattern)
- [x] Input validation (provider whitelist, NLP_MODE range)
- [x] Secure logging (API key never logged)
- [x] Database migration scripts
- [x] API documentation

### ⚠️ Known Limitations

1. **No Hot Reload**: Config changes require server restart to take effect
   - Current implementation only persists to DB
   - `cmd/main.go` loads config from environment at startup
   - Hot-reload would require:
     - Global config manager with mutex
     - Rebuild retriever pipeline with new clients
     - Graceful shutdown of old gRPC connections
     - Propagate config to llm-svc via environment/IPC

2. **API Key Storage**: Currently stored in plaintext
   - TODO: Integrate with `credentialService` for encryption
   - TODO: Add SSRF validation for `base_url`

3. **No Config History**: Single-row table overwrites previous config
   - Consider adding `llm_config_history` audit table

---

## Usage Example (TypeScript Client)

```typescript
// In service/src/knowledge/m365kg-client.ts
async configureLLM(config: {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  nlpMode: number;
}): Promise<{ ok: boolean; message: string }> {
  return withAuthRetry(
    (token) => rawCall("/api/llm/config", { 
      method: "POST", 
      body: config, 
      token 
    }),
    (result) => {
      if (result.status >= 200 && result.status < 300) {
        const body = result.body as { ok: boolean; message: string };
        return body;
      }
      return { ok: false, message: "Failed to update config" };
    },
    () => ({ ok: false, message: "Request timeout" }),
    () => ({ ok: false, message: "Service unavailable" }),
    () => ({ ok: false, message: "Authentication failed" }),
  );
}

async getCurrentLLMConfig(): Promise<LLMConfigView | null> {
  return withAuthRetry(
    (token) => rawCall("/api/llm/config/current", { 
      method: "GET", 
      token 
    }),
    (result) => {
      if (result.status >= 200 && result.status < 300) {
        return result.body as LLMConfigView;
      }
      return null;
    },
    () => null,
    () => null,
    () => null,
  );
}
```

---

## Future Enhancements

1. **Hot Reload Support**
   - Implement `ConfigManager` with `sync.RWMutex`
   - Add `/api/llm/config/reload` endpoint to trigger runtime reconfiguration
   - Gracefully restart retriever pipeline

2. **Security Hardening**
   - Encrypt API keys using `credentialService`
   - Add SSRF validation for `base_url`
   - Implement rate limiting

3. **Config History & Rollback**
   - Add `llm_config_history` table
   - Implement `/api/llm/config/history` endpoint
   - Add rollback capability

4. **Multi-Provider Support**
   - Allow multiple provider configs (remove singleton constraint)
   - Add provider selection per query
   - Implement fallback chain

---

## Related Files

- Handler: `app/backend/internal/api/handlers_llm.go`
- Routes: `app/backend/cmd/routes.go`
- Migration: `app/backend/migrations/004_llm_config.sql`
- Config Struct: `app/backend/internal/common/config.go`
- Main Initialization: `app/backend/cmd/main.go`

---

## Testing

```bash
# Run migration
cd app/backend
make migrate-up

# Test POST endpoint
curl -X POST http://localhost:8080/api/llm/config \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "openai",
    "api_key": "sk-test-key",
    "model": "gpt-4o-mini",
    "nlp_mode": 1
  }'

# Test GET endpoint
curl http://localhost:8080/api/llm/config/current \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

---

**Implementation Date:** 2026-07-16  
**Author:** Claude Code (Sonnet 4.6)  
**Status:** Complete (with known limitations documented)
