---
language: "vi"
status: "accepted"
date: "2026-07-17"
deciders: ["product-owner", "frontend-architect"]
related:
  - "0001-agent-tool-runtime-and-persistence.md"
  - "0003-local-service-transport-placement-loopback.md"
  - "0009-renderer-bundler-and-packaging-toolchain.md"
---

# ADR 0013 — Quan hệ giữa surface `Code` và `Workspace` (kiến trúc Hybrid, backend dùng chung)

## Context

Repo có hai product surface đối diện nhau trong rail: `Workspace` (file/document-centric) và
`Code` (registry label hiện tại là **"Claude Code"**). Trạng thái hôm nay (HEAD `4a229ba`):

- `Code` **reachable và render thật**, không phải placeholder, nhưng về bản chất là một lớp
  renderer mỏng chồng lên `Workspace` + phiên chat Cowork dùng chung:
  - Explorer của `Code` mount **đúng component `mountWorkspaceNavigator`** lần thứ hai, cùng
    `client` và cùng `state.activeWorkspace` (`app/ui/src/app-shell.ts:2368`).
  - "SOURCE CONTROL" **không phải git** — là danh sách `FileReviewArtifact` của hội thoại
    (`app/ui/src/ui-shell/code/code-explorer.ts:47`).
  - Editor multi-tab nhưng **chỉ đọc** (`previewWorkspaceFile`, cắt 64 KiB, hoặc diff review) —
    không có nút Lưu (`app/ui/src/ui-shell/code/code-editor.ts:135`). Nghịch lý: yếu hơn companion
    của Workspace vốn **sửa + lưu được**.
  - Panel "Claude Code" gửi vào **cùng một phiên** với Cowork:
    `onCodePanelSend → sendPrompt(promptOverride, skipAttachments)` (`app/ui/src/app-shell.ts:2701`).
- Trạng thái mâu thuẫn: registry `availability: "available"` (`app/ui/src/surface-registry.ts:107`)
  nhưng rail tooltip "Code — Đã lên kế hoạch" (`app/ui/src/ui-shell/product-rail.ts:41`), còn
  canonical docs coi Code là *planned*.
- Chip gợi ý "Chạy test / Commit thay đổi / Sửa lỗi lint" chỉ đổ text vào textarea; runtime pin
  **không có** terminal/git và theo `known-limitations` còn thiếu cả tool `delete`/`patch` — đây là
  capability không tồn tại (vi phạm luật honesty của dự án).

Audit backend (kiểm chứng trực tiếp) xác nhận **một backend duy nhất**: cả hai surface đi qua cùng
loopback HTTP service → cùng `settingsStore.activeWorkspace()` → cùng `WorkspaceGuard` → cùng
`PermissionGate` → **một** `OpencodeSupervisor` + `SessionService`. **Không** có terminal/PTY,
**không** dev-server, **không** web preview nhúng (`<webview>` bị deny vô điều kiện). Preload chỉ mở
7 kênh hẹp; **không** có generic IPC file access (ADR 0009). File I/O của renderer đi qua route
token-guarded `GET/PUT /v1/workspace/file-content`; agent mutation đi qua `FileService`
(guard + permission-gated).

Cần chốt: `Code` sẽ đi về đâu, và quan hệ với `Workspace` là gì. ADR này **chỉ chốt quyết định
kiến trúc**; không implement Code Phase 1.

## Decision

Chọn **kiến trúc Hybrid**:

```text
Workspace = file/document-centric
Code      = project/developer-centric
Backend   = dùng chung hoàn toàn (một active workspace, một guard, một permission gate,
            một OpenCode runtime/session)
```

`Code` giữ nguyên là **product surface riêng trong rail**, nhưng phải trở thành project-centric có
năng lực thật (multi-file editor sửa+lưu), **không** phải backend/agent/session riêng, và **không**
được hiển thị capability không tồn tại.

### Workspace — trách nhiệm

Giữ vai trò: `Workspace Navigator | File Preview / Quick Edit | Cowork Chat`. Phù hợp cho:

- preview tài liệu, Office, PDF, ảnh, text và code;
- chỉnh sửa nhanh **một** file (đã có edit + save + dirty/conflict);
- Agent hỗ trợ file/document; safe auto-open (≤1 file/turn); dirty-edit protection; File Work Review.

**Không** đưa vào Workspace: multi-file IDE đầy đủ, terminal, Git client, debugger, dev-server
lifecycle, project diagnostics phức tạp.

Với code file, tương lai có action **`Mở trong Code`** (chuyển sang surface Code, không nhồi IDE vào
Workspace).

### Code — trách nhiệm

Vai trò tương lai: `Project Explorer | Multi-tab Editor | Shared Agent`. Project-centric, dùng chung
active workspace và mọi security contract; editor/preview có thể split; **không** cố trở thành full
VS Code ở phase đầu.

### Shared backend boundaries (BẮT BUỘC dùng chung)

Code và Workspace **dùng chung** — không được nhân đôi:

- `settingsStore.activeWorkspace()` làm single source of truth cho active workspace;
- `WorkspaceGuard` (path-safety lexical → realpath symlink re-check → audit sink) là confinement
  surface duy nhất;
- workspace-relative file APIs qua loopback service;
- direct renderer save qua route guarded hiện có (`PUT /v1/workspace/file-content` →
  `writeWorkspaceFileContent`);
- `PermissionGate` cho mọi agent mutation;
- File Work Review + verified mutation evidence (`captureWorkspaceFileSnapshot` /
  `verify-file-evidence`);
- `SessionService` + **một** OpenCode runtime/supervisor;
- provider profile; Inspector activity; local logging/telemetry.

