---
language: "vi"
status: "accepted"
date: "2026-07-17"
deciders: ["product-owner", "frontend-architect"]
related:
  - "0014-runtime-web-preview.md"
  - "0013-code-surface-and-workspace-relationship.md"
  - "0004-runtime-process-lifecycle-windows.md"
---

# ADR 0015 — Desktop app launch cho surface `Code` (Slice 2, tái dùng runner của Slice 1)

## Context

ADR 0013 defer ba capability; ADR 0014 (Slice 1) mở khoá **Runtime web preview**. Nay Product
Owner mở khoá phần cuối: **Desktop app launch** — build và chạy một ứng dụng desktop của workspace
như một **tiến trình/cửa sổ riêng** (không nhúng). Ràng buộc: không tạo process manager thứ hai
nếu runner Slice 1 có thể tái dùng; không terminal/PTY, Git UI, debugger, LSP; không chạy lệnh tự do
từ model/nội dung file.

## Decision

### 1. Tái dùng runner Slice 1 — **không** process manager thứ hai

`service/src/runtime-app/` là một **AppService** anh em của `PreviewService`, dùng lại nguyên các
**primitive** của runner Slice 1 (một bản cài đặt duy nhất):

- `nodePreviewSpawner` (spawn bằng **mảng đối số**, stdio pipe, `windowsHide`) + `terminateChildTree`
  (**tree-kill không mồ côi** — logic này được **tách dùng chung** ở Slice 2 acceptance sau khi
  Slice 1 phát hiện lỗi mồ côi; xem ADR 0014);
- `launch-policy` — lệnh chỉ là `<pm> run <script>` (`cmd.exe /d /s /c`, mảng đối số), `pm` ∈
  {npm,pnpm,yarn} + `script` **allowlist + validate**; env **curated allowlist** (không kế thừa
  provider/vault/MS365 secret);
- `output-buffer` — output **redact + giới hạn kích thước** (ring);
- một `PermissionGate` kiểu preview (instance riêng, **audit dùng chung**): mỗi Build/Run chạy
  **chỉ trong `proceed` sau Allow**; Deny/timeout không spawn.

Khác biệt duy nhất là **vòng đời**: một bước `build` tuỳ chọn, rồi `run` mở app ở tiến trình riêng.
`AppService` là owner duy nhất của một app đang chạy; dọn dẹp khi **đổi workspace** và **tắt service**
(cùng chỗ với preview trong compose-service/compose-live).

### 2. App chạy ở **tiến trình/cửa sổ riêng** — không nhúng

App desktop **không** nhúng vào iframe/WebContentsView (khác hẳn web preview). Pane "Ứng dụng" chỉ
hiển thị **trạng thái + Output** (drawer dùng chung với web preview); cửa sổ app do OS quản. Trạng
thái `running` là **sự thật quan sát được**: tiến trình đã spawn còn sống qua một cửa sổ readiness
ngắn (không có port để dò, không có gì để nhúng). Nếu tiến trình thoát trước readiness: mã 0 →
`stopped`, mã ≠ 0 → `failed`. Không bao giờ giả `running`.

### 3. Phạm vi phát hiện (honest): chỉ **Electron**

`app-detector` chỉ nhận **Electron** (có dependency `electron` **và** một script chạy được:
start/app/electron/dev/serve) là app desktop chạy được an toàn; mọi thứ khác là `unsupported` (kèm
lý do). Node desktop trần / executable đóng gói **không** được tự đoán — đoán sẽ hoặc overclaim, hoặc
mời chạy một executable tuỳ ý. Build script (build/dist/package/compile/make) là bước tuỳ chọn.

### 4. Không mở "thư mục đầu ra"

Chưa có safe shell contract để mở thư mục output ⇒ **bỏ** action đó (đúng yêu cầu: chỉ thêm nếu đã
có contract an toàn).

## Consequences

- (+) Chạy app desktop thật, tái dùng toàn bộ đảm bảo bảo mật của Slice 1 (permission, cwd confined,
  env curated, output redact/bounded, **tree-kill không mồ côi**, chỉ giết PID mình spawn).
- (+) Web preview và Desktop app là **hai capability tách biệt** với selector **Web / Ứng dụng**;
  chỉ hiện mode thực sự supported (project không phải Electron → trạng thái unsupported rõ ràng).
- (−) `running` là heuristic "tiến trình còn sống qua readiness" — không introspect được cửa sổ app;
  một app tự thoát ngay (mã 0) sẽ hiện `stopped`, không phải `running` (trung thực).
- (−) Chỉ Electron; các loại app khác chưa hỗ trợ.

## Alternatives considered

- **Gộp desktop vào `PreviewService` bằng typed kind** — cân nhắc nhưng vòng đời khác hẳn (build,
  không port/embed) sẽ làm state machine phình và khó đọc; thay vào đó tách **AppService** mỏng dùng
  chung **primitive** (đúng tinh thần "không process manager thứ hai" ở mức cài đặt).
- **Nhúng app desktop vào cửa sổ Cowork** — bị loại: không nhúng một app Electron con vào iframe/
  WebContentsView; app chạy ở cửa sổ riêng.
- **Cho người dùng nhập shell string tự do** — bị loại: chỉ `pm run <script>` đã allowlist + Allow.
