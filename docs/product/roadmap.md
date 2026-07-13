---
language: "vi"
status: "active"
updated_at: "2026-07-13"
---

# Lộ trình sản phẩm

Canonical plan: [product-plan.md](./product-plan.md). Trạng thái: [current-status.md](./current-status.md).

## NOW — demo và acceptance cơ bản

- Ổn định hành trình demo 10 bước (packaged app).
- Multi-Provider Profiles Phase 1 — **đã implement**, chờ PO sign-off.
- **Workspace Companion Phase 1** — navigator + preview/editor + chat companion (đang implement).
- File Work Review create/modify — **PARTIAL**; delete chưa tin cậy.
- Skills Foundation Phase 1 — discovery/enable; chưa editor CRUD.
- Scripts lifecycle + `verify-fast.bat` + `demo-reset.bat` + `demo-seed.bat`.

## NEXT — sau demo review

- File Work Review hardening (delete path, deterministic packaged suite).
- Skills add/edit/delete trong UI (nếu PO chọn slice).
- Attachment Phase 2 (drag-drop, folder) khi có brief rõ.
- Full packaged release verification (streaming live, native picker, installed keyring).

## LATER — mở rộng sản phẩm

- Full Office editing (Word/Excel parity).
- Installer, upgrade, uninstall, migration.
- Final UX polish (không đổi scope chức năng).
- External integration intake D1–D4 (khi backend teams merge).

## WAITING — không bắt đầu

| Mục | Lý do |
|---|---|
| Web / Next.js | ADR 0007 — deferred đến desktop RC |
| D1–D4 backends | Chưa merge; UI slot đánh dấu Sắp có |
| Skill marketplace / MCP | Ngoài Skills Foundation Phase 1 |
| Full IDE workspace | Ngoài Workspace Companion Phase 1 |
| Cloud / multi-user | Ngoài local-first POC |

## Workspace Companion Phase 1 — happy path

- [x] Chọn workspace và duyệt navigator
- [x] Xem trước `.txt` / `.md`
- [x] Xem trước `.png` / `.jpg` / `.webp`
- [x] Xem trước `.pdf` (read-only)
- [x] Xem trước `.docx` (read-only HTML)
- [x] Xem trước `.xlsx` (grid)
- [x] Chỉnh sửa và lưu `.txt` / `.md`
- [x] Chỉnh sửa cell cơ bản và lưu `.xlsx`
- [x] Chat Cowork cạnh preview (workspace mode)
- [x] Agent refresh preview khi sửa file đang mở
- [ ] Multi-sheet Excel
- [ ] `.docx` edit in-app
- [ ] Drag-drop vào preview
