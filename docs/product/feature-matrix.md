---
language: "en"
status: "active"
updated_at: "2026-07-18"
owner: "product"
---

# Feature Matrix

Per-surface inventory derived from code. Status taxonomy: IMPLEMENTED · WIRED-UNVERIFIED · PARTIAL ·
PLACEHOLDER/DORMANT · NOT IMPLEMENTED · DEFERRED · EXTERNAL. "Packaged evidence" = observed in the
packaged app by the Product Owner. Concise truth lives in `current-status.md`; this is the detail.

Legend for Persistence/Network: SQLite · vault · file · none / none · loopback · LAN · cloud.

| Feature | Surface | User flow | Status | Frontend | Backend | Persistence | Network | External dep | Packaged evidence | Limits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Local auth / unlock | Unlock screen | Set/enter passphrase → vault unlock | IMPLEMENTED | `app/ui` shell | `service/src` vault | vault (in SQLite) | none | — | Yes (Wave 0A/0B) | First-run onboarding gap tracked (see known-limitations) |
| Cowork chat | Cowork | Prompt → streamed answer, history, cancel | IMPLEMENTED | `app/ui` cowork view | `service` → `opencode.exe` | SQLite | loopback + provider | LLM provider | Yes | Live attach gated; clarifications in chat (no Question UI) |
| Conversations/history | Cowork sidebar | New/switch/rename/delete/restore | IMPLEMENTED | `app/ui` | `service` conversation store | SQLite | loopback | — | Yes | Stores messages + durable turn summaries only |
| Provider profiles | Settings → Nhà cung cấp | Save DeepSeek/custom endpoint+token+model; verify | PARTIAL | `app/ui` settings | `service` provider router | SQLite + vault | provider HTTPS | LLM provider | Yes | Model discovery `GET /models` not built (Wave 3) |
| Skills (CRUD) | Kỹ năng & MCP | Built-in read-only + user-local create/edit/delete/enable | IMPLEMENTED | `app/ui` hub | `service` skills catalog | SQLite + file | loopback | — | Yes | On-demand via OpenCode native |
| MCP | Kỹ năng & MCP | Add stdio/URL server; header secrets | PARTIAL (Phase 1) | `app/ui` hub | `service` MCP router | SQLite + vault | loopback/URL | MCP server | Yes | No OAuth; reachability only (`toolCount` 0) |
| Permission modes | Permission UI | Hỏi trước / Tự động / Chỉ đọc | IMPLEMENTED | `app/ui` | `service` PermissionGate | SQLite | loopback | — | Yes | — |
| File Work Review | Activity panel | Verified mutation evidence + diff | IMPLEMENTED | `app/ui` | `service` file review | SQLite | loopback | — | PARTIAL (Journey A–B PASS) | Journey C+ nondeterministic; delete unreliable (OpenCode build) |
| Workspace preview/edit | Workspace | Navigate + preview + edit text/code/PDF/Office | IMPLEMENTED (Wave 4) | `app/ui` workspace | `service` workspace guard | file (workspace) | loopback | — | Yes (PO 2026-07-17) | Read-only Office; no editor; malformed/encrypted not guaranteed |
| Inspector | Cowork pane | Kế hoạch/Hoạt động/Tệp from EV events | IMPLEMENTED (Phase 1) | `app/ui` | `service` EV reducer | SQLite | loopback | — | Yes (PO 2026-07-17) | — |
| Logging/telemetry | Settings → Chẩn đoán | View/export/clear redacted logs + counters | IMPLEMENTED (Wave 6) | `app/ui` | `service` logging | file + SQLite | none | — | Yes (PO 2026-07-17) | Local only; no egress |
| Code surface | Code | Multi-file editor, edit+save, run | WIRED-UNVERIFIED | `app/ui` code | shared Cowork backend | file | loopback | — | **Pending** | Not an IDE; no terminal/Git/LSP (ADR 0013) |
| Web Preview | Code → Web | Static + dev-server preview in hardened view | WIRED-UNVERIFIED | `app/ui` | `service` runtime-preview | file | loopback | — | **Pending** | Command approval required (ADR 0014) |
| Desktop App Launch | Code → Ứng dụng | Build/Run/Stop/Restart an Electron app | WIRED-UNVERIFIED | `app/ui` | `service` runtime-preview | file | loopback | — | **Pending** | Electron only; others `unsupported` (ADR 0015) |
| Dispatch (D1) | Dispatch | Run saved task, fan-out, board, `/dispatch` | PARTIAL | `app/ui` dispatch | `service/src/dispatchers`,`tasks` | SQLite | loopback | LLM provider | No (unit/integration only) | No packaged/live fan-out (Checkpoint 5) |
| Microsoft 365 (D2) | Microsoft tab | Manual-token connect, chat, history, permission cards | PARTIAL | `app/ui` ms tab | `service/src/ms365` | SQLite + vault | Graph HTTPS | Microsoft Graph | No (no live tenant) | OAuth device-code gated; not live-verified |
| Knowledge (D3) — Local KB/Graph MVP | Kho tri thức + Đồ thị | search/graph over active workspace | CODE+TESTS+BUILD PASS (packaged PO obs pending) | `app/ui` knowledge-local-panel + knowledge-graph-view | `service/src/knowledge-local` (repo+indexer+service) + `/v1/knowledge-local` router | SQLite (migration id:4) FTS5 + node/edge tables | loopback (in-service) | index/sync/rebuild/clear/cancel, FTS search, graph | No (fully local) | No embeddings/vector/semantic; no PDF text; keyword only |
| Knowledge (D3) — external M365KG client | (advanced/optional) | — | DORMANT | — | `app/backend` Go + `app/llm-svc` Rust + `service/src/knowledge` (not composed) | Neo4j/PG (designed) | (designed loopback) | — | Yes (external) | Not wired/bundled; separate from the Local KB MVP |
| Gateway (D4) | slot | — | NOT IMPLEMENTED | slot | — | — | — | — | No | Mount boundary only |
| Remote / PWA / Discord | `/remote`, phone PWA | Pair, view, permission, prompt | DEV/DEMO | `app/ui` + `pwa.ts` | `service/src/remote-gateway` | in-memory | LAN (no TLS) | Discord (opt) | No | Dev/demo flags; LAN unencrypted |
| Slash commands | Composer | `/dispatch`, `/remote`, etc. | IMPLEMENTED | `app/ui` composer | `service` routers | — | loopback | — | Partial | Scoped to implemented surfaces |
| Settings | Settings | General/Appearance/Provider/Permissions/Workspace/Logging/Telemetry/Remote/MS365 | IMPLEMENTED | `app/ui` settings | `service` | SQLite | loopback | — | Yes | — |
| Packaging / lifecycle | scripts | init/build/start/stop | IMPLEMENTED | — | `tools/app/cli.mjs` | file (.runtime) | none | — | Yes | Four canonical BATs; exe `coworkghc.exe` |
| Migration / recovery | — | Wave-0A keyring→vault migration | PARTIAL | — | `service` vault | SQLite + keyring | none | — | Partial | Keyring retained for migration |

## Notes

- "Pending" packaged evidence for Code/Web Preview/Desktop App: code + focused tests + `build:app`
  PASS, but no packaged Product-Owner observation yet — do not claim WORKS (see `demo-acceptance.md`).
- D3 is the single largest gap between "code present" and "capability": see
  `../architecture/dependencies-and-services.md §5` and `../architecture/local-first-strategy.md`.
- Negative/recovery-path coverage is tracked in `exhibition-readiness-plan.md §8.3`.
