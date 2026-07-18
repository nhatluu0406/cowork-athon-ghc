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
| Cowork chat | Cowork | Prompt → streamed answer, history, cancel | IMPLEMENTED | `app/ui` cowork view | `service` → `opencode.exe` | SQLite | loopback + provider | LLM provider | Yes | Live attach gated; clarifications in chat (no Question UI); new/switch conversation uses commercial DOM confirm modal (#27 chatbox-focus fix) |
| Conversations/history | Cowork sidebar | New/switch/rename/delete/restore | IMPLEMENTED | `app/ui` | `service` conversation store | SQLite | loopback | — | Yes | Stores messages + durable turn summaries only |
| Provider profiles | Settings → Nhà cung cấp | Save DeepSeek/custom endpoint+token+model; verify | PARTIAL | `app/ui` settings | `service` provider router | SQLite + vault | provider HTTPS | LLM provider | Yes | Model discovery `GET /models` not built (Wave 3) |
| Skills (CRUD) | Kỹ năng & MCP | Built-in read-only + user-local create/edit/delete/enable | IMPLEMENTED | `app/ui` hub | `service` skills catalog | SQLite + file | loopback | — | Yes | On-demand via OpenCode native |
| MCP | Kỹ năng & MCP | Add stdio/URL server; header secrets; compact catalog rows | PARTIAL (Phase 1 UI); agent-invocation open (#30) | `app/ui` hub (compact rows) | `service` MCP router | SQLite + vault | loopback/URL | MCP server | Yes (UI) | #28 compact catalog (external toggle, overflow menu, health badge, tool count, last-checked, stdio preset combobox); No OAuth; reachability only (`toolCount` 0); agent cannot invoke tools yet (#30) |
| Agent web access | Cowork chat (agent tool) | `webfetch`/`websearch` → permission card → result | INTEGRATED (code+security-review PASS); live smoke pending | permission card | `service/src/files/web-access-guard` + tool-permission-proxy + permission-bridge | none | provider/web HTTPS | web | No (unit + security review only) | #29; `web_access` elevated permission; SSRF pre-gate (loopback/private/link-local/metadata/non-https blocked, fail-closed); one interactive network smoke pending before WORKS |
| Permission modes | Permission UI | Hỏi trước / Tự động / Chỉ đọc | IMPLEMENTED | `app/ui` | `service` PermissionGate | SQLite | loopback | — | Yes | — |
| File Work Review | Activity panel | Verified mutation evidence + diff | IMPLEMENTED | `app/ui` | `service` file review | SQLite | loopback | — | PARTIAL (Journey A–B PASS) | Journey C+ nondeterministic; delete unreliable (OpenCode build) |
| Workspace preview/edit | Workspace | Navigate + preview + edit text/code/PDF/Office | IMPLEMENTED (Wave 4) | `app/ui` workspace | `service` workspace guard | file (workspace) | loopback | — | Yes (PO 2026-07-17) | Read-only Office; no editor; malformed/encrypted not guaranteed |
| Inspector | Cowork pane | Kế hoạch/Hoạt động/Tệp from EV events | IMPLEMENTED (Phase 1) | `app/ui` | `service` EV reducer | SQLite | loopback | — | Yes (PO 2026-07-17) | — |
| Logging/telemetry | Settings → Chẩn đoán | View/export/clear redacted logs + counters | IMPLEMENTED (Wave 6) | `app/ui` | `service` logging | file + SQLite | none | — | Yes (PO 2026-07-17) | Local only; no egress |
| Code surface | Code | Multi-file editor, edit+save, run | WIRED-UNVERIFIED (run path **packaged-observed**) | `app/ui` code | shared Cowork backend | file | loopback | — | Layout captured (shots 05/31/35); the **run** path (Web Preview) has packaged live-run acceptance (see Web Preview row); **editor edit+save live-run still pending** | Not an IDE; no terminal/Git/LSP (ADR 0013) |
| Web Preview | Code → Xem trước | Static + dev-server preview in hardened view | IMPLEMENTED (**PACKAGED-OBSERVED** live-run) | `app/ui` | `service` runtime-preview | file | loopback | — | **Packaged live-run acceptance PASS** (automated audit 2026-07-18, real web fixture): detect `dev` → permission → `npm run dev` → running on real loopback `:60033` → embedded page serves real marker → Kết quả 9 log lines → stop closes port (no orphan) → error mode → Vấn đề `src/app.tsx:12:7` (shots 36–39/60/62/63, light+dark) | Command approval required (ADR 0014); labels localized (F10); dev-server via `<pm> run <script>` allowlist; port detection heuristic |
| Desktop App Launch | Code → Ứng dụng | Build/Run/Stop/Restart an Electron app | WIRED-UNVERIFIED | `app/ui` | `service` runtime-preview | file | loopback | — | Empty/unsupported captured (shot 34); **live-run pending** | Electron only; others `unsupported` (ADR 0015); labels localized (F10) |
| Dispatch (D1) | Dispatch | Run saved task, fan-out, board, `/dispatch` | PARTIAL; #21 open | `app/ui` dispatch | `service/src/dispatchers`,`tasks` | SQLite | loopback | LLM provider | No (unit/integration only) | No packaged/live fan-out; **#21: phone can only message a LIVE session (single-turn) — phone-initiated turns is a larger deferred feature (see known-limitations)** |
| Microsoft 365 (D2) | Microsoft tab | Manual-token connect, chat (shared MarkdownView), history, permission cards | PARTIAL | `app/ui` ms tab | `service/src/ms365` | SQLite + vault | Graph HTTPS | Microsoft Graph | No (no live tenant) | OAuth device-code gated; not live-verified; **#20 chat uses shared Markdown renderer; #19 connection reflects in Knowledge source summary** |
| Knowledge (D3) — Local KB/Graph MVP | Kho tri thức + Đồ thị | Unified store over active workspace; search/graph + provenance | CODE+TESTS+BUILD PASS; **data-rich packaged acceptance PASS (audit 21/21, 33 shots)** | `app/ui` knowledge-local-panel + knowledge-local-graph | `service/src/knowledge-local` (repo+indexer+service) + `/v1/knowledge-local` router | SQLite (migration id:4) FTS5 + node/edge tables | loopback (in-service) | index/sync/rebuild/clear/cancel, FTS search, graph | Yes (audit seed workspace: index/list/search/graph/prune/clear) | 2 tabs only (no source tabs); provenance badge + source filter; Microsoft 365 = honest readiness (no fake, no network); keyword only, no PDF text |
| Knowledge (D3) — external M365KG client | (advanced/optional) | — | DORMANT | — | `app/backend` Go + `app/llm-svc` Rust + `service/src/knowledge` (not composed) | Neo4j/PG (designed) | (designed loopback) | — | Yes (external) | Not wired/bundled; separate from the Local KB MVP |
| Gateway (D4) | Gateway | Manage multi-account API keys, real HTTP proxy, health/metrics | INTEGRATED (code+tests+build PASS); **packaged PO obs pending** | `app/ui/gateway-surface.ts` | `service/src/gateway` (service+store+proxy-server+router) | `gateway.json` refs + **vault** (`gateway:<id>`) | loopback proxy | provider upstreams | No (unit tests only) | PR #16; renderer never sees raw key; loopback-only; honest "off" health; OFF = direct provider; safe disable/port restore |
| Create .docx (documents) | Cowork chat (agent tool) | `create_docx` agent tool → real OOXML .docx | INTEGRATED (code+tests+build PASS); **packaged PO obs pending** | permission card + File Work Review | `service/src/documents` (docx-service + tool-router) + docx plugin | workspace file (verified OOXML) | loopback scoped-token | docx-js | No (unit tests only) | #25; PermissionGate-gated; path-safe/size-capped/no-macro; bounded spec |
| Remote / PWA / Discord | `/remote`, phone PWA | Pair, view, permission, prompt | DEV/DEMO | `app/ui` + `pwa.ts` | `service/src/remote-gateway` | in-memory | LAN (no TLS) | Discord (opt) | No | Dev/demo flags; LAN unencrypted |
| Slash commands | Composer | `/dispatch`, `/remote`, etc. | IMPLEMENTED | `app/ui` composer | `service` routers | — | loopback | — | Partial | Scoped to implemented surfaces |
| Settings | Settings | General/Appearance/Provider/Permissions/Workspace/Logging/Telemetry/Remote/MS365 | IMPLEMENTED | `app/ui` settings | `service` | SQLite | loopback | — | Yes | — |
| Packaging / lifecycle | scripts | init/build/start/stop | IMPLEMENTED | — | `tools/app/cli.mjs` | file (.runtime) | none | — | Yes | Four canonical BATs; exe `coworkghc.exe` |
| Migration / recovery | — | Wave-0A keyring→vault migration | PARTIAL | — | `service` vault | SQLite + keyring | none | — | Partial | Keyring retained for migration |

## Notes

- **Web Preview now has packaged live-run acceptance** (automated audit over a real web fixture,
  2026-07-18): detect → permission → running on a real loopback → embedded real content → output →
  stop (no orphan) → error → parsed problem. "Pending" packaged evidence remains for the **Code
  editor edit+save** and **Desktop App launch (Ứng dụng)** live-run: code + focused tests +
  `build:app` PASS, but no packaged live observation yet — do not claim WORKS (see `demo-acceptance.md`).
- D3 **Local** KB/Graph now has data-rich packaged acceptance (automated seed workspace in audit
  mode). The remaining D3 gap is semantic/embeddings + the external M365KG path: see
  `../architecture/dependencies-and-services.md §5` and `../architecture/local-first-strategy.md`.
- Negative/recovery-path coverage is tracked in `exhibition-readiness-plan.md §8.3`.
