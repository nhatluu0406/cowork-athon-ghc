---
language: "vi"
status: "accepted"
date: "2026-07-17"
deciders: ["product-owner", "frontend-architect"]
related:
  - "0013-code-surface-and-workspace-relationship.md"
  - "0003-local-service-transport-placement-loopback.md"
  - "0009-renderer-bundler-and-packaging-toolchain.md"
  - "0004-runtime-process-lifecycle-windows.md"
---

# ADR 0014 — Runtime web preview cho surface `Code` (bounded process runner + WebContentsView)

## Context

ADR 0013 phân biệt ba capability và **defer** hai trong số đó: **Runtime web preview** (dev-server/
port/localhost) và **Desktop app launch** (process riêng). Nay Product Owner mở khoá phần
**Runtime web preview** thành một slice có thật ("Code Slice 1"): xem trước tại chỗ (1) dự án
**HTML/CSS/JS tĩnh** và (2) dự án frontend có **dev server** trong `package.json`.

Ràng buộc cứng từ hạ tầng hiện tại (đã kiểm chứng, xem ADR 0009/0013):

- Renderer hardened: `contextIsolation`/`sandbox`/`nodeIntegration:false`; `<webview>` **bị deny
  vô điều kiện**; popup/off-origin navigation bị chặn; CSP `frame-src` chỉ `blob:` (một `<iframe
  src="http://localhost:…">` bị CSP từ chối); **không generic IPC / không `fs` trong renderer**.
- Mọi child-process thuộc sở hữu của **service package**; shell chỉ giữ handle qua `ServiceController`.
- Windows: dừng tiến trình an toàn = `taskkill /PID <pid> /T /F` (cả cây), không bao giờ `/IM`.

## Decision

### 1. Nhúng preview = **WebContentsView** do shell sở hữu (không iframe, không webview)

Preview localhost được nhúng bằng một **`WebContentsView` hardened gắn vào cửa sổ chính**, nổi trên
"Preview pane" của renderer. Lý do chọn thay vì iframe/webview:

- **Giữ nguyên CSP/sandbox của renderer**: WebContentsView là một WebContents riêng, ngoài phạm vi
  CSP renderer ⇒ không phải nới `frame-src` sang `http://localhost:*` (iframe sẽ buộc phải nới).
- **Cô lập process/session**: nội dung dev-server là **không tin cậy**; nó chạy ở process riêng,
  session **in-memory** riêng, **không preload** (không cầu nối vào app), có navigation policy riêng.
- `<webview>` vẫn bị deny toàn cục (không đảo ngược).

Hardening của view: chỉ nạp URL **loopback http(s)**; `will-navigate`/`will-redirect` **chỉ cho
loopback**; `setWindowOpenHandler` deny; `will-attach-webview` deny; `will-download` deny;
`setPermissionRequestHandler`/`setPermissionCheckHandler` từ chối mọi quyền. IPC cho preview là
**kênh typed hẹp** (`previewLoad/SetBounds/Hide/Reload/Close`) — **không** generic IPC; renderer
đo hình học pane và đồng bộ vị trí, và **ẩn view** khi có Settings/permission dialog hoặc rời chế độ
Preview.

### 2. Bounded process runner nằm trong **service** (owner duy nhất của lifecycle)

`service/src/runtime-preview/`:

- **Static preview**: một máy chủ tĩnh loopback bounded, GET/HEAD, chặn traversal/symlink bằng
  `realPathInsideRoot` — **không chạy lệnh** ⇒ **không cần permission**.
- **Dev-server preview**: spawn `cmd.exe /d /s /c <pm> run <script>` bằng **mảng đối số** (không nối
  chuỗi shell); `pm` ∈ {npm,pnpm,yarn} và `script` được **allowlist + validate** theo pattern chặt
  (không bao giờ là chuỗi tự do từ model/file). `cwd` bị **WorkspaceGuard** giới hạn (lexical +
  realpath). `env` là **allowlist curated** (không kế thừa provider/vault/MS365 secret; thêm
  `BROWSER=none`/`PORT`/`HOST`). Đầu ra được **redact** (secret scrubber + pattern) và **giới hạn
  kích thước** (ring buffer). Phát hiện URL localhost từ output; timeout khởi động; dừng
  graceful-then-**tree-force** (`taskkill /T /F`); dọn dẹp khi **đổi workspace** và **tắt service**.
  Vì tiến trình là con của service, reaper `taskkill /T` sẵn có cũng thu dọn khi service bị hạ.
- **Permission**: mỗi lần chạy lệnh dev-server đi qua một **PermissionGate riêng cho preview** (reply/
  session sink là no-op vì không có OpenCode runtime đợi trả lời; **dùng chung audit sink**). Lệnh chỉ
  chạy **bên trong `gate.proceed` sau khi có Allow**; Deny/timeout không bao giờ spawn.

### 3. Desktop app launch — **vẫn defer** (Slice 2)

Slice này **không** build/launch app desktop (process riêng, không nhúng Electron con vào iframe).
Đó là slice tiếp theo, dùng lại cùng runner + permission + tree-kill.

## Consequences

- (+) Xem trước web thật sự, tại chỗ, **giữ nguyên tư thế bảo mật** renderer (CSP/sandbox/no-generic-IPC).
- (+) Một owner lifecycle (service), tree-kill Windows, không orphan; đầu ra đã redact + bounded.
- (+) Trung thực: static ≠ "preview dev-server"; dự án không hợp lệ hiện trạng `unsupported` rõ ràng.
- (−) WebContentsView **nổi trên DOM**: phải chủ động ẩn khi có modal/permission/Settings hoặc đổi
  chế độ; không tự clip theo bo góc/scroll như iframe (đánh đổi có chủ đích để giữ CSP).
- (−) Phát hiện port là **heuristic** (đọc URL localhost từ output, hoặc dò `PORT`); framework in
  URL khác thường có thể không được phát hiện → trạng thái `failed` trung thực, không giả "running".
- (−) Không HMR/websocket guarantee, không proxy remote, không CDN/cloud preview.

## Alternatives considered

- **iframe + nới CSP `frame-src http://localhost:*`** — bị loại: vi phạm ràng buộc "giữ CSP hiện
  tại", chạy nội dung không tin cậy trong process renderer (chỉ cô lập theo origin), phải tự thêm
  chặn top-navigation/download.
- **`<webview>`** — bị loại: deny toàn cục theo hardening (ADR 0009), không đảo ngược cho một feature.
- **Cửa sổ preview riêng (BrowserWindow con)** — cân nhắc: cô lập tốt, không vướng hình học, nhưng
  không khớp bố cục split Explorer|Editor/Preview|Agent mà PO muốn; để ngỏ như phương án dự phòng.
- **Chạy lệnh tự do người dùng nhập** — bị loại: chỉ chấp nhận `pm run <script>` đã allowlist +
  được người dùng phê duyệt; không bao giờ chạy lệnh từ nội dung model/file.
