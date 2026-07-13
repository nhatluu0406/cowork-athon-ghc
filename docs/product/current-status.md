---
language: "vi"
status: "active"
updated_at: "2026-07-13"
---

# Trạng thái hiện tại

Baseline: packaged POC `poc-v0.1` trên Windows 11. Tài liệu canonical: [docs/README.md](../README.md).

## Capability inventory

| Năng lực | Trạng thái | Ghi chú |
|---|---|---|
| Startup | **WORKS** | `scripts\init.bat` → `build.bat` → `start.bat`; mở New Chat sạch; không auto-load history transcript. |
| Provider profiles | **WORKS** | Multi-Provider Profiles Phase 1: DeepSeek preset + custom OpenAI-compatible; đổi profile active không cần restart. |
| Credentials | **WORKS** | Windows keyring per profile; preflight missing-credential; không lộ secret trong UI/log. |
| Workspace | **PARTIAL** | Workspace Companion Phase 1: navigator + preview/editor + chat; txt/md/xlsx edit; agent refresh. |
| Chat | **WORKS** | Streaming qua OpenCode runtime; multi-turn qua envelope bounded. |
| Conversations | **WORKS** | Tạo, tìm, đổi tên, xóa, mở lại từ sidebar; relaunch giữ history. |
| Attachments | **PARTIAL** | Text files (.txt, .md, .json, source text); secret-like blocked; chưa drag-drop / PDF / image. |
| Skills | **PARTIAL** | Settings → **Kỹ năng**: CRUD user `SKILL.md`, enable/disable; built-in read-only; chưa marketplace/MCP. |
| Permissions | **WORKS** | Allow/Deny modal trước mutation; deny recovery đã verify packaged. |
| File Work Review | **PARTIAL** | Create/modify + diff bounded PASS; delete tracking chưa tin cậy (OpenCode tool surface). |
| D1 Dispatch | **NOT IMPLEMENTED** | UI surface + mount `d1-dispatch-root`; placeholder **Chờ tích hợp D1**; backend chưa merge. |
| D2 Microsoft 365 | **NOT IMPLEMENTED** | UI surface + mount `d2-microsoft-root`; placeholder **Chờ tích hợp D2**; backend chưa merge. |
| D3 Knowledge | **NOT IMPLEMENTED** | UI surface + mount `d3-knowledge-root`; placeholder **Chờ tích hợp D3**; backend chưa merge. |
| D4 Gateway | **NOT IMPLEMENTED** | UI surface + mount `d4-gateway-root`; placeholder **Chờ tích hợp D4**; backend chưa merge. |
| Code surface | **PLANNED** | Rail item **Đã lên kế hoạch**; mount `code-surface-root`; chưa có backend. |
| UI readiness | **WORKS** | UI Shell V3; product rail đủ 6 mục (Cowork + D1–D4 + Code); Cowork/Workspace là mode trong Cowork. |
| Web / Next.js | **DEFERRED** | Không bắt đầu trước desktop acceptance. |
| Full L9 / RC | **DEFERRED** | Chưa hoàn tất một pass release-candidate đầy đủ. |

## Demo readiness (2026-07-13)

- Hành trình demo: [demo-guide.md](../demo/demo-guide.md), [demo-acceptance.md](../quality/demo-acceptance.md).
- **Workspace Companion Phase 1** — BASIC COMPLETE trên `main` (navigator + preview/editor + chat).
- Product rail hiển thị Cowork, Dispatch, Gateway, Knowledge, Microsoft 365, Code; D1–D4 backends **chưa merge**.
- Scripts: `init.bat`, `build.bat`, `start.bat`, `stop.bat`, `clean.bat`, `demo-reset.bat`, `demo-seed.bat`, `verify-fast.bat`.

## Gần đây đã merge

- **Workspace Companion Phase 1** — rich preview, txt/md/xlsx edit+save, agent refresh, `demo-seed.bat`.
- **Multi-Provider Profiles Phase 1** — profile store, active switch, migration legacy DeepSeek, Settings UI.
- **UI Shell V3** — commercial readiness remediation và PO fixes (inspector, startup clean chat, context wrapper).

Chi tiết giới hạn: [known-limitations.md](../quality/known-limitations.md).
