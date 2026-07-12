---
task: CGHC-025
title: "Cold-start + renderer hardening — CSP-real-header, envelope de-drift, Electron isolation, progressive readiness (S6/R6)"
language: "vi"
status: DONE
created_at: "2026-07-11"
---

# CGHC-025 — Bằng chứng cold-start + renderer hardening

## 1. GATE 1 — CSP là response header thật (không chỉ meta tag)

Renderer KHÔNG còn load từ `file://`. `registerAppScheme` đăng ký `app://cowork` là origin
secure/standard/isolated (trước `ready`); `createAppProtocolHandler` phục vụ `app/ui/dist` và gắn
`content-security-policy: RENDERER_CSP` + `x-content-type-options: nosniff` cho MỌI `Response`
(200/asset/403/404 — không đường nào bỏ qua). Path-traversal chặn bằng single-decode + `normalize(join)`
+ kiểm tra `target === root || startsWith(root+sep)` (đã thử `%2e%2e`, double-encode, `%5c`, drive-abs,
UNC, sibling-prefix `dist-evil`, NUL — không cái nào tới `readFile`).

CSP: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self';
connect-src 'self' + loopback http/ws (127.0.0.1/localhost/[::1], KHÔNG `*`); object-src 'none';
base-uri 'none'; frame-src 'none'; frame-ancestors 'none'; form-action 'none'` — không
`unsafe-inline`/`unsafe-eval`.

## 2. GATE 2 — nâng envelope vào contracts (bỏ bản drift ở renderer)

`core/contracts/src/boundary-envelope.ts` là nguồn chân lý duy nhất cho `BOUNDARY_PROTOCOL_VERSION`
(`cghc.boundary.v1`), `SuccessEnvelope`/`ErrorEnvelope`/`ResponseEnvelope`, `HealthData`, `SERVICE_NAME`,
`BoundaryErrorCode`. `service/src/boundary/contract.ts` re-export (tên ổn định); `app/ui/service-client.ts`
xoá bản drift (đã nới `status:string`) + import từ contracts + TÁI LẬP kiểm tra protocol: response có
`protocol !== BOUNDARY_PROTOCOL_VERSION` → ném `ServiceClientError("protocol_mismatch")` (không âm thầm
tin envelope drift). Kiểm tra này áp cả ở `ev-stream-client.loadSnapshot` (không nhận snapshot drift).

## 3. GATE 3 — Electron renderer hardening + test baseline (app/shell trước đây 0 test)

- webPreferences thật: `sandbox:true`, `contextIsolation:true`, `nodeIntegration:false`
  (+InWorker/InSubFrames false), `webSecurity:true`, `allowRunningInsecureContent:false`,
  `experimentalFeatures:false` — `create-window.ts` tiêu thụ builder này.
- Preload bridge: chỉ `CoworkShellBridge` (getBootstrap + pickWorkspaceFolder) qua `contextBridge`;
  KHÔNG lộ `ipcRenderer`/`invoke`/`send` passthrough; không `require`/node reachable.
- Navigation lockdown: 4 chặn (`will-navigate`/`will-redirect` off-origin, `setWindowOpenHandler` deny,
  `will-attach-webview` prevent) trên window chính + mọi `web-contents-created`; `isSameOrigin` chỉ true khi
  scheme `app:` + host `cowork` (chống `app://evil`, `app://cowork.evil.com`, scheme confusion).
- 23 test baseline app/shell (CSP header trên mọi Response, 4 nav denial, webPrefs, bridge key set, no-ipc).

## 4. Progressive readiness + crash/recovery (renderer surface, honest)

`readiness-controller.ts` + `readiness-view.ts`: state machine `starting → connecting → ready` CHỈ khi
`health()` thành công thật; `unreachable` (fail/timeout/protocol_mismatch) và `not_connected` (thiếu
handshake) → thông báo trung thực + Retry + View diagnostics (scrub qua `sanitizeErrorMessage`). Poll health
với backoff có chặn (seam inject; dừng khi ready/teardown). KHÔNG bao giờ hiện ready khi chưa có health thật;
token/base-url không vào DOM. Slot runtime gắn nhãn "giám sát tiến trình ở CGHC-028" (không bịa runtime-up).

## 5. Folded carry-forwards (từ review CGHC-015/017)

- EV5 progress render: `SessionView.progress?:{label,ratio?}`; reducer fold (progress mới ghi đè; terminal
  XOÁ progress khỏi view); timeline render `role=progressbar` determinate (aria-valuenow) / indeterminate.
- MEDIUM-5: append-delta text (append suffix vào một Text node, fallback full-set khi snapshot replace) +
  coalescer rAF-aligned (bỏ O(N^2) re-serialize). No-thrash giữ nguyên.
- Permission poll gating: dừng poll khi `visibilityState==='hidden'`, resume+refresh khi visible; +
  `aria-describedby` trỏ mô tả action.
- Split `service-client.ts` (281→243) + `permission-client.ts` (public surface không đổi).

## 6. Review độc lập (security-reviewer ≠ implementer) → PASS, 0 Critical/High

Không phá được 4 mục trọng số: CSP-real-header mọi response, path-traversal (nhiều biến thể), renderer
isolation (no ipcRenderer/require), no-secret-in-DOM (adversarial token test). Findings đã sửa:
- **MEDIUM (ĐÃ SỬA)**: kiểm tra protocol GATE 2 chỉ đúng-bởi-construction → thêm `service-client.test.ts`
  (wrong protocol → `protocol_mismatch`; correct → data; `ok:false` → boundary code, khoá thứ tự check).
- **LOW (ĐÃ SỬA)**: `ev-stream-client.loadSnapshot` bỏ qua protocol → thêm guard (reject drift honest,
  không bịa state). **LOW (ĐÃ SỬA)**: hai đường lỗi (permission decide catch, stream settle) dùng raw
  `error.message` dù comment nói scrub → route qua `sanitizeErrorMessage`.

## 7. Kiểm chứng

- Full suite: **500 pass / 0 fail / 0 skip** (ổn định 2 lần). `tsc -b` sạch. Source < 250. app/ui tests 64,
  app/shell tests 23.

## 8. Carry-forward → CGHC-028 (live Electron / packaging)

- LIVE multi-process supervisor: spawn service + OpenCode child thật, phát hiện crash + restart thật (đây
  build renderer surface honest, KHÔNG build process supervisor).
- Live-Electron E2E: `createMainWindow` truyền webPrefs vào `BrowserWindow` thật; `app://` handler làm loader;
  CSP header trên document renderer sống; sandbox chặn `require` runtime.
- Symlink hardening: realpath re-check trong protocol handler + guard "no symlinks in ui/dist" khi đóng gói.
- Preload bundling: sandboxed preload phải ship như một file bundle (preload + bridge + contracts).
