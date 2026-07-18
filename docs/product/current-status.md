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
| Auth ON/OFF khởi động | WORKS | Setting **Yêu cầu đăng nhập khi khởi động** (Cấu hình → Chung). **Mặc định BẬT** (hỏi mật khẩu — giữ hành vi hiện tại; fresh + existing installs đều ON đến khi user tự tắt). TẮT = mở thẳng Cowork qua **auto-unlock gắn thiết bị** (Electron safeStorage/DPAPI): wrap thứ hai của master key trong `app_meta`, deviceSecret seal bằng safeStorage ở `<appData>/auto-unlock.seal`; **không lưu key thô, không dùng Windows Credential Manager**, vault vẫn mã hoá, `vault_keys` (password wrap) không bị đụng → recovery bằng mật khẩu luôn còn. Independent security review (2026-07-18, `review/auth-auto-unlock-security`) PASS: envelope/seal đều bất khả dụng nếu chỉ copy DB hoặc chỉ copy seal; interruption giữa envelope↔seal có rollback (test `startup-auth-mode`); packaged smoke ON+OFF + **seal hỏng → fallback mật khẩu (không brick vault)** + **bật lại ON → hiện login, mật khẩu vẫn dùng được** (audit 41/41). |
| Conversations | WORKS | SQLite (Wave 0B); user-visible messages + durable turn summaries. |
| Skills | WORKS (hub) | Rail `Kỹ năng & MCP`; catalog là hệ Skill duy nhất; extension registry deprecated. |
| MCP | WORKS (Phase 1) | SQLite config + vault header secrets; stdio/URL; no OAuth; reachability adapter (`toolCount` 0). |
| Permission + File Work Review | WORKS | Hỏi trước / Tự động / Chỉ đọc; mutation phải có verified tool result. |
| Inspector | WORKS (Phase 1) | Kế hoạch/Hoạt động/Tệp từ normalized EV events; PO-observed 2026-07-17. |
| Logging/telemetry | WORKS (Wave 6) | Local rotating redacted logs + SQLite counters; no network egress; PO-observed 2026-07-17. |
| Inspector/Code/Web Preview/Desktop App | Code+tests+build PASS, **packaged PO obs pending** | ADR 0013/0014/0015. Chưa claim WORKS tới khi có packaged PO observation. |
| OpenCode runtime | PINNED v1.18.1 | Fallback 1.17.20 PASS. Không upgrade trước compatibility matrix. |
| **D1 Dispatch** | WIRED — LIVE DEVICE UNVERIFIED | Loop runner + fan-out + board + `/dispatch` composed; two-column pairing+board surface; `DispatchRunGate` (provider chưa ready → Run bị chặn). `start.bat` bật Remote/LAN cho demo (HTTP no-TLS, có warning). Round-trip unit/integration PASS; **live phone round-trip chưa quan sát**. |
| **D2 Microsoft 365** | PARTIAL | Manual-token chat + history + in-tab permission cards. Device-code OAuth gated (chưa Azure app reg). **Chưa live tenant/packaged.** |
| **D3 Knowledge — Local KB/Graph MVP** | Code+tests+build PASS; **data-rich packaged acceptance PASS** (automated seed workspace, UI audit 21/21) | **Kho tri thức thống nhất theo active Workspace** — chỉ hai tab `Kho tri thức` / `Đồ thị` (KHÔNG có tab nguồn Workspace/Microsoft 365). Local-first trên SQLite (migration id:4): FTS5 keyword search + đồ thị **deterministic** (workspace→folder→file `contains` + `links_to` từ link Markdown), index bounded/cancellable/incremental, secret + dep/build dir loại trừ, scoped theo workspace. **Provenance**: mỗi tài liệu/kết quả/node mang nguồn — **Workspace** (mặc định, local) hôm nay; **Microsoft 365** là nguồn bổ sung tương lai (badge + bộ lọc nguồn + tóm tắt readiness trung thực, **không fake count/data**, không gọi backend). Contracts sẵn sàng ingest MS365 vào cùng kho sau này (không cần migration lớn). **Không** Neo4j/Postgres/Docker/embeddings/LLM. Router `/v1/knowledge-local/*` đã mount; renderer chỉ gọi route local (không chạm mạng/MS365). Packaged UI audit **21/21, 33 ảnh** (no-workspace + đồ thị trống **và data-rich**: index status=ready 7 tài liệu/10 nút/15 liên kết, document list, chi tiết + provenance, FTS search có snippet, đồ thị nút/cạnh + chọn nút, đồng bộ lại prune 7→6, xóa chỉ mục an toàn giữ file gốc; light/dark, không orphan) qua seed workspace cô lập trong audit mode — **không dùng workspace thật, không fake data**. Xem `local-first-strategy.md` (Option 1). |
| **D3 Knowledge — M365 KG (PR #13)** | **OPTIONAL / bảo tồn ngoài main** | Full impl (Go backend + PostgreSQL + Neo4j + JRE provisioning + Rust/Python llm-svc contracts) **bảo tồn ở branch `experimental/m365-knowledge-graph`** (tag `m365-kg-pr13-integration-2026-07`). Default **OFF**; packaged app **KHÔNG** start Go/PG/Neo4j/JRE. `service/src/knowledge/` (REST client cho backend ngoài) **không mount, không bundle**. Blocker: **source `llm-svc` vắng mặt** trong repo, chưa orchestration/package verification. Xem `known-limitations.md`. |
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