**Không được tạo** (ranh giới cứng): generic IPC file access; `fs` trong renderer; path resolver
riêng cho Code; `WorkspaceGuard` riêng cho Code; `PermissionGate` riêng cho Code; conversation
backend riêng cho Code; OpenCode child process riêng cho Code. Mọi file I/O của Code phải đi qua
loopback HTTP service / token-guarded client hiện có.

### Naming (product label)

Backend thực tế là shared Cowork/OpenCode runtime, nên label **"Claude Code"** không phù hợp cho
một sản phẩm white-label. **Quyết định: đổi product label thành `Code`.**

Việc đổi label **không** thực hiện trong task docs này: chuỗi "Claude Code" nằm ở nhiều chỗ
(registry, `code-view` h1/logo/segmented aria, `claude-panel` tab/aria, onboarding) và có test
assert các chuỗi đó ⇒ không phải thay đổi cực nhỏ, có test/migration risk. Vì vậy đổi label là
**item đầu tiên của Code Phase 1** (xem dưới).

### Web / App preview taxonomy

Phân biệt **ba** capability khác nhau, **không** gom thành một khái niệm "Web/App Preview" mơ hồ:

1. **File preview** — HTML/Markdown/SVG/nội dung file, render cục bộ bounded (dưới CSP nghiêm).
   *Có thể làm trong Code sau (Later), không thuộc Phase 1.*
2. **Runtime web preview** — chạy dev server, quản lý process/port, localhost navigation,
   reload/output. *Deferred thành slice riêng.*
3. **Desktop app launch** — build/launch process riêng, status/output; **không** nhúng Electron app
   production vào iframe. *Deferred.*

### Code Phase 1 (smallest user-visible slice — chốt scope, chưa implement)

- dùng chung active workspace;
- **đổi product label "Claude Code" → "Code"** (item đầu tiên);
- project explorer;
- multi-tab code editor;
- dirty state; save; close/reopen tabs;
- external-change conflict;
- `Mở trong Code` từ Workspace; `Xem trong Workspace` từ Code;
- active file làm Agent context;
- verified Agent mutation refresh;
- syntax highlighting;
- **gỡ chip/nhãn hứa terminal/git/test** cho tới khi runtime hỗ trợ.

### Deferred capabilities

terminal/PTY; Git UI; debugger; language server phức tạp; dev-server; runtime web preview;
Electron/desktop app launch; extension marketplace; backend/session/runtime riêng cho Code.

## Consequences

- (+) Chi phí kỹ thuật thấp nhất: hạ tầng chung đã có sẵn; Phase 1 chủ yếu là **promote** logic
  edit/save của companion và thống nhất state navigator, không viết backend mới.
- (+) UX rõ: Workspace = tài liệu, Code = dự án; giữ nguyên bố cục Workspace 3 cột PO đã chấp nhận;
  fast chat không đổi (panel = phiên chung sẵn có).
- (+) Trung thực: gỡ capability theater; label phản ánh đúng backend shared.
- (+) Security giữ nguyên tư thế: một guard, một permission gate, không cửa hậu file ngoài boundary.
- (−) Còn nợ kỹ thuật cho tới khi Phase 1 land: navigator đang mount hai lần (state có thể lệch);
  editor Code vẫn read-only (yếu hơn Workspace) — chấp nhận tạm cho tới Phase 1.
- (−) Trạng thái `available` của Code hiện tại **vượt** năng lực thật; docs được cập nhật để nói rõ
  đây là shared-backend renderer surface, **chưa** phải IDE (không claim WORKS).

## Alternatives considered

- **Gộp toàn bộ Code vào Workspace** — **bị loại**: biến Workspace thành IDE chật chội, trộn document
  workflow với developer tooling, tăng layout/state complexity, ảnh hưởng commercial simplicity.
- **Tạo Code backend/Agent riêng** — **bị loại**: duplicate runtime/session/permission, tăng
  security risk, dễ lệch workspace state, không phù hợp code hiện tại (chỉ có một supervisor/session).
- **Giữ Code chỉ là placeholder độc lập** — **bị loại**: không có user value thật, tạo kỳ vọng sai,
  dễ fake capability (vi phạm honesty).

## Requirements traceability

- ADR 0001 (một OpenCode supervised child + session content ownership) — Code **tái dùng**, không
  tạo runtime/session riêng.
- ADR 0003 (loopback local service) — mọi file I/O của Code đi qua loopback service token-guarded.
- ADR 0009 (renderer hardening: no generic IPC, narrow typed preload) — Code **không** được thêm
  generic IPC / `fs` renderer / path resolver riêng.
- Bối cảnh gốc: `docs/product/current-status.md` (Workspace Wave 4, Inspector Wave 5),
  `docs/quality/known-limitations.md` (runtime pin thiếu tool `delete`; không terminal/dev-server).
- ADR này là **additive (post-L4)**: định nghĩa quan hệ của một surface, **không** sửa/supersede
  ADR đóng băng 0001–0006 ⇒ Loop L4 giữ `COMPLETED`.

## Open items

- **Đổi label "Claude Code" → "Code"** (item đầu Code Phase 1): registry + `code-view` +
  `claude-panel` + onboarding + focused UI test.
- **Hợp nhất state navigator** giữa Workspace và Code để tránh lệch (mount hai lần hiện nay).
- **Promote edit/save** của companion thành editor Code multi-tab dùng chung `PUT` route.
- File preview (Later) và runtime web preview / desktop app launch (Deferred) cần slice + (nếu có
  preview) rà soát CSP riêng khi tới lượt.
