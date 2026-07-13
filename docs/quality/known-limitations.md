---
language: "vi"
status: "active"
updated_at: "2026-07-13"
---

# Known limitations

## Activity & file changes

- Timeline dựa trên EV kinds quan sát được (`tool_call`, `file_mutation`, `step`, `progress`, `terminal`, `error`) — không hiển thị token model như tool.
- File-change panel chỉ liệt kê thay đổi từ `file_mutation` (tool write/edit hoàn thành), không quét toàn workspace.
- Preview tệp: văn bản bounded (64KB), từ chối binary/traversal/symlink escape.
- **File review (slice mới)**: before/after snapshot + unified diff bounded (64KB snapshot, 32KB diff, 500 dòng);
  persist trên activity conversation; secret-like path redact; hash mismatch banner khi file disk đã đổi sau turn.
  Không có open-file shell bridge (chỉ copy path); không universal Preview tab; không direct editor.
  **Packaged live**: Journey A (create) và B (modify) PASS; Journey C (delete) chưa chứng minh vì live model không
  gọi delete tool ổn định — chưa kết luận product delete-path lỗi.
- Attachment context (`Đã đưa tệp vào ngữ cảnh`) tách khỏi runtime read (`Đã đọc tệp`) trong activity panel.
- Activity lịch sử không replay animation live khi mở lại conversation.
- OpenCode `permission.asked` / `permission.replied` không map sang timeline — quyền qua API Cowork + modal.

## Session & multi-turn

- **Một OpenCode runtime session = một lượt** — sau terminal, Cowork GHC tạo runtime turn mới liên kết cùng conversation; không re-prompt session đã terminal (OpenCode trả 409).
- **Reuse** cùng OpenCode session chỉ khi `canPrompt === true` và session chưa terminal.
- **Context continuity** dùng envelope nội bộ bounded (~12k ký tự), đánh dấu untrusted — không phải native OpenCode `/continue`; có thể cắt bớt lượt cũ khi vượt budget.
- Transcript cũ có thể chứa wrapper leak từ slice trước; `stripTransportArtifacts` dọn khi hiển thị/persist mới và loại khỏi context tương lai — **không** rewrite hàng loạt history cũ.
- **Một runtime execution active** — không chạy song song nhiều OpenCode session cho cùng conversation.
- Sau relaunch app, conversation gần nhất được chọn lại; transcript hiển thị ngay; không tự khởi động OpenCode cho đến khi user gửi tin.
- Trạng thái `completed_without_final_message` khi tool hoàn tất nhưng runtime không trả text cuối; UI dùng fallback tiếng Việt.
- Grace window ngắn (~120ms service, ~200ms UI) cho token sau `session.idle`.
- Template re-run / workflow replay chưa có.
- Rename/delete qua context menu (chuột phải) — chưa có menu riêng trong sidebar.

## Release

- Full L9 / release-candidate verification PASS is incomplete. Partial packaged evidence exists, but the latest interactive UX pass did not complete live streaming/tool/file/permission/cancel/provider-recovery/native-picker journeys in one release-candidate run.
- Packaged live deny→next-turn recovery trong **cùng** conversation: **PASS** — `multi-turn-tool-packaged.mjs`.
- **File Work Review packaged**: PARTIAL PASS — live Journey A–B PASS; Journey C blocked by nondeterministic model/tool selection; D–L not completed in latest run.
- **Open verification decision**: Live LLM behavior must not be the sole mechanism used to verify deterministic delete/deny/redaction/persistence File Review semantics. A deterministic packaged product-path suite is still required.

## Attachments (Phase 1 + honesty)

- **Workspace text file attachments: verified** — `.txt`, `.md`, `.json`, source text phổ biến; max 32KB/tệp, 64KB tổng/turn; dispatch budget 12k ký tự chung với prior-turn context.
- **Dispatch preflight: verified** — `planDispatchPrompt` fail-fast khi attachment không fit budget cuối; pending chips giữ nguyên; metadata `inclusionStatus` trên message; activity dùng `Đã đưa tệp vào ngữ cảnh` (không claim `đã đọc` trước dispatch).
- **Secret-like files: blocked by default** — `.env`, `.env.*`, `*.pem`, `*.key`, `id_rsa`, `id_ed25519`, `credentials.json`, `service-account*.json`, `.npmrc`, `.pypirc`; kiểm tra trước khi đọc nội dung; không override trong slice này.
- **Folder attachments: not started**
- **Image/PDF/document parsing: not started**
- **Drag-and-drop: not started**
- Đính kèm chỉ cấp **read context snapshot** — không bypass permission sửa/xóa file.
- Raw file content và envelope nội bộ (`<<<CGHC_UNTRUSTED_ATTACHMENT_CONTEXT>>>`) không persist trong transcript.
- Không claim bảo vệ tuyệt đối trước prompt injection trong file đính kèm — chỉ envelope untrusted + yêu cầu user hiện tại được ưu tiên.

## Tính năng chưa có

- Skills Phase 1 chỉ là local instruction context (`SKILL.md`): built-in + app-managed
  user-local, direct-child discovery tối đa 64 Skill/root, 32 KiB/file, UTF-8 text,
  persisted global-local enable state và per-turn provenance.
- Không có executable Skill/plugin, MCP, marketplace, cloud catalog/sync, URL install,
  workspace auto-scan, dependency resolution hoặc full Skill editor.
- Skill content dùng chung dispatch budget 12k; nếu enabled Skill không fit thì turn fail-fast,
  không silently omit.
- `Tệp đã đọc` trong activity **không** còn gộp attachment context — attachment hiển thị riêng `Đã đưa tệp vào ngữ cảnh`; runtime tool read hiển thị `Đã đọc tệp`.
- Web support vẫn `DEFERRED`.

## UI Shell V3 / UX

- UI Shell V3 commercial visual baseline is **PASS** for the refreshed packaged evidence in `reports/ui-shell-v3-commercial-readiness/`; Product Owner sign-off is still pending review of that evidence.
- Windows controls use Electron native titlebar overlay. Cowork GHC intentionally does not draw custom minimize/maximize/close controls; this preserves native close behavior, double-click maximize/restore, Snap Layout, and high-DPI behavior.
- Global Settings access is restored from the topbar and provider/status affordances; it opens the existing production Settings behavior as a full-screen V3 application surface with `Nhà cung cấp` and `Chung` navigation, not a parallel modal.
- Provider/model control is a production status/settings entry point only. **Multi-Provider Profiles are not implemented**; there is no real multi-profile dropdown registry yet.
- Provider status now names the subject (`DeepSeek · Chưa kiểm tra`, `DeepSeek · Sẵn sàng`, `DeepSeek · Kết nối thất bại`, `Provider · Chưa cấu hình`) and should not rely on color alone. `Chưa kiểm tra` is not a healthy/green state.
- Inspector overlay placement was re-verified in packaged evidence; it starts below the topbar and ends above the status bar.
- Conversation draft UX prevents creating additional blank active drafts and marks drafts as `Nháp`, but AI title generation is not implemented.
- D1–D4 integration surfaces remain passive `awaiting_integration` slots with no mock integration data.
- File Work Review remains **PARTIAL PASS**.
- GUI remains pre-release until Product Owner sign-off and a later release-candidate run covers the full packaged live journey; do not continue redesign unless a regression or new PO/audit finding appears.
