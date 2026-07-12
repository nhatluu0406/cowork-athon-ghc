---
title: "CGHC-027 — Documentation normalization (đợt 1, bằng chứng)"
document_type: "implementation-evidence"
language: "vi"
task: "CGHC-027"
loop: "L6"
requirement: "CGHC-DOC-001"
change_class: "LANGUAGE_ONLY_CHANGE"
---

# CGHC-027 — Chuẩn hóa ngôn ngữ tài liệu (đợt 1)

## Bối cảnh thực thi

Owner subagent (`product-architect`) dịch xong đợt 1 thì gặp **API stream stall** khi đang xác minh
internal link (last log: "…Now let me verify internal markdown links resolve."). Loop Engineer Lead
xác minh trạng thái trên đĩa và viết evidence này. Review độc lập (kỹ thuật + ngôn ngữ) do
`code-reviewer` thực hiện (reviewer ≠ implementer).

## Phạm vi đợt 1 (bounded, KHÔNG mass-translate)

Dịch tại chỗ sang body tiếng Việt (identifier giữ tiếng Anh), chọn nhóm ADR canonical-critical còn
tiếng Anh ưu tiên cao nhất:

| File | language | Nội dung |
|---|---|---|
| `docs/architecture/decisions/0001-agent-tool-runtime-and-persistence.md` | vi | body VI, identifier EN |
| `docs/architecture/decisions/0002-desktop-shell.md` | vi | body VI, identifier EN |
| `docs/architecture/decisions/0003-local-service-transport-placement-loopback.md` | vi | body VI, identifier EN |
| `docs/architecture/decisions/README.md` (ADR index) | vi | body VI, bảng Index giữ mô tả EN |

Còn tiếng Anh cho đợt CGHC-027 kế tiếp: `0004`, `0005`, `0006` (ADR), và các doc canonical khác
trong `.loop-engineer/reports/docs-language-audit.md` chưa dịch. KHÔNG động vào doc đã tiếng Việt
(0007, 0008, master-plan, scope) và KHÔNG dịch reference `docs/openwork-requirements-and-basic-design.md`.

## LANGUAGE_ONLY_CHANGE — bản ghi hash

⚠️ **Hạn chế quy trình:** đây KHÔNG phải git repo và subagent chưa ghi hash TRƯỚC khi dịch (stall
trước bước ghi), nên **old sha256 không khôi phục được** cho đợt này. Ghi lại **new-baseline sha256**
làm mốc để mọi thay đổi sau này so được; reason = `LANGUAGE_ONLY_CHANGE`. Bài học: các đợt CGHC-027
sau PHẢI ghi old-hash trước khi sửa (thêm bước "hash trước" vào brief).

| File | old sha256 | new sha256 (baseline) |
|---|---|---|
| `0001-…-persistence.md` | `UNRECOVERABLE (no git, not captured pre-edit)` | `5075b0c35cda77e4c284302367d8becacc00d961cc0a090beb7cabd699cd644e` |
| `0002-desktop-shell.md` | `UNRECOVERABLE` | `1080557538a6e68530a2124fdb5995e158cae2415d7dac08c421584cd7506198` |
| `0003-…-loopback.md` | `UNRECOVERABLE` | `85295476a3f64726abf95432c602df8fc49da64e3773715e403345626b997760` |
| `README.md` | `UNRECOVERABLE` | `d40303a316d5767195cc938a17d4a5582933b7152eb69119d6a24f133f4a3030` |

## Kiểm tra toàn vẹn (đã chạy)

- **Requirement/ADR ID không đổi:** ADR 0001–0008 IDs, `PR9`, `SEC-1`, `P7`, `F1/F6`, `LC1/LC5` còn
  nguyên trong các file đã dịch (grep xác nhận). Không ID nào bị dịch/đổi.
- **Frontmatter `language: "vi"`** có mặt ở cả 4 file.
- **Mermaid:** 0 block trong 3 ADR đã dịch → không có sơ đồ bị hỏng.
- **Internal link:** các link trong README trỏ tới `0001..0008.md` + `../cowork-ghc-implementation-design.md`
  đều tồn tại (đã kiểm).
- **Không tạo bản EN cạnh tranh:** dịch tại chỗ đúng file canonical; không sinh file thứ hai.

## Điểm cần review ngôn ngữ quyết định (semantic/policy)

- **Heading section ADR giữ tiếng Anh** (`## Context`, `## Decision`, `## Consequences`,
  `## Alternatives considered`, `## Requirements traceability`, `## Open items for L4`). Policy nói
  "Vietnamese headings". Người dịch giữ tên section ADR chuẩn bằng tiếng Anh như cấu trúc đã thiết lập.
  **Language reviewer quyết định**: dịch heading sang tiếng Việt hay chấp nhận tên section ADR chuẩn EN.
  Đây là điểm nhất quán, KHÔNG phải nửa vời (body đã VI hoàn toàn).
- Không phát hiện semantic delta (không có yêu cầu mơ hồ/nghĩa đổi lộ ra khi dịch). **L1–L4 KHÔNG bị
  invalidate** (LANGUAGE_ONLY_CHANGE).

## Rủi ro

- Old-hash không có cho đợt này (đã nêu) — chỉ ảnh hưởng bookkeeping, không ảnh hưởng nội dung.
- Nếu reviewer yêu cầu heading tiếng Việt, cần một sửa nhỏ trên 3 ADR + README.
