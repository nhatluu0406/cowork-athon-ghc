---
language: "vi"
status: "active"
updated_at: "2026-07-12"
---

# System overview hiện tại

Cowork GHC là desktop app local-first cho Windows. Kiến trúc runtime hiện tại:

```text
Electron renderer
→ preload/shell bridge
→ local service
→ OpenCode runtime
→ replaceable LLM endpoint
```

## Thành phần

- `Electron renderer`: UI cho onboarding, workspace, provider/model, session timeline, prompt và permission.
- `preload/shell bridge`: cầu nối hẹp, không expose Node hoặc IPC tùy ý cho renderer.
- `local service`: boundary ứng dụng chạy trên loopback, token-guarded, giữ business logic và router.
- `OpenCode runtime`: child process được shell/service giám sát để chạy phiên agent.
- `replaceable LLM endpoint`: provider-neutral, hiện DeepSeek được verify qua OpenAI-compatible mode.

## Boundary workspace

Workspace được chọn qua native picker, validate ở service, rồi lưu làm active workspace. File action phải đi qua
workspace guard và permission boundary. UI không tự mutate filesystem.

## Boundary credential

Credential source of truth là Windows keyring. UI chỉ làm việc với handle/trạng thái đã redact, không giữ key
plaintext. Khi runtime cần key, key được inject vào child process qua env tại launch boundary.

## Boundary provider/model

Provider/model là cấu hình thay thế được. DeepSeek là endpoint đầu tiên đã verify, không phải ràng buộc domain.
Custom base URL đi qua policy kiểm soát SSRF ở service.

## Boundary process lifecycle

Electron shell là owner của local service và runtime child. Shutdown chỉ dừng process do Cowork GHC sở hữu, không
kill generic `node.exe` hoặc process ngoài quyền sở hữu. State runtime tạm thời nằm dưới `.runtime/` hoặc profile
ứng dụng, không phải source of truth cho sản phẩm.

## Boundary conversation / runtime turn

Cowork GHC tách **conversation identity** (persisted, user-facing) khỏi **OpenCode runtime session** (ephemeral, một lượt):

```text
Cowork conversation A
├── runtime turn A1 (OpenCode session s1) → terminal
├── runtime turn A2 (OpenCode session s2) → terminal
└── ...
```

- UI và `conversation` store giữ transcript sạch (chỉ user/assistant đã sanitize), activity, workspace binding.
- Trước mỗi user message, `planRuntimeTurn` quyết định reuse (`canPrompt`) hoặc tạo session mới.
- **Context handoff (untrusted):** OpenCode v1.17.11 chỉ nhận `POST /session/{id}/message` với `parts: [{type:"text"}]` — không có native multi-message seed. Cowork GHC gửi envelope nội bộ bounded (`<<<CGHC_UNTRUSTED_PRIOR_TURNS>>>` + `<<<CGHC_UNTRUSTED_ATTACHMENT_CONTEXT>>>` + `<<<CGHC_CURRENT_USER_REQUEST>>>`) chỉ trên wire; **không** persist trong transcript user.
- **Assistant extraction:** EV mapper theo dõi `message.updated` role; chỉ `message.part.*` text của **assistant** được map sang `SessionView.text`. User prompt (kể cả envelope) không bao giờ hiển thị như assistant output.
- Event stream lọc theo `runtimeSessionId` hiện hành để tránh late events từ turn cũ.

Giới hạn POC: **một runtime execution active** tại một thời điểm.

## Boundary attachment read (Phase 1)

- Renderer gọi shell `pickWorkspaceFile(workspaceRoot)` → service `POST /v1/workspace/attachment-read` validate absolute path trong grant + `assertRealPathInside`.
- **Secret-like policy** (`attachment-secret-policy.ts`): kiểm tra filename/path trước `stat`/`readFile`; file bị block không đọc raw content, không dispatch, không persist content.
- Snapshot tại thời điểm gửi: relative path, size, mtime, content hash, truncated flag, `inclusionStatus` / `inclusionReason` — **không** copy content vào app data.
- **Dispatch preflight** (`dispatch-plan.ts`): tính budget cuối 12k ký tự từ prior context + attachment envelopes + user request; fail-fast nếu attachment selected không fit; không tạo runtime turn khi preflight fail.
- Pending chips trong composer; metadata gắn `ConversationMessage.attachments`; content chỉ trên wire trong envelope untrusted.

## Không lặp lại tài liệu cũ

Các ADR và báo cáo trong `.loop-engineer/` vẫn là provenance. Khi cần làm việc hằng ngày, đọc tài liệu ngắn trong
`docs/product/`, `docs/quality/`, và file này trước.
