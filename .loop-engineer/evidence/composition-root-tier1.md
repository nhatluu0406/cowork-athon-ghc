---
task: COMPOSITION-ROOT
title: "Composition root Tier 1 — wired loopback service (mount all routers + cross-cutting seams + start seam)"
language: "vi"
status: DONE
created_at: "2026-07-11"
---

# Composition Root Tier 1 — Bằng chứng lắp ráp dịch vụ loopback

Đây là nợ tích hợp (integration debt) gom từ các wave L6: các domain module đã hiện thực nhưng
KHÔNG có gì lắp chúng thành một dịch vụ chạy được. Tier 1 lắp ráp các hiện thực in-process ĐÃ CÓ,
mount mọi HTTP router lên một `LocalService`, nối các seam xuyên suốt, mở start seam, và CHỨNG MINH
bằng test round-trip qua loopback. Là tiền đề cho CGHC-028.

## 1. Thành phần (`service/src/composition/`)

- `compose-service.ts` (211) — `createCoworkService(options)` + `startCoworkService(options)`: dựng
  deps in-process thật (SettingsStore node-fs, credential keyring store DUY NHẤT, ProviderPort +
  ModelConfigService, PermissionGate + files ToolPermissionProxy + live RuntimeReplyPort redacting,
  workspace validate, SecretScrubber value-based, EV mapper factory, SessionService, SessionStreamHub),
  seed từ settings, mount toàn bộ router, trả về start seam.
- `types.ts` (88) — `CoworkServiceOptions`/`CoworkServiceDeps`/`CoworkService`.
- `wiring.ts` (98) — `defaultDnsResolver` (node:dns) + hai wrapper store xếp chồng (SSRF + port-sync).
- `tier2-seams.ts` (111) — mặc định "chưa gắn runtime" TRUNG THỰC + `RuntimeNotAttachedError`.
- `index.ts` (27) — barrel; export từ `service/src/index.ts`.

## 2. Nối seam xuyên suốt (một nguồn chân lý)

- **ModelConfigService ← settings**: `seedFromSettings()` lúc boot đọc `defaultModel()` +
  `credentialRef` và nạp vào port resolver. Sau HIGH-1 fix: wrapper `wrapSettingsStoreWithPortSync`
  bọc ngoài `wrapSettingsStoreWithSsrf` → `setDefaultModel`/`setProviderCredentialRef`/
  `removeProviderCredentialRef` ghi RESOLVER trước rồi store. Model/credential/base_url có MỘT nguồn
  chân lý xuyên store (`GET /v1/settings`), resolver (`activeModelFor()`), và Tier 2 launch reads —
  đổi model lúc chạy có hiệu lực không cần restart.
- **scrubber → redactError**: một `createSecretScrubber` chia sẻ vào credential service + composed
  `redactError = (msg) => sanitizeErrorMessage(scrubber.scrub(msg))`, luồn vào mapper của
  session-service rebuild + hub live streams. Value-based ACTIVE cho mọi giá trị credential scrubber
  đã học (store()/resolveInjection); shape `sanitizeErrorMessage` luôn chạy nền. KHÔNG seed sẵn từ
  keyring lúc boot (tránh nạp mọi secret vào bộ nhớ tiến trình).
- **gate ↔ files ↔ reply**: một `createPermissionGate` (reply + audit + session-denial adapter tới
  SessionService + scheduler); `buildToolPermissionProxy(guard)` chia sẻ cùng gate + reply.
- **base_url → SSRF**: `wrapSettingsStoreWithSsrf` cho `setProviderBaseUrl` qua
  `providerPort.configureEndpoint` (SSRF + DNS-rebinding) TRƯỚC khi ghi; base_url chưa validate không
  bao giờ được ghi. base_url đã lưu KHÔNG tự nạp lại lúc boot (chỉ dùng sau khi set lại qua guard).
- **hub ← session**: `createSessionStreamHub({apply, view, redactError})`; router snapshot + live cùng
  bám hub → EV applied nuôi subscriber live và snapshot phản ánh view. Một cơ chế session duy nhất.

Routers mounted: workspace, credential, settings, provider, ev-stream (snapshot), ev-stream-live (SSE);
health token-guarded tự mount bởi service.

## 3. Review độc lập x2 (reviewer ≠ implementer)

### Security (security-reviewer) → PASS, 0 Critical/High
Truy vết 3 mục tiêu trọng số: SSRF/rebinding (không side-channel ghi base_url; boot không nạp lại),
biên permission (Deny + fail-closed + not-attached reply đều CHẶN mutation, `finalizeDeny` chạy trước
reply), một credential store (keyring fail-closed, không rò key ra response). Findings: MEDIUM (khoảng
trống test — đã bổ sung), LOW (posture scrubber bounded — đã ghi rõ invariant), LOW (deny-reply 500 —
đã sửa FIX-3).

### Architecture (code-reviewer) → 1 HIGH + 2 LOW → ĐÃ SỬA
- **HIGH-1 (ĐÃ SỬA)**: drift SSOT — `setDefaultModel`/`setProviderCredentialRef` chỉ ghi store, không
  ghi port resolver → hai endpoint báo default mâu thuẫn + mis-inject lúc Tier 2 launch. Sửa:
  `wrapSettingsStoreWithPortSync` ghi-xuyên tới port (giống pattern base_url đã đúng). Có test regression.
- LOW-1 (sửa): `tier2-seams.replay` reject promise thay vì throw đồng bộ. LOW-2 (sửa): thêm test wiring.
- PASS rõ: redactError nhất quán 3 call site; không nhân đôi singleton; thứ tự dựng đúng; Tier 2 default
  trung thực; layering mỏng; file < 250.

## 4. Fix wave sau review (6 fix)

FIX-1 (HIGH-1 SSOT write-through), FIX-2 (replay reject), FIX-3 (permission-gate explicit-deny reply
report-and-swallow như timeout path — 18 permission test pass), FIX-4 (`ProviderRequestError`/
`SettingsRequestError` extends `BadRequestError` → 400), FIX-5 (5 test composed-layer: SSOT model/
credential, timeout auto-deny, deny-với-rejecting-reply không unhandled, boot base_url non-reuse,
value-based redaction e2e), FIX-6 (doc: Tier 2 supervisor PHẢI inject qua `resolveInjection`).

## 5. Kiểm chứng

- Full suite: **415 pass / 0 fail / 0 skip** (ổn định 2 lần chạy; báo cáo agent "365" là lần discovery
  thiếu của tsx glob trên Windows, KHÔNG mất test — xác minh độc lập lại 415). `tsc -b` sạch. Source < 250.
- Composition loopback e2e 8/8 + SSOT/redaction 5/5 + permission 18/18.

## 6. Tier 2 carry-forward (seam đã mở, mặc định trung thực — CGHC-028 điền)

- Live OpenCode supervisor (buildLaunchSpec + inject credential vào env child qua `resolveInjection`);
  live `SessionStore` adapter (create/list/get/rename/replay tới child đang chạy); `RuntimeHealth` thật;
  live `ProviderConnector`. Mặc định hiện tại: `RuntimeNotAttachedError` (không bịa session/health).
- Khi mount session/permission HTTP router ở Tier 2: map `RuntimeNotAttachedError` + reply-reject thành
  typed boundary error (không để lộ raw 500).
- NIT nhỏ: settings-router base-url SSRF path còn trả 500 (raw `SsrfBlockedError`) thay vì 400; provider
  endpoint path đã 400. Bọc lại thành `SettingsRequestError` khi tiện.
