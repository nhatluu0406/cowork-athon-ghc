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

**Readiness model** (`provider-readiness.ts` UI + `assessProviderReadiness` service): phân tách local service,
workspace, provider configuration, credential presence, local URL validity, connectivity test result, và runtime phase.
`assessSendPreflight` / `assertCreatePrerequisites` chặn tạo runtime turn khi thiếu prerequisite; không thay thế
connectivity probe cho API key/model invalid sau request.

## Boundary UI shell / product surfaces

Renderer hiện dùng hướng hybrid `1a Airy + 1b rail`: 56px product rail → contextual
sidebar → main chat workspace → right information panel.
Shell này là client của dữ liệu thật từ bridge/service; nó không tạo plan, file event, provider status hoặc
integration data giả để làm đẹp layout.

Top-level product surfaces được khai báo tập trung trong `app/ui/src/surface-registry.ts`:

```text
cowork
dispatch
gateway
knowledge
knowledge-graph
microsoft
code
```

Mỗi surface có `id`, `label`, `icon`, `featureFlag`, `requiredCapability`, `availability`,
`dependency`, `description`, và `component`. Production default expose toàn bộ product rail:
`cowork` là `available`; Dispatch/Gateway/Knowledge/Knowledge Graph/Microsoft 365 là
`awaiting_integration` với dependency D1-D4 cụ thể; `code` là `planned`. Các surface này
không phải capability backend thật và không render mock production data.

D1-D4 integration slots chỉ là UI contracts trong `app/ui/src/integration-slots.ts`:

- D1 Dispatch: task summary, child tasks, cancellation, permission wait, result provenance.
- D2 Microsoft: connection state, service list, scopes, action history, reconnect/error.
- D3 Knowledge: index state, sources, query results, provenance, stale/rebuild state.
- D4 Gateway: health, routes, provider/model, latency, usage/cost, fallback/error state.

Không có backend adapter D1-D4 trong shell foundation này.

## Boundary Minimal Workspace Navigator

Renderer không đọc filesystem. Workspace Navigator gọi service route `GET /v1/workspace/list`
để list direct children của active workspace hoặc folder đã expand. Service:

- validate active workspace root server-side;
- dùng workspace guard + realpath confinement;
- không follow symlink/reparse point ra ngoài workspace;
- sort folder trước file;
- giới hạn số entry mỗi request;
- không recursive scan mặc định;
- không đọc file content khi chỉ listing.

Selected workspace file preview đi qua `GET /v1/workspace/file-preview`, bounded 64 KiB,
text-only. Binary/unsupported trả trạng thái không xem trước. Direct editor, save/undo,
PDF, Office, and image preview are not started.

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

## Boundary file review (File Work Review slice)

- Service module `service/src/file-review/`: bounded snapshot capture (`POST /v1/file-review/snapshot`),
  artifact build (`POST /v1/file-review/build`), deterministic unified diff, secret-like redaction.
- UI captures **before** snapshot khi permission pending cho file mutation; **after** snapshot khi `file_mutation` EV
  (retry ngắn nếu disk chưa flush); persist `fileReviews[]` trên activity conversation.
- Activity panel tách `attachmentContextPaths` vs `runtimeReadPaths`; review surface ở right panel (không Preview tab toàn cục).
- Historical diff dùng snapshot đã persist — không đọc lại file disk để tái tạo; hash mismatch banner khi file hiện tại khác.

## Boundary Skills (Phase 1)

- Skill là directory chứa `SKILL.md` với frontmatter `id`, `name`, `description`, optional
  `version`, theo sau bởi instruction text. Không có code execution hoặc dependency loading.
- Allowed roots explicit: built-in Skills đóng gói cùng app và app-managed user-local Skills
  dưới user data. Service chỉ scan direct children, tối đa 64/root; không scan workspace.
- Service validate regular-file/realpath confinement, 32 KiB, UTF-8 text, metadata/ID,
  duplicate IDs, nội dung rỗng/binary và internal transport marker. Invalid Skill vẫn list
  với lý do nhưng không enable được.
- Enabled registry là global-local, persist qua relaunch. Mỗi user turn lưu snapshot metadata
  `id/name/version/source/contentHash/modifiedAt`; raw Skill content không vào transcript.
- Dispatch transport tách `<<<CGHC_SELECTED_LOCAL_SKILLS>>>` khỏi prior turns, attachment data
  và current request. Skills dùng chung bounded 12k budget và fail-fast nếu không fit.
- Skill chỉ là instruction context. Workspace guards, provider readiness, keyring,
  tool/file permission và OpenCode runtime boundary vẫn authoritative.

## Không lặp lại tài liệu cũ

Các ADR và báo cáo trong `.loop-engineer/` vẫn là provenance. Khi cần làm việc hằng ngày, đọc tài liệu ngắn trong
`docs/product/`, `docs/quality/`, và file này trước.
