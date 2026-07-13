---
language: "vi"
status: "active"
updated_at: "2026-07-13"
---

# Cowork GHC — Tài liệu dự án

Đọc theo thứ tự sau khi làm việc trên repository:

1. [Trạng thái hiện tại](../product/current-status.md) — sự thật hiện tại về năng lực và giới hạn.
2. [Kế hoạch sản phẩm](../product/product-plan.md) — tầm nhìn, phạm vi, và năng lực sản phẩm.
3. [Lộ trình](../product/roadmap.md) — NOW / NEXT / LATER / WAITING.
4. [Tổng quan kiến trúc](../architecture/system-overview.md) — runtime, service, shell, boundary.
5. [Demo acceptance](../quality/demo-acceptance.md) — tiêu chí chấp nhận cho hành trình demo.
6. [Giới hạn đã biết](../quality/known-limitations.md) — hạn chế thực tế chưa giải quyết.
7. [Hướng dẫn demo](../demo/demo-guide.md) — các bước và prompt mẫu cho buổi demo.

## Tài liệu bổ sung (không canonical)

- ADR trong `docs/architecture/decisions/`
- Tham chiếu nghiên cứu trong `docs/references/`
- Bằng chứng gói trong `reports/` (chỉ giữ các batch còn dùng cho acceptance)

## Quy tắc cập nhật

- `current-status.md` mô tả **chỉ** trạng thái hiện tại; không lặp lại lịch sử branch dài.
- `product-plan.md` mô tả khả năng và phạm vi sản phẩm.
- `roadmap.md` dùng NOW / NEXT / LATER / WAITING.
- Không nhúng giá trị Git HEAD vào nhiều tài liệu — Git history là archive.

## Điểm vào cho agent

- Codex / agent chung: [`AGENTS.md`](../../AGENTS.md)
- Claude Code: [`CLAUDE.md`](../../CLAUDE.md)
