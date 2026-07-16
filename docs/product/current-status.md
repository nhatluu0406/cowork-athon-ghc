---
language: "vi"
status: "active"
updated_at: "2026-07-17"
---

# Trạng thái hiện tại — Wave 2 OpenCode + Kỹ năng & MCP

Cowork GHC desktop POC. Wave 0A/0B (local vault + conversation SQLite) đã land. Wave 2: OpenCode pin 1.18.1 + hub `Kỹ năng & MCP`.

## Current truth

| Capability | Status | Note |
|---|---|---|
| Cowork chat | WORKS | Progressive streaming; live attach gated. Skills are OpenCode native on-demand (no full prompt injection). |
| Workspace | WORKS — Wave 4 | Text/code preview + edit: syntax highlight (highlight.js) + line numbers, read-only → nút "Sửa" → textarea → Lưu; text cắt ở 512 KiB, highlight bỏ qua khi > 256 KiB. PDF preview packaged (Chromium PDFium; mặc định ẩn toolbar + fit-to-width). Office xem an toàn (read-only): DOCX (text), XLSX **đa sheet** (tab chọn sheet, ẩn sheet hidden), PPTX **high-fidelity** dựng slide (chữ/ảnh/shape/bảng/biểu đồ/theme → HTML/SVG bằng engine cục bộ, điều hướng trước/sau, fallback text khi lỗi; `.ppt` legacy không hỗ trợ; PO quan sát packaged 2026-07-17, gồm ảnh nhúng). Live refresh: auto-refresh navigator sau verified mutation; auto-open ≤1 safe file/turn (bỏ ngoài-workspace/secret/unsupported); verified-delete xoá file đang mở → clear + chặn recreate; dirty-edit conflict (giữ bản đang sửa + cảnh báo ghi đè bền vững / tải lại từ đĩa). Không có Office editor; không hiển thị đúng 100% (PPTX text-first); không đảm bảo mọi PDF/Office file (malformed/password/encrypted). |
| Provider profiles | WORKS — BASIC | Verified fingerprint + status bar. |
| Local database | WORKS | Settings/credentials/conversations/MCP config in SQLite vault. |
| Local app authentication | WORKS | Unlock + encrypted vault master key. |
| Conversations | WORKS — SQLite | Wave 0B. |
| Skills | WORKS — Hub | Rail `Kỹ năng & MCP` below Cowork; removed from Settings/composer selectors. Catalog is the one Skill system; extension Skill registry deprecated. |
| MCP | WORKS — Phase 1 | Persistent SQLite + vault header secrets; router mounted; stdio or URL (SSRF); no OAuth; reachability adapter (toolCount 0). |
| OpenCode | PINNED 1.18.1 | Server-contract matrix PASS; fallback 1.17.20 also PASS. |
| MS365 | SOURCE PRESENT | Vault tokens after unlock. |
| Inspector | WORKS — Phase 1 | Cowork-only pane: Kế hoạch/Hoạt động/Tệp(+Xem lại) from normalized EV events (no raw SSE/token/tool payloads), reuses File Work Review, clear empty/loading/error states, persists across reopen. PO-observed 2026-07-17. |
| Logging/telemetry | WORKS — Wave 6 | Local rotating redacted file logs under `data/logs` ("Ghi log chi tiết" → service debug); local-only aggregate telemetry (SQLite counters, allowlist, toggle gates collection); Settings → Chẩn đoán shows status/counters with redacted Export (save dialog) + Clear. No network egress. PO-observed 2026-07-17. |

## Security direction

- No plaintext API/MS365/MCP secret in SQLite.
- MCP header secrets use vault accounts `mcp:<id>:header` only.
- Renderer never accesses database or secret bytes.
