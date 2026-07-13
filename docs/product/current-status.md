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
| Workspace | **PARTIAL** | Chọn workspace và duyệt read-only bounded; chưa có explorer đệ quy đầy đủ hay rich preview. |
| Chat | **WORKS** | Streaming qua OpenCode runtime; multi-turn qua envelope bounded. |
| Conversations | **WORKS** | Tạo, tìm, đổi tên, xóa, mở lại từ sidebar; relaunch giữ history. |
| Attachments | **PARTIAL** | Text files (.txt, .md, .json, source text); secret-like blocked; chưa drag-drop / PDF / image. |
| Skills | **PARTIAL** | Discovery + enable/disable local `SKILL.md`; **chưa** add/edit/delete trong UI. |
| Permissions | **WORKS** | Allow/Deny modal trước mutation; deny recovery đã verify packaged. |
| File Work Review | **PARTIAL** | Create/modify + diff bounded PASS; delete tracking chưa tin cậy (OpenCode tool surface). |
| D1 Dispatch | **NOT IMPLEMENTED** | Slot UI passive; rail ẩn trong demo. |
| D2 Microsoft 365 | **NOT IMPLEMENTED** | Slot UI passive; rail ẩn trong demo. |
| D3 Knowledge | **NOT IMPLEMENTED** | Slot UI passive; rail ẩn trong demo. |
| D4 Gateway | **NOT IMPLEMENTED** | Không routing/failover/key pool; rail ẩn trong demo. |
| UI readiness | **WORKS** | UI Shell V3 packaged; Settings full-screen; product rail chỉ Cowork cho demo. |
| Web / Next.js | **DEFERRED** | Không bắt đầu trước desktop acceptance. |
| Full L9 / RC | **DEFERRED** | Chưa hoàn tất một pass release-candidate đầy đủ. |

## Demo readiness (2026-07-13)

Nhánh `chore/demo-readiness` chuẩn bị funding/demo review:

- Hành trình demo 10 bước: xem [demo-guide.md](../demo/demo-guide.md) và [demo-acceptance.md](../quality/demo-acceptance.md).
- D1–D4 không hiển thị trên product rail mặc định (chỉ Cowork).
- Scripts: `init.bat`, `build.bat`, `start.bat`, `stop.bat`, `clean.bat`, `demo-reset.bat`, `verify-fast.bat`.
- Bằng chứng giữ lại: `reports/multi-provider-profiles-phase1/`, `reports/file-work-review-completion/`.

## Gần đây đã merge

- **Multi-Provider Profiles Phase 1** — profile store, active switch, migration legacy DeepSeek, Settings UI.
- **UI Shell V3** — commercial readiness remediation và PO fixes (inspector, startup clean chat, context wrapper).

Chi tiết giới hạn: [known-limitations.md](../quality/known-limitations.md).
