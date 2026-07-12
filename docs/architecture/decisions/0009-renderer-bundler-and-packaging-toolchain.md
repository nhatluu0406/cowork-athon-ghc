---
title: "Renderer bundler + packaging toolchain (Vite + electron-builder) và renderer-hardening baseline"
document_type: "architecture-decision-record"
language: "vi"
status: "accepted"
---

# ADR 0009 — Renderer bundler, packaging toolchain & renderer-hardening baseline

- Status: **Accepted** — ghi nhận ngày 2026-07-11 khi dựng scaffold Electron shell trong Loop L6.
  ADR này **bổ sung (additive)**: nó chọn công cụ build renderer + đóng gói và chốt baseline
  hardening cho renderer. Nó **không** mở lại quyết định shell (ADR 0002 Electron vẫn đứng vững) và
  **không** thay đổi bất kỳ ADR đã freeze nào của L4 → Loop L4 giữ nguyên `COMPLETED`.
- Liên quan: ADR 0002 (shell = Electron), ADR 0003 (standalone loopback service), ADR 0006
  (`@napi-rs/keyring`), ADR 0008 (npm workspaces + TS strict). Bổ sung cho ADR 0008 §5 vốn đã hoãn
  việc chọn bundler/packager cho tới task UI/đóng gói.

## Context

L6 cần một scaffold shell + renderer **build được, an toàn, có seam đúng** để mở khoá các task UI
(CGHC-008 workspace picker, CGHC-015 EV timeline, CGHC-017 permission UI, CGHC-022 settings,
CGHC-025 cold-start/renderer-hardening). Đây **không** phải bản đóng gói đầy đủ (đó là CGHC-028). ADR
0008 §5 đã cố ý hoãn việc chọn bundler renderer và packager. Component map tách `app/shell` (Electron
main + preload, Node) khỏi `app/ui` (renderer, môi trường trình duyệt), nên hai bên cần format build
khác nhau: main/preload là ESM Node do `tsc` biên dịch; renderer là bundle trình duyệt.

## Decision

1. **Renderer bundler = Vite.** `app/ui` build bằng Vite (`vite build`) với `base: "./"` để asset
   dùng đường dẫn tương đối, nạp được từ `file://` trong Electron. Vite/esbuild tự transpile workspace
   dep TypeScript (`@cowork-ghc/contracts`). Vite chỉ dùng cho renderer — không kéo vào tầng
   service/runtime/core (vẫn `node:test`/`tsx` theo ADR 0008).
2. **Main + preload = `tsc` (ESM NodeNext).** `app/shell` biên dịch bằng `tsc -b` như mọi workspace
   Node khác, ra `app/shell/dist`. **Preload sandbox** phải được giao dưới dạng một file bundle đơn;
   bước bundle preload thuộc packaging (CGHC-028). `tsc` ở scaffold chỉ typecheck + emit.
3. **Packager = electron-builder (Windows/NSIS), skeleton.** Thêm `electron` + `electron-builder`
   làm devDependency và một `electron-builder.yml` **skeleton** (target `nsis`, per-user no-admin theo
   ADR 0004). **Không** chạy build đóng gói đầy đủ ở đây. Carry-forward CGHC-009: native binding
   `@napi-rs/keyring` phải nằm trong `asarUnpack` để OS loader `dlopen` được lúc runtime.
4. **Renderer-hardening baseline (bắt buộc, đặt trong shell).** Mọi cờ được set tường minh:
   - `BrowserWindow.webPreferences`: `sandbox: true`, `contextIsolation: true`,
     `nodeIntegration: false`, `webSecurity: true`, `allowRunningInsecureContent: false`,
     `experimentalFeatures: false` — tại `app/shell/src/create-window.ts`.
   - **CSP hạn chế** set bằng **response header thật** trên `session.defaultSession`
     (`app/shell/src/security/csp.ts`); meta tag trong `index.html` chỉ là defense-in-depth.
     `connect-src` giới hạn ở loopback (`127.0.0.1`/`localhost`/`[::1]` mọi port) vì service bind
     cổng loopback ephemeral chọn lúc launch (ADR 0003). Không `unsafe-inline`, không `eval`.
   - **Navigation lockdown** (`app/shell/src/security/navigation.ts`): chặn `will-navigate`/
     `will-redirect`, `setWindowOpenHandler` deny, chặn `will-attach-webview`; áp cho cả window
     chính lẫn mọi `web-contents-created`.
