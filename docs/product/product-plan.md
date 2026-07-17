---
language: "vi"
status: "active"
updated_at: "2026-07-15"
---

# Kế hoạch sản phẩm Cowork GHC

## Tầm nhìn

Cowork GHC là desktop AI workspace local-first trên Windows: người dùng kết nối LLM, chọn workspace, trò chuyện với Agent, kiểm soát permission và cùng làm việc trên file trong một giao diện đáng tin cậy.

## Giá trị POC

1. **Một nơi làm việc thống nhất:** chat, file, Skill, provider và activity.
2. **Local-first:** workspace, conversation và configuration nằm trên máy người dùng.
3. **Có kiểm soát:** permission trước mutation, key trong Windows keyring.
4. **Trung thực:** assistant text không thay thế bằng chứng file action.
5. **Có khả năng mở rộng:** D1–D4 có mount boundary nhưng không fake capability.

## Capability map

### Cowork

- [x] New Chat, streaming, history
- [x] Text attachments bounded
- [x] Permission mode selector
- [x] File create/modify foundation
- [ ] Chat presentation cleanup: bỏ tool/Skill narration, compact metadata
- [ ] Reliable repeated permission happy path

### Workspace

- [x] Guarded file navigator
- [x] Text/Markdown preview và edit
- [x] Binary preview foundation
- [ ] PDF packaged preview reliable
- [ ] Agent-created/modified file auto-open và live refresh
- [ ] Workspace companion chat refinement

### Code (PLANNED — Hybrid, ADR 0013)

- [x] Shared-backend renderer surface (một active workspace/guard/permission/OpenCode session)
- [x] Read-only explorer + diff/preview + shared-session panel
- [ ] Code Phase 1 — Shared Workspace Multi-File Editor (multi-tab edit/save/dirty/conflict, Workspace ↔ Code handoff, active-file context, verified refresh) — see roadmap Wave 7
- [ ] Rename product label "Claude Code" → "Code"
- Deferred: terminal, Git UI, debugger, LSP, dev-server, runtime web preview, desktop app launch (no separate backend/session/runtime for Code)

### Providers

- [x] Multiple saved profiles
- [x] DeepSeek preset
- [x] Custom OpenAI-compatible endpoint/token/model
- [x] Windows keyring
- [ ] Automatic connection test on credential save
- [ ] Persist last verified status with expiry/invalidation rules
- [ ] Discover model IDs through OpenAI-compatible `/models` when supported
- [ ] Manual model ID fallback when discovery is unavailable

### Skills

- [x] Built-in and user-local Skills
- [x] Create/edit/delete/enable/disable
- [ ] Richer validation/presentation only if needed by demo

### Inspector

- [x] Shell/tabs foundation
- [ ] Plan state and current step
- [ ] Activity timeline
- [ ] Permission history
- [ ] File Work Review surface and provenance
- [ ] Clear empty/error/loading states

### Settings / operations

- [x] Full-screen Settings
- [x] Light/dark/system themes
- [ ] Document and finish detailed logging behavior
- [ ] Document and finish local telemetry behavior
- [ ] Local single-user authentication/lock gate for demo

### External systems

- [ ] D1 Dispatch — waiting for team merge
- [ ] D2 Microsoft 365 — waiting for team merge
- [ ] D3 Knowledge/RAG/Graph — waiting for team merge
- [ ] D4 Advanced Gateway — waiting for team merge

## Out of scope for the current demo

- Cloud multi-user accounts
- Enterprise identity federation
- Provider routing/failover/key pools
- Full Office-grade editing
- Skill marketplace/executable plugin runtime
- Full IDE replacement
- Web/Next.js client
