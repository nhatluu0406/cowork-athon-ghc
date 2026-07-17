---
title: "Architecture Decision Records — Cowork GHC"
document_type: "architecture-decision-index"
language: "vi"
status: "accepted"
---

# Architecture Decision Records — Cowork GHC

Mỗi ADR ghi lại một quyết định. Tất cả ADR bên dưới đều ở **Status: Accepted — FROZEN in Loop L4**
(Architecture Review, 2026-07-11). Chúng được soạn ở Loop L3 (Architecture Candidates) và được
phê duyệt sau một đợt critique năm góc nhìn (runtime, frontend, test, security, UX), một threat
model, và một đợt reference-verification; các chỉnh sửa từ review được gộp vào trước khi freeze.
Thay đổi một quyết định đã đóng băng lúc này đòi hỏi một ADR mới/thay thế (superseding), không phải
sửa tại chỗ.

Format: Status, Context, Decision, Consequences, Alternatives considered, Requirements
traceability, Open items. Mỗi quyết định đều trích dẫn evidence từ L2 discovery.

## Index

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-agent-tool-runtime-and-persistence.md) | Reuse OpenCode as a pinned, single-owner supervised child; OpenCode owns session content, Cowork GHC owns only settings + light metadata; `/ee` Fair Source boundary; pin + upgrade-test policy | Accepted (Frozen L4) |
| [0002](0002-desktop-shell.md) | Electron as the desktop shell (closest call; Tauri recorded with an explicit revisit condition) | Accepted (Frozen L4) |
| [0003](0003-local-service-transport-placement-loopback.md) | HTTP + SSE transport; **standalone** loopback local service process; P7 loopback-only bind + acceptance test | Accepted (Frozen L4) |
| [0004](0004-windows-process-lifecycle-and-supervision.md) | One-owner supervision chain; `.runtime/pids/*.json` schema; identity-verified stale-PID handling; graceful loopback shutdown then `taskkill /T` / Job Object; no admin | Accepted (Frozen L4) |
| [0005](0005-provider-abstraction.md) | Thin provider-neutral `ProviderPort` management port over the runtime; PR7 taxonomy at the boundary; five targets (5th = user-defined OpenAI-compatible); D4 gateway seam only | Accepted (Frozen L4) |
| [0006](0006-credential-store.md) | `@napi-rs/keyring` (Windows Credential Manager) single OS-backed store; inject-at-launch, never `c.auth.set` (SEC-1); scrubber covers provider keys (SEC-2) | Accepted (Frozen L4) |
| [0007](0007-web-application-deferral.md) | Next.js / web application = **DEFERRED** (desktop is the release target); activates only after desktop POC hits L9 PASS or on product-owner request | Accepted (post-L4, additive) |
| [0008](0008-build-and-workspace-toolchain.md) | Build & workspace toolchain: **npm workspaces + TypeScript strict + `node:test`/`tsx`**; Electron/`electron-builder` scoped to UI/packaging tasks only; service stays standalone Node | Accepted (L6, additive) |
| [0009](0009-renderer-bundler-and-packaging-toolchain.md) | Renderer bundler = **Vite**; main/preload = `tsc`; packager = **electron-builder** (NSIS skeleton); **renderer-hardening baseline** (sandbox/contextIsolation/CSP header/navigation lockdown/narrow typed preload, no generic IPC) | Accepted (L6, additive) |
| [0010](0010-remote-gateway-and-pwa-surface.md) | Remote gateway listener riêng (reverse proxy allowlist) + PWA thin control client, **OFF mặc định** sau `CGHC_REMOTE_ENABLED`; main service giữ loopback-only (0003 không đổi), web app đầy đủ vẫn DEFERRED (0007 không đổi); device token qua pairing code, gate permission duy nhất vẫn ở service | Accepted (post-L4, additive) |
| [0012](0012-dev-loopback-http-override.md) | **Dev-only opt-in override** `COWORK_GHC_DEV_ALLOW_LOOPBACK_HTTP` để dùng loopback `http` LLM endpoint (private-gpt/Ollama local); **OFF mặc định**, byte-for-byte khi tắt; chỉ bật knob `loopbackEscape` sẵn có (http chỉ khi mọi địa chỉ resolve là loopback — private/link-local/cloud-metadata vẫn chặn); env-only (router bỏ qua field body); KHÔNG qua release hard-assert (tránh app từ chối khởi động); security review PASS không HIGH | Accepted (post-L4, additive to 0005) |
| [0011](0011-dispatch-fanout-activation.md) | **D1 Dispatch / fan-out activated** từ "seam shape only" thành fan-out execution thật in-process; supersede **chỉ dòng D1** của implementation-design §7/§10 (D3/D4 vẫn boundary-only, ADR 0001–0006 không đổi); `BranchRunner` là tên canonical thay nhãn `DispatchPort`; guardrails: concurrency 3/cap 5 ở service, preset narrowing-only, MỘT permission gate, `retry_until_verified` cần evidence trên đĩa, draft phải confirm | Accepted (superseding D1 scope) |

> ADR 0007–0010 là các **quyết định bổ sung (additive) sau L4** — chúng thêm quyết định mới (web
> deferral; L6 build toolchain; renderer bundler/packaging + hardening baseline; remote gateway + PWA)
> và không sửa đổi bất kỳ ADR đã đóng băng nào trong 0001–0006, nên Loop L4 vẫn giữ trạng thái
> `COMPLETED`.
>
> **ADR 0011 là ADR superseding đầu tiên**: nó thay đổi phạm vi **chỉ dòng D1** của
> `cowork-ghc-implementation-design.md` §7/§10 (từ boundary-only sang fan-out execution thật) theo
> đúng quy tắc "thay đổi quyết định đã đóng băng cần một ADR superseding" ở trên. Nó **không** sửa
> ADR 0001–0006, nên L4 vẫn `COMPLETED`.
>
> **ADR 0012 là additive** (bổ sung sau L4): một override dev-only, OFF mặc định, cho knob
> `loopbackEscape` sẵn có của SSRF policy — **không** đổi enforcement production của ADR 0005 (mặc
> định vẫn https-only), nên không phải superseding.
>
> Các ADR mới từ 0007 trở đi dùng body tiếng Việt theo documentation-language policy (identifier giữ
> tiếng Anh).

## Decision coupling (từ discovery-report §2)

- 0001 (runtime) và 0002 (shell) phần lớn là hai gốc quyết định độc lập nhau (orthogonal).
- 0005 (provider shape) phụ thuộc 0001 (runtime sở hữu các wire call → port mỏng).
- 0006 (credential store) được viết theo hướng shell-neutral, nên nó phụ thuộc 0001 (injection
  seam) nhưng không phụ thuộc 0002.
- 0003 (placement) và 0004 (lifecycle) suy ra từ 0001 + 0002.

Xem [`../cowork-ghc-implementation-design.md`](../cowork-ghc-implementation-design.md) để có bản
thiết kế mạch lạc gắn kết các ADR này với nhau.