5. **Không generic IPC passthrough.** Preload chỉ expose một API **hẹp, có kiểu** qua `contextBridge`
   ({@link CoworkShellBridge} trong `@cowork-ghc/contracts`): `getBootstrap()` (trao base URL + token
   per-launch cho renderer trong bộ nhớ) và `pickWorkspaceFolder()` (native picker, W1). Mỗi method
   map đúng một channel allow-list trong `app/shell/src/ipc/channels.ts`; **không** có
   `invoke(channel, …)` chung. Mở rộng = thêm method có kiểu + channel + method trên bridge contract.
6. **Renderer là client của loopback service.** `app/ui` gọi service qua một client fetch có kiểu,
   nhỏ, không phụ thuộc (`app/ui/src/service-client.ts`), phản chiếu envelope + Bearer token của
   `service/src/boundary/{client,contract}.ts`. Nó **không** import `@cowork-ghc/service` (Node) nên
   bundle trình duyệt không kéo code Node vào. Import-direction (CGHC-003): `app/ui` chỉ import
   `@cowork-ghc/contracts`, **không bao giờ** `app/shell`/`electron`.

## Consequences

- Positive: renderer build được ngay (Vite, ~110ms), `tsc -b` sạch toàn workspace, test lõi giữ
  nguyên PASS; seam đúng để CGHC-008/015/017/022/025 gắn UI thật; hardening tập trung, dễ review.
- Negative / carry-forward: bundle preload sandbox + build đóng gói đầy đủ (installer, smoke test)
  chưa làm — thuộc CGHC-028. Token per-launch chỉ nằm trong bộ nhớ renderer; không được ghi ra
  `localStorage`/DOM/log (đã tuân thủ trong scaffold).
- Reversibility: nếu sau này cần đổi bundler/packager, chỉ cần một ADR kế nhiệm ở task đóng gói;
  quyết định này không khoá tầng lõi và không đụng ADR 0001–0006.

## Alternatives considered

- **electron-vite (gộp main+preload+renderer một tool).** Gọn cho cả ba đầu ra nhưng thêm một
  abstraction/tool mới; bị hoãn để giữ main/preload đồng nhất với `tsc` như các workspace Node khác.
  Có thể xem lại ở CGHC-028 nếu bundling preload cần một pipeline thống nhất.
- **Webpack / esbuild trần cho renderer.** Nhiều cấu hình hơn Vite mà không thêm giá trị cho một
  renderer POC; Vite cho HMR + zero-config.
- **`nodeIntegration: true` + IPC rộng.** Bị bác thẳng: vi phạm architecture/security invariant
  (không business logic/fs/credential trong renderer; deny phải chặn thật ở execution boundary).

## Requirements traceability

| Requirement | How this ADR satisfies it |
|---|---|
| W1 | Native folder picker qua `pickWorkspaceFolder()` (preload → `dialog.showOpenDialog`). |
| P7 | Renderer chỉ tới service qua loopback; `connect-src` CSP giới hạn loopback; shell không nới lỏng bind. |
| SD2/S6 | Renderer render trạng thái kết nối thật từ `/v1/health`; không giả "completed". |
| CGHC-003 | Import-direction: `app/ui` chỉ import `@cowork-ghc/contracts`, không `app/shell`/`electron`. |
| CGHC-009 | `asarUnpack` cho `@napi-rs/keyring` ghi trong `electron-builder.yml` skeleton. |

## Open items

- Bundle preload sandbox thành file đơn (CGHC-028 / hoặc CGHC-025 nếu cần sớm).
- Chạy build đóng gói đầy đủ + smoke test trên packaged build (CGHC-028) — dev build không phải
  bằng chứng release cuối cùng.
- Cân nhắc mở external link qua `shell.openExternal` có allow-list (hiện tại deny toàn bộ navigation).

## Trạng thái thay thế

Chưa có. Thay thế cần một ADR kế nhiệm (superseding), theo quy tắc freeze của L4.
