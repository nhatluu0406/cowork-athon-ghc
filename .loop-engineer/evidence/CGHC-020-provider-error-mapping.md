---
task: CGHC-020
title: "Provider error mapping + bounded retry + secret-non-leak (PR7)"
language: "vi"
status: DONE
created_at: "2026-07-11"
---

# CGHC-020 — Bằng chứng provider error mapping

## 1. Bảng ánh xạ (raw → kind → retryable → recovery)

| Điều kiện raw | kind | retryable | recovery |
|---|---|---|---|
| 401 / 403 | auth_invalid | false | Re-enter/replace credential |
| 429 | rate_limited | true (bounded) | Wait/retry, giảm rate, hoặc đổi model |
| 408 / AbortError / name~abort\|timeout | timeout | true | Retry hoặc cancel |
| 5xx (500–599) | unavailable | true | Retry sau hoặc đổi provider |
| ECONNREFUSED/ENOTFOUND/ECONNRESET/EAI_AGAIN/EPIPE/ENETUNREACH/EHOSTUNREACH | unavailable | true | Kiểm tra mạng và retry |
| ETIMEDOUT | timeout | true | Retry hoặc cancel |
| `TypeError: fetch failed` (bare / cause socket) | unavailable | true | Kiểm tra mạng và retry |
| `fetch failed` cause ETIMEDOUT | timeout | true | Retry hoặc cancel |
| còn lại (418, string, null…) | unknown | false | Xem message và cancel |

Không thêm `ProviderErrorKind` mới (network → `unavailable`, socket timeout → `timeout`).
`codeOf` unwrap `error.cause` một cấp nên `fetch failed` phân loại theo socket code bên dưới.

## 2. Retry có chặn (`retry-policy.ts`)

`retryDecision(error, attempt, opts)` thuần: `DEFAULT_RETRY_POLICY` maxAttempts=4, base=250ms, cap=8000ms.
Backoff `min(cap, base*2^(attempt-1)) + jitter(inject)`, re-cap tại cap, monotonic. Trả `retry:false`
khi (a) kind ∈ NON_RETRYABLE (auth_invalid/unknown) — KIỂM TRA TRƯỚC cờ retryable, (b) `error.retryable`
false, (c) `attempt >= maxAttempts`. Không sleep; clock/jitter inject để test deterministic.

## 3. Secret non-leak (load-bearing, security co-sign)

`message`/`recovery` là hằng số tĩnh module-level; `mapProviderError` chỉ đọc status integer hoặc
`code` string (dùng cho set-membership), KHÔNG copy ký tự nào của raw message/body/headers/url/query/cause
vào output. Không log raw error ở cả hai module.

## 4. Review độc lập (2 reviewer ≠ implementer) → cả hai PASS, 0 Critical/High

- **test-engineer PASS**: bảng ánh xạ đúng+đủ; retry bound THẬT (loop-guard test tripping nếu bỏ cap;
  off-by-one đúng: maxAttempts=4 ⇒ 1 lần đầu + 3 retry). MEDIUM: guard NON_RETRYABLE chưa được test
  cô lập (xóa guard vẫn xanh vì cờ retryable của auth/unknown vốn false) → **ĐÃ SỬA**: thêm test ép
  `retryable:true` cho auth_invalid+unknown ⇒ vẫn `retry:false` (cô lập đúng guard). LOW:
  ENETUNREACH/EHOSTUNREACH map nhưng chưa test → **ĐÃ SỬA** (thêm 2 case). LOW/INFO: statusOf nhặt
  DOMException code=20 làm pseudo-status — benign (không khớp branch nào; isTimeoutLike bắt AbortError).
- **security-reviewer (co-sign) PASS**: xác nhận output 100% hằng số tĩnh; không đường nào copy raw
  text; test secret-non-leak phủ đủ vector (message/body/header/url/query/cause); không log raw.

## 5. Kiểm chứng

- Full suite: **328 pass / 0 fail / 0 skip**; `tsc -b` sạch. Reuse provider-contract-suite cho các leg
  lỗi (openai + custom-openai-compat).
