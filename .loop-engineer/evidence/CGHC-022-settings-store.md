---
task: CGHC-022
title: "Settings store: persist + corrupt-recovery + SSOT redaction + clear-override (SD1/SD4/SD5)"
language: "vi"
status: DONE
created_at: "2026-07-11"
---

# CGHC-022 — Bằng chứng settings store

## 1. Thành phần (`service/src/diagnostics/`, `app/ui/`, + bổ sung nhỏ `service/src/provider/`)

- `settings-types.ts` — shape bền `CoworkSettings` (general + providers + `modelPreference`),
  `SETTINGS_SCHEMA_VERSION`, default an toàn. Provider entry chỉ có `CredentialRef` handle
  (`{store,account}`) + `baseUrl` non-secret — KHÔNG có field key (raw key structurally không lưu được).
- `settings-recovery.ts` — `recoverSettings(raw)` KHÔNG BAO GIỜ throw: parse → migrate → coerce từng
  field → default an toàn + reason non-secret (SD5). Migrate doc legacy versionless.
- `settings-store.ts` — `openSettingsStore()` load-on-construct + write-through qua seam `SettingsFs`
  inject; SSOT model preference (không localStorage); `reset()`/`loadSource()`/`recoveryReason()`.
- `settings-fs-node.ts` — write atomic temp+rename; ENOENT → first-run.
- `settings-diagnostics.ts` — export SD4 REUSE `SecretScrubber.scrubJson` của CGHC-021 (không tái tạo).
- `settings-router.ts` — BoundaryRouter token-guarded; credential route nhận HANDLE only; GET projection
  non-secret (`hasCredential` + account label, không key).
- `provider-port.ts` + `model-config-service.ts` — thêm `clearModel(scope, sessionId?)` +
  `clearSessionModel(sessionId)` (CGHC-019 LOW-1 clear-override, một nguồn chân lý, audit revert).
- `app/ui/` — `settings-view.ts` (client-only, `textContent`, không secret DOM), `service-client.ts`
  (methods typed, `setProviderCredentialRef` handle only), `main.ts` mount.

## 2. Acceptance → test

- **SD1 persist-across-restart**: `settings-persistence` — instance A ghi, instance B đọc lại
  general/provider-handle/base_url/default-model; + migrate legacy.
- **SD5 corrupt-recovery**: `settings-corrupt-recovery` — byte hỏng → default an toàn, không throw, store
  vẫn ghi được, `reset()`, coerce từng field.
- **SD4 SSOT + redaction**: `settings-diagnostics-redaction` — plant `sk-FAKE…` ở account+base_url ⇒ 0
  lần trong export (positive control: snapshot raw CÓ chứa secret).
- **LOW-1 clear-override**: `model-clear-override` — set override → clear → `activeModelFor`==default;
  + no-op, audit, port `clearModel` rule; + clear-to-nothing.

## 3. Review độc lập (code-reviewer ≠ implementer) → PASS, 0 Critical/High

Xác nhận: không field key (structurally); recover không throw; SSOT một store bền + port là runtime
resolver (không store thứ hai); write atomic; SD4 reuse scrubber (positive control); router token-guarded
handle-only; clear-override trung thành CGHC-019; renderer hardened. Findings:

- **LOW-1 (ĐÃ SỬA)**: clear override khi CHƯA có default ⇒ `next` undefined ⇒ audit bị bỏ, dù đây là
  thay đổi trạng thái thật (session → không model). Sửa: `ModelChangeAuditEvent.next` thành
  `ModelRef | null`; `clearSessionModel` audit revert-to-nothing (`next: null`). Thêm test.
- **INFO-1/INFO-2 → COMPOSITION ROOT (đã ghi nhận)**: settings router + các router khác (workspace/
  provider/credential/ev-stream/permission/files) CHƯA mount vào `service/src/index.ts` (staged pattern);
  SD1 chưa được chứng minh end-to-end qua loopback. Khi wiring: (a) mount + integration test round-trip;
  (b) feed giá trị credential thật vào scrubber cho lớp redaction thứ hai; (c) `setProviderBaseUrl` phải
  đi qua `provider-port.configureEndpoint` (SSRF + DNS-rebinding re-check) — KHÔNG lưu base_url chưa validate.

## 4. Kiểm chứng

- Full suite: **372 pass / 0 fail / 0 skip**; `tsc -b` sạch. Mọi file < 250 dòng.
