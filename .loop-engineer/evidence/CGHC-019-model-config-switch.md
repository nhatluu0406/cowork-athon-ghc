---
task: CGHC-019
title: "Model config switch: default + per-session override, không-restart, health, audit (PR4/PR5/PR6/P5)"
language: "vi"
status: DONE
created_at: "2026-07-11"
---

# CGHC-019 — Bằng chứng model config switch

## 1. Thành phần (`service/src/provider/`, mọi file < 250 dòng)

- `model-config-service.ts` (≈160) — `ModelConfigService` mỏng trên `ProviderPort` (MỘT nguồn chân lý,
  không tạo store thứ hai): `configureModel` (uỷ quyền lưu cho port + audit old→new), `activeModelFor`
  (PR4 precedence), `activeModel` (PR5 UI-confirm: scope đã resolve + label không secret),
  `checkHealth`/`checkActiveHealth` (PR6 reachability qua connector inject).
- `model-audit.ts` (58) — `ModelChangeAuditEvent` (secret-free by construction) + `ModelAuditSink`
  inject + in-memory default; theo đúng hình dạng permission P5 sink (không cơ chế audit thứ hai).

## 2. Acceptance → cơ chế → test

- **PR4 precedence**: `resolveWithScope(sessionId)` — session override thắng default; đọc map selection
  của port (một nguồn). `model-selection` test: s1 dùng override, s2 vẫn default.
- **PR5 switch-không-restart + UI-confirm**: selection đọc tại thời điểm request; đổi trên CÙNG instance
  ⇒ request kế dùng model mới; `activeModel()` phản ánh scope + label. `model-switch-no-restart` test.
- **PR6 health (SHOULD)**: `checkHealth`/`checkActiveHealth` uỷ quyền `port.testConnection` (connector
  inject, không mạng); health KHÔNG chặn switch. `model-health-surfacing` test.
- **P5 audit**: `configureModel` đọc selection cũ trước khi ghi ⇒ event old→new chỉ mang scope/sessionId?/
  2 ModelRef/timestamp — không key/CredentialRef/base_url. `model-audit-no-secret` test (bind handle
  secret-shaped, serialize cả trail ⇒ secret không xuất hiện; no-op reselection không audit).

## 3. Review độc lập (code-reviewer ≠ implementer) → PASS, 0 Critical/High

Xác nhận: một nguồn chân lý (không store thứ hai), precedence đúng, switch cùng-instance, audit
old→new không secret + không audit no-op, health không gate switch. Findings LOW:

- **LOW-2 (ĐÃ SỬA)**: input dị dạng `{scope:"default", sessionId:"stray"}` từng chép sessionId vào event
  default-scope (mâu thuẫn). Sửa: chỉ chép sessionId khi `scope==="session"`. Thêm test regression.
- **LOW-3 (ĐÃ SỬA)**: `activeModel` lặp lại logic precedence của `resolveActive`. Gộp về một
  `resolveWithScope` (trả model + scope) dùng chung ⇒ hết trùng, không divergence tương lai.
- **LOW-4 (ĐÃ SỬA)**: chưa test probe health REJECT (throw). Thêm test: probe throw ⇒ selection vẫn
  nguyên (health là path đọc riêng, đồng bộ tách khỏi probe async).
- **LOW-1 (carry-forward → CGHC-022)**: chưa có khả năng CLEAR một session override để quay về default
  (port chỉ có set/get, không delete). Product-relevant; chuyển cho settings/model UI.

## 4. Kiểm chứng

- Model tests: **13 pass** (11 + LOW-2 + LOW-4). Full suite tại thời điểm land: 339 pass / 0 skip / 0 fail;
  `tsc -b` sạch (full re-verify sau khi CGHC-008 song song land).
- Seam UI: `activeModel(sessionId?)` (UI-confirm), `configureModel` (write default + per-session),
  `checkHealth`/`checkActiveHealth` (tín hiệu reachability không gate), `ModelAuditSink` inject.
