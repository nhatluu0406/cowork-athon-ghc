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
- File Work Review create/modify — **PARTIAL**; delete chưa tin cậy.
- Skills Foundation Phase 1 — discovery/enable; chưa editor CRUD.
- Scripts lifecycle + `verify-fast.bat` + `demo-reset.bat`.

## NEXT — sau demo review

- File Work Review hardening (delete path, deterministic packaged suite).
- Skills add/edit/delete trong UI (nếu PO chọn slice).
- Attachment Phase 2 (drag-drop, folder) khi có brief rõ.
- Minimal Workspace Navigator sau File Work Review A–L pass.
- Full packaged release verification (streaming live, native picker, installed keyring).

## LATER — mở rộng sản phẩm

- Rich file viewing (PDF, image) và direct edit bounded.
- Installer, upgrade, uninstall, migration.
- Final UX polish (không đổi scope chức năng).
- External integration intake D1–D4 (khi backend teams merge).

## WAITING — không bắt đầu

| Mục | Lý do |
|---|---|
| Web / Next.js | ADR 0007 — deferred đến desktop RC |
| D1–D4 backends | Chưa merge; UI slot đánh dấu Sắp có |
| Skill marketplace / MCP | Ngoài Skills Foundation Phase 1 |
| Full IDE workspace | Không có evidence nhu cầu |
| Cloud / multi-user | Ngoài local-first POC |
