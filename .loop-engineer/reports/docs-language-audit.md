---
title: "Kiểm kê ngôn ngữ tài liệu docs/"
document_type: "language-audit"
language: "vi"
status: "informational"
---

# Kiểm kê ngôn ngữ tài liệu `docs/`

> Báo cáo cho product owner. Mục tiêu: xác định tài liệu nào cần chuyển sang tiếng Việt và khi nào,
> **không** dịch hàng loạt máy móc và **không** làm chậm desktop implementation.
> Cập nhật: 2026-07-11.

## Tổng quan

- Tổng số tài liệu trong `docs/`: **11** (10 tài liệu có sẵn + `0007-web-application-deferral.md` mới).
- Đang dùng tiếng Anh: **10**.
- Đã theo policy tiếng Việt: **1** (`0007-web-application-deferral.md`, tạo mới hôm nay).
- Cần ưu tiên chuyển sang tiếng Việt **trước L6**: **8** tài liệu canonical-critical.

## Bảng kiểm kê

| File | Loại tài liệu | Ngôn ngữ hiện tại | Mức quan trọng | Có cần dịch | Thời điểm |
|---|---|---|---|---|---|
| `docs/product/cowork-ghc-scope-and-acceptance.md` | Scope + Acceptance | English | `CANONICAL_CRITICAL` | Có | Trước L6 |
| `docs/architecture/cowork-ghc-implementation-design.md` | Architecture design | English | `CANONICAL_CRITICAL` | Có | Trước L6 |
| `docs/architecture/decisions/0001-agent-tool-runtime-and-persistence.md` | ADR | English | `CANONICAL_CRITICAL` | Có | Trước L6 |
| `docs/architecture/decisions/0002-desktop-shell.md` | ADR | English | `CANONICAL_CRITICAL` | Có | Trước L6 |
| `docs/architecture/decisions/0003-local-service-transport-placement-loopback.md` | ADR | English | `CANONICAL_CRITICAL` | Có | Trước L6 |
| `docs/architecture/decisions/0004-windows-process-lifecycle-and-supervision.md` | ADR | English | `CANONICAL_CRITICAL` | Có | Trước L6 |
| `docs/architecture/decisions/0005-provider-abstraction.md` | ADR | English | `CANONICAL_CRITICAL` | Có | Trước L6 |
| `docs/architecture/decisions/0006-credential-store.md` | ADR | English | `CANONICAL_CRITICAL` | Có | Trước L6 |
| `docs/architecture/decisions/0007-web-application-deferral.md` | ADR | Vietnamese | `CANONICAL_CRITICAL` | Đã đạt | — |
| `docs/architecture/decisions/README.md` | ADR index | English | `CANONICAL_SUPPORTING` | Có | Khi cập nhật / L10 |
| `docs/openwork-requirements-and-basic-design.md` | OpenWork research reference | English | `REFERENCE_ONLY` | **Không** | Giữ nguyên (tài liệu tham khảo upstream) |

## Ưu tiên chuyển sang tiếng Việt trước L6

8 tài liệu `CANONICAL_CRITICAL` còn tiếng Anh (scope + acceptance, implementation design, ADR
0001–0006). Đây là các tài liệu product owner cần đọc để xác nhận requirement, acceptance và quyết
định kiến trúc. Việc dịch nằm trong task `CGHC-DOC-001`, được **lập kế hoạch trong L5** và chia nhỏ.

## Tài liệu dịch sau (không chặn desktop)

- `docs/architecture/decisions/README.md` (`CANONICAL_SUPPORTING`) — dịch khi cập nhật lần tiếp theo,
  hoặc tại L10 documentation normalization.

## Không dịch

- `docs/openwork-requirements-and-basic-design.md` — tài liệu tham khảo upstream, giữ nguyên.
- Bất kỳ nội dung license, code sample, `command`, `schema`, generated API doc mà việc dịch không
  mang lại giá trị.

## Nguyên tắc thực thi

- Thay đổi chỉ-ngôn-ngữ = `LANGUAGE_ONLY_CHANGE`: lưu hash cũ + hash mới + lý do, xác nhận
  Requirement/ADR ID và acceptance meaning không đổi, gắn review evidence. **Không** tự động chạy lại
  L1–L4 vì hash đổi do dịch.
- Nếu khi dịch phát hiện requirement mơ hồ/mâu thuẫn, thiếu boundary, hoặc acceptance đổi nghĩa → đó
  là **semantic delta**, không còn là language-only: ghi delta, chỉ invalidate loop có dependency thật
  sự liên quan, không invalidate toàn bộ dự án.
- Giữ nguyên identifier kỹ thuật (tên file, ID, symbol, route, schema field, command, env var, tên
  framework/product) bằng tiếng Anh.
