# API Contracts: Enable Local LLM (004)

**Base path**: `/api/llm`
**Auth**: Bearer JWT (existing `internal/api/authz.go` middleware)
**Content-Type**: `application/json`

---

## 1. `GET /api/llm/settings` — Lấy cấu hình LLM hiện tại

### Response 200
```json
{
  "local_llm_enabled": false,
  "local_model_name": "",
  "local_model_timeout_s": 30
}
```

| Field | Type | Notes |
|-------|------|-------|
| `local_llm_enabled` | bool | Trạng thái bật/tắt local LLM |
| `local_model_name` | string | Tên model local đang chọn; `""` nếu chưa chọn |
| `local_model_timeout_s` | int | Số giây chờ local model trước khi fallback |

---

## 2. `PUT /api/llm/settings` — Cập nhật cấu hình LLM

Partial update — chỉ các field được gửi sẽ thay đổi.

### Request
```json
{
  "local_llm_enabled": true,
  "local_model_name": "llama-3-8b-q4",
  "local_model_timeout_s": 30
}
```

| Field | Type | Required | Constraint |
|-------|------|----------|------------|
| `local_llm_enabled` | bool | — | |
| `local_model_name` | string | — | Phải là tên model hợp lệ từ `GET /api/llm/models` khi không rỗng |
| `local_model_timeout_s` | int | — | 1–300; default 30 |

### Response 200 — cấu hình sau khi cập nhật
```json
{
  "local_llm_enabled": true,
  "local_model_name": "llama-3-8b-q4",
  "local_model_timeout_s": 30
}
```

**400 Bad Request** — model name không hợp lệ (không có trong llm-svc):
```json
{ "error": "invalid_model", "message": "model 'unknown-model' is not available in llm-svc" }
```

**400** — timeout ngoài khoảng hợp lệ:
```json
{ "error": "invalid_timeout", "message": "local_model_timeout_s must be between 1 and 300" }
```

**400** — bật local LLM nhưng không có model nào khả dụng:
```json
{ "error": "no_local_models", "message": "no local models are available in llm-svc; add models before enabling local LLM" }
```

---

## 3. `GET /api/llm/models` — Liệt kê models khả dụng

Gọi `llm-svc ListModels` RPC và trả về kết quả, phân loại local/cloud.

### Response 200
```json
{
  "models": [
    {
      "name": "llama-3-8b-q4",
      "kind": "generation",
      "format": "GGUF",
      "is_local": true,
      "is_default": false
    },
    {
      "name": "gpt-4o-mini",
      "kind": "generation",
      "format": "API",
      "is_local": false,
      "is_default": true
    },
    {
      "name": "text-embedding-3-small",
      "kind": "embedding",
      "format": "API",
      "is_local": false,
      "is_default": true
    }
  ]
}
```

**503 Service Unavailable** — không thể kết nối llm-svc:
```json
{ "error": "llmsvc_unavailable", "message": "llm-svc is not reachable; check LLMSVC_ADDR configuration" }
```

---

## 4. `GET /api/llm/fallback-events` — Lịch sử fallback (optional, P3)

### Query params
- `limit` (optional): default 20, max 100

### Response 200
```json
{
  "events": [
    {
      "id": 1,
      "reason": "timeout",
      "local_model": "llama-3-8b-q4",
      "cloud_model": "gpt-4o-mini",
      "operation": "generate",
      "latency_ms": 30045,
      "created_at": "2026-07-17T10:05:00Z"
    }
  ],
  "total": 1
}
```

---

## 5. Changes to `GET /api/knowledge/query` response

Existing endpoint — thêm field `llm_info` vào response:

### Normal (local LLM, no fallback):
```json
{
  "results": [...],
  "llm_info": {
    "mode": "local",
    "model": "llama-3-8b-q4",
    "used_fallback": false
  }
}
```

### Fallback occurred:
```json
{
  "results": [...],
  "llm_info": {
    "mode": "cloud",
    "model": "gpt-4o-mini",
    "used_fallback": true,
    "fallback_reason": "timeout"
  }
}
```

### Cloud mode (local LLM disabled):
```json
{
  "results": [...],
  "llm_info": {
    "mode": "cloud",
    "model": "gpt-4o-mini",
    "used_fallback": false
  }
}
```

---

## 6. WebSocket Event: `llm_fallback`

Pushed via existing `internal/websocket/hub.Hub.Broadcast` khi fallback xảy ra trong bất kỳ request nào.

```json
{
  "type": "llm_fallback",
  "payload": {
    "local_model": "llama-3-8b-q4",
    "cloud_model": "gpt-4o-mini",
    "reason": "timeout",
    "latency_ms": 30045
  }
}
```

**Reason values**: `timeout` | `model_error` | `resource_exhaustion` | `model_unavailable`

---

## 7. Error Response Shape (tất cả endpoints)

```json
{
  "error": "<error_code>",
  "message": "<human-readable, không chứa model path hoặc secrets>"
}
```

HTTP codes: `400` validation, `401` auth, `404` not found, `503` llm-svc unreachable, `500` unexpected.
