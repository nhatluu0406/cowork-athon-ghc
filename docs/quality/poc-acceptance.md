---
language: "vi"
status: "active"
updated_at: "2026-07-12"
---

# Packaged POC acceptance

Tài liệu này tóm tắt acceptance đã quan sát cho packaged POC. Chi tiết lịch sử nằm trong `.loop-engineer/evidence/` (maintenance-only).

## Bằng chứng packaged đã quan sát

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| Service lifecycle | PASS | |
| Workspace | PASS | |
| Provider/model | PASS | |
| Windows keyring | PASS | |
| OpenCode + inference | PASS | Bounded live |
| Streaming | PASS | |
| Permission approve/deny | PASS | |
| Cancellation / interruption | PASS | |
| Clean-profile onboarding | PASS | |
| Invalid API key recovery | PASS | `tools/verify/provider-recovery-packaged.mjs` |
| Invalid model recovery | PASS | Probe chat completion + `model_invalid` |
| Invalid base URL recovery | PASS | TEST-NET host, lỗi mạng tiếng Việt |
| Recovery without restart | PASS | Settings modal vẫn dùng được sau lỗi |
| `start.bat` / `stop.bat` | PASS | `tools/verify/lifecycle-scripts.mjs` |
| `clean.bat` | PASS | Xác nhận tương tác + `--yes`; allowlist qua unit test |
| Conversation persistence | PASS | `service/tests/conversation-relaunch.test.ts` |
| Multi-conversation UI | PASS | Sidebar, search, rename, delete (metadata) |
| Interrupted session recovery | PASS | `running` → `interrupted` on service boot |
| OpenCode true resume | PARTIAL | Chỉ khi cùng runtime session chưa terminal; sau terminal dùng phiên tiếp nối |
| Activity timeline (EV → UI) | PASS | `app/ui/tests/activity-model.test.ts` |
| Verified file-change panel | PASS | Chỉ từ EV `file_mutation` |
| Permission history (read-only) | PASS | Từ quyết định modal thật |
| File preview API | PASS | `service/tests/workspace-file-preview.test.ts` |
| Activity persistence on reopen | PASS | `conversation-store` `setActivity` |
| Tool-using conversation finalization | PASS | `app/ui/tests/session-finalization.test.ts`; packaged `conversation-finalization-packaged.mjs` |
| Final response source (stream / fetch / fallback) | PASS | `text-part-mapper`, `session-finalization`, `ev-reducer` late-token grace |
| Multi-turn trong cùng Cowork conversation | PASS | `runtime-turn-planner`, `transcript-context`, atomic PATCH; packaged `multi-turn-packaged.mjs` |
| Multi-turn tool create/modify/read | PASS | `multi-turn-tool-packaged.mjs` |
| Multi-turn context isolation (no wrapper leak) | PASS | `message-role-ev-mapper`, `assistant-output`; packaged `multi-turn-context-packaged.mjs` |
| Runtime turn history persisted | PASS | `service/tests/conversation-multi-turn.test.ts` |
| Last-active conversation on relaunch | PASS | `GET /v1/conversations/last-active` + UI auto-select |
| Workspace text file attachments (Phase 1) | PASS | `attachments-packaged.mjs` journeys A–J; `service/tests/workspace-attachment-read.test.ts` |

## Regression không-live

```powershell
npm run verify:release
```

Bao gồm: `typecheck`, provider contract tests, permission bridge, app lifecycle CLI, lifecycle script structure, OpenCode binary presence, shell bundle, `loop-engineer verify` (optional).

Không gọi DeepSeek, không cần API key, không tạo process lâu dài.

## Packaged smoke tối thiểu (sau thay đổi release-critical)

```powershell
npm run package:win
node tools/verify/minimal-packaged-smoke.mjs
node tools/verify/multi-turn-context-packaged.mjs
node tools/verify/attachments-packaged.mjs
node tools/verify/multi-turn-tool-packaged.mjs
node tools/verify/conversation-finalization-packaged.mjs
```

## Còn thiếu / chưa đủ productized

- Template re-run / workflow replay packaged smoke.
- Diff before/after đầy đủ cho file sửa (slice activity chỉ preview nội dung hiện tại).
- Packaged live journey A–D với inference (tùy chọn; deterministic đã có trong `activity-presentation-packaged.mjs`).
- L9 release verification đầy đủ (ngoài regression nhẹ hiện tại).

## Ghi chú bảo mật

- Không đưa API key vào docs, logs, screenshot hoặc Git.
- Live call bounded; không nằm trong `npm run verify:release`.
