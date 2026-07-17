---
language: "vi"
status: "active"
updated_at: "2026-07-15"
---

# Cowork GHC — Bản đồ tài liệu

Đây là điểm vào canonical duy nhất cho tài liệu dự án.

## Đọc nhanh

1. [Trạng thái hiện tại](product/current-status.md)
2. [Kế hoạch sản phẩm](product/product-plan.md)
3. [Lộ trình](product/roadmap.md)
4. [Tổng quan kiến trúc](architecture/system-overview.md)
5. [Demo acceptance](quality/demo-acceptance.md)
6. [Known limitations](quality/known-limitations.md)
7. [Hướng dẫn demo](demo/demo-guide.md)

## Canonical owners

| Tài liệu | Sở hữu thông tin |
|---|---|
| `product/current-status.md` | Sự thật hiện tại: WORKS / PARTIAL / NOT IMPLEMENTED / DEFERRED |
| `product/product-plan.md` | Tầm nhìn, phạm vi và capability sản phẩm |
| `product/roadmap.md` | NOW / NEXT / LATER / WAITING với checkbox |
| `design.md` | Mô tả hệ thống diagram-ready: node/edge/boundary/layout đủ để sinh HTML & Excalidraw |
| `architecture/system-overview.md` | Boundary và kiến trúc đang chạy |
| `architecture/ev-stream-events.md` | Định dạng EV event streaming theo turn (thinking/tool/metrics) |
| `architecture/opencode-runtime-notes.md` | Forensic runtime OpenCode (delete/question tool, turn-perf, fix) |
| `quality/demo-acceptance.md` | Happy path phải kiểm tra trên packaged app |
| `quality/known-limitations.md` | Giới hạn thực tế chưa xử lý |
| `demo/demo-guide.md` | Kịch bản và prompt cho buổi demo |

## Supporting documents

- ADR: `architecture/decisions/`
- Integration intake: `integration/`
- Research/reference: `references/`
- Development Skill: `.agents/skills/cowork-ghc-commercial-ui/SKILL.md`

## Quy tắc

- Không ghi cùng một status ở nhiều tài liệu.
- Không đặt Git HEAD thay đổi liên tục vào nhiều file.
- Git history là archive; không tạo thêm thư mục archive cho report cũ.
- Report/screenshot generated mặc định không commit, trừ accepted milestone evidence.
- Khi product truth thay đổi, cập nhật `current-status`, `roadmap`, `demo-acceptance` hoặc `known-limitations` đúng owner.
