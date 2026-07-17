---
language: "vi"
status: "active"
updated_at: "2026-07-18"
---

# Cowork GHC — Bản đồ tài liệu

Điểm vào canonical duy nhất cho tài liệu dự án.

## Đọc nhanh

1. [Trạng thái hiện tại](product/current-status.md)
2. [Feature matrix](product/feature-matrix.md)
3. [Kế hoạch triển lãm (Exhibition Readiness)](product/exhibition-readiness-plan.md)
4. [Lộ trình](product/roadmap.md)
5. [Tổng quan kiến trúc](architecture/system-overview.md)
6. [Dependencies & services](architecture/dependencies-and-services.md)
7. [Local-first strategy](architecture/local-first-strategy.md)
8. [Known limitations](quality/known-limitations.md)
9. [Demo acceptance](quality/demo-acceptance.md)

## Canonical owners

| Tài liệu | Sở hữu thông tin |
| --- | --- |
| `product/current-status.md` | Sự thật hiện tại, cô đọng (WORKS / PARTIAL / DORMANT / NOT IMPLEMENTED / DEFERRED) |
| `product/feature-matrix.md` | Inventory chi tiết theo bề mặt (frontend/backend/persistence/network/evidence) |
| `product/product-plan.md` | Tầm nhìn, phạm vi, capability sản phẩm |
| `product/roadmap.md` | NOW / NEXT / LATER / WAITING |
| `product/exhibition-readiness-plan.md` | Kế hoạch đưa sản phẩm thành trạng thái triển lãm (P0–P3, acceptance) |
| `architecture/system-overview.md` | Boundary + kiến trúc đang chạy |
| `architecture/dependencies-and-services.md` | Inventory ngôn ngữ/tiến trình/DB/network/third-party (D-track truth, Docker dev-only) |
| `architecture/local-first-strategy.md` | Phân loại dependency + KB/KG options + roadmap local hóa |
| `quality/demo-acceptance.md` | Happy path kiểm tra trên packaged app |
| `quality/release-acceptance.md` | Acceptance có phủ negative/recovery |
| `quality/known-limitations.md` | Giới hạn thực tế chưa xử lý |
| `quality/ui-ux-audit.md` | Kết quả audit UI/UX từ ảnh thực tế (đang chờ capture slice) |
| `demo/demo-guide.md` | Kịch bản + prompt cho demo |

## Supporting documents

- ADR: `architecture/decisions/`
- Integration intake (D1–D3): `integration/`
- Research/reference: `references/`
- Development Skill: `.agents/skills/cowork-ghc-commercial-ui/SKILL.md`
- **Archive** (lịch sử, không canonical): `archive/` — xem [`archive/README.md`](archive/README.md)

## Quy tắc

- Không ghi cùng một status ở nhiều tài liệu (mỗi loại thông tin một owner).
- Không nhồi Git HEAD thay đổi liên tục vào nhiều file.
- **Chính sách archive (cập nhật 2026-07-18):** tài liệu Markdown lịch sử không còn dùng được đưa
  vào `docs/archive/` bằng `git mv` (giữ history) và ghi vào `archive/README.md` — không để lẫn với
  canonical. (Thay cho quy tắc cũ "Git history là archive duy nhất".) Git history vẫn là nguồn phục
  hồi cuối cùng.
- Report/screenshot generated mặc định không commit, trừ accepted milestone evidence dưới
  `demo/screenshots/`.
- Khi product truth thay đổi, cập nhật đúng owner (`current-status` / `feature-matrix` / `roadmap` /
  `demo-acceptance` / `known-limitations`).
