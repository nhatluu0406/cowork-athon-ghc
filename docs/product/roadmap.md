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
- **Workspace Companion Phase 1** — **BASIC COMPLETE** trên `main` (navigator + preview/editor + chat).
- File Work Review create/modify — **PARTIAL**; delete chưa tin cậy.
- Skills Foundation Phase 1 — discovery/enable; chưa editor CRUD.
- Scripts lifecycle + `verify-fast.bat` + `demo-reset.bat` + `demo-seed.bat`.

## NEXT — sau demo review

- **External product surfaces** — rail + placeholder UI cho D1–D4 và Code (**UI restored**; backends chưa merge).
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
| D1–D4 backends | Chưa merge; **UI surfaces restored** với mount boundaries và placeholder tiếng Việt |
| Skill marketplace / MCP | Ngoài Skills Foundation Phase 1 |
| Full IDE workspace | Ngoài Workspace Companion Phase 1 |
| Cloud / multi-user | Ngoài local-first POC |

## External product surfaces (UI intake)

| Rail | Mount ID | Status UI | Backend |
|---|---|---|---|
| Cowork | (shell) | **Available** — Cowork + Workspace modes | Core POC |
| Dispatch (D1) | `d1-dispatch-root` | Chờ tích hợp D1 | **Not merged** |
| Gateway (D4) | `d4-gateway-root` | Chờ tích hợp D4 | **Not merged** |
| Knowledge (D3) | `d3-knowledge-root` | Chờ tích hợp D3 | **Not merged** |
| Microsoft 365 (D2) | `d2-microsoft-root` | Chờ tích hợp D2 | **Not merged** |
| Code | `code-surface-root` | Đã lên kế hoạch | **Not merged** |

Placeholder surfaces: không metric giả, không bản ghi mẫu; team thay nội dung trong mount boundary qua `integration-surface-adapters.ts` registry.

- [x] Rail hiển thị đủ 6 mục
- [x] Điều hướng mở full surface
- [x] Placeholder tiếng Việt theo D1–D4 / Code
- [x] Mount boundary ổn định cho team UI
- [ ] Backend D1 merge
- [ ] Backend D2 merge
- [ ] Backend D3 merge
- [ ] Backend D4 merge

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
