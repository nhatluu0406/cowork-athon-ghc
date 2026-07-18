---
language: "vi"
status: "active"
updated_at: "2026-07-18"
---

# Trạng thái hiện tại (current truth)

Cowork GHC — ứng dụng desktop AI cowork local-first cho Windows (Electron). Tài liệu này là **sự
thật hiện tại, cô đọng**. Inventory chi tiết theo bề mặt xem `feature-matrix.md`; giới hạn xem
`../quality/known-limitations.md`; kiến trúc/dependency xem `../architecture/`. Lịch sử từng slice
nằm trong Git history (nguồn phục hồi cuối) và `docs/archive/`.

## Bảng sự thật

| Capability | Status | Note |
|---|---|---|
| Cowork chat | WORKS | Streaming tiến trình, history, bounded context; Skills native OpenCode on-demand. |
| Workspace | WORKS (Wave 4) | Xem/sửa text+code; PDF (PDFium packaged); Office read-only DOCX/XLSX đa sheet/PPTX high-fidelity; live-refresh + dirty-conflict. Không có Office editor; không đảm bảo mọi file malformed/encrypted. |
| Provider profiles | WORKS (basic) | DeepSeek preset + custom OpenAI-compatible; verified fingerprint + status bar. Model discovery `GET /models` chưa làm (Wave 3). |
| Local DB + vault | WORKS | SQLite `<userData>/cowork-ghc.db` + AES-256-GCM vault; renderer không chạm DB/secret. |
| Local auth (unlock) | WORKS | Vault master key chỉ trong memory sau unlock. |
| Conversations | WORKS | SQLite (Wave 0B); user-visible messages + durable turn summaries. |
| Skills | WORKS (hub) | Rail `Kỹ năng & MCP`; catalog là hệ Skill duy nhất; extension registry deprecated. |
| MCP | WORKS (Phase 1) | SQLite config + vault header secrets; stdio/URL; no OAuth; reachability adapter (`toolCount` 0). |
| Permission + File Work Review | WORKS | Hỏi trước / Tự động / Chỉ đọc; mutation phải có verified tool result. |
| Inspector | WORKS (Phase 1) | Kế hoạch/Hoạt động/Tệp từ normalized EV events; PO-observed 2026-07-17. |
| Logging/telemetry | WORKS (Wave 6) | Local rotating redacted logs + SQLite counters; no network egress; PO-observed 2026-07-17. |
| Inspector/Code/Web Preview/Desktop App | Code+tests+build PASS, **packaged PO obs pending** | ADR 0013/0014/0015. Chưa claim WORKS tới khi có packaged PO observation. |
| OpenCode runtime | PINNED v1.18.1 | Fallback 1.17.20 PASS. Không upgrade trước compatibility matrix. |
| **D1 Dispatch** | PARTIAL | Loop runner + fan-out + board + `/dispatch` composed; unit/integration với fake seams. **Chưa packaged/live** (Checkpoint 5 mở). |
| **D2 Microsoft 365** | PARTIAL | Manual-token chat + history + in-tab permission cards. Device-code OAuth gated (chưa Azure app reg). **Chưa live tenant/packaged.** |
| **D3 Knowledge/RAG/Graph** | **DORMANT / chưa wired** | Có nhiều code (Go backend + Rust llm-svc + TS stack supervisor/initializer/provisioning) nhưng **không composed, không bundled, chưa chạy với binary thật**. Xem `dependencies-and-services.md §5` + `local-first-strategy.md`. |
| **D4 Gateway** | NOT IMPLEMENTED | Mount boundary only (chủ ý). |
| Remote/PWA/Discord | DEV/DEMO only | Sau flag; LAN chưa TLS; chưa packaged verification. |
| Packaged executable | `coworkghc.exe` | Display name giữ **Cowork GHC**; userData `%APPDATA%\Cowork GHC`. |

## Security direction

- Không plaintext API/MS365/MCP secret trong SQLite; MCP header secrets dùng vault account `mcp:<id>:header`.
- Renderer không truy cập DB/secret bytes; chỉ qua typed preload + capability IPC.
- Outbound qua SSRF policy (HTTPS-only; private/loopback/link-local/metadata blocked). Dev opt-in:
  `COWORK_GHC_DEV_ALLOW_LOOPBACK_HTTP`, `COWORK_GHC_E2E_MOCK_LLM_BASE_URL`.

## Đính chính so với docs cũ

- **D3 không phải "does not implement"** như bản current-status cũ — nó là subsystem lớn nhưng
  **dormant/chưa xác minh**. D1 đã composed (không chỉ seam); D2 partial.
- Persistence là **SQLite + encrypted vault**, không phải "no SQL / Windows Credential Manager" (README cũ).
- Docker chỉ **dev/test**, không phải dependency của app đóng gói.

## Con trỏ

- Inventory chi tiết: [`feature-matrix.md`](./feature-matrix.md)
- Kế hoạch triển lãm: [`exhibition-readiness-plan.md`](./exhibition-readiness-plan.md)
- Kiến trúc: [`../architecture/system-overview.md`](../architecture/system-overview.md),
  [`../architecture/dependencies-and-services.md`](../architecture/dependencies-and-services.md),
  [`../architecture/local-first-strategy.md`](../architecture/local-first-strategy.md)
- Giới hạn: [`../quality/known-limitations.md`](../quality/known-limitations.md)
