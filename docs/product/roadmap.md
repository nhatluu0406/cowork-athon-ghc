---
language: "vi"
status: "active"
updated_at: "2026-07-16"
---

# Roadmap V2 — basic-first, one wave at a time

## WAVE 0A — Local database, app lock and encrypted credentials

- [x] Add SQLite adapter and migrations.
- [x] Implement first-run local account + unlock.
- [x] Implement wrapped vault master key and encrypted secret table.
- [x] Migrate provider and MS365 keys from Windows Credential Manager.
- [x] Move settings/provider profiles/verification state to SQLite.
- [x] Remove keyring dependency only after packaged migration PASS.

## WAVE 0B — Conversation/session persistence migration

- [x] Move conversation summaries/messages/provider snapshots to SQLite.
- [x] Preserve rename/delete/search/reopen behavior.
- [x] Store durable turn summaries, not raw token deltas.
- [x] Import existing `.runtime/conversations`.
- [x] Keep File Work Review snapshots on filesystem with DB references.
- [x] Remove legacy JSON writes after migration PASS.

## WAVE 1 — Chat, Provider UX, Tooltip, Sidebar, Brand and latency truth

- [ ] Refine user/assistant message surfaces.
- [ ] Keep tool/Skill/runtime internals out of visible transcript.
- [ ] Simplify provider actions and verified state.
- [ ] Fix tooltip clipping and sidebar spacing.
- [ ] Render real Cowork logo in topbar/taskbar identity.
- [ ] Benchmark one chat/create/modify turn by timing stage.
- [ ] Do not upgrade OpenCode until timing baseline exists.

## WAVE 2 — OpenCode compatibility + Kỹ năng & MCP Hub

- [x] Test OpenCode 1.18.1 compatibility; fallback target 1.17.20.
- [x] Add `Kỹ năng & MCP` rail surface below Cowork.
- [x] Remove Skills from Settings.
- [x] Remove Skill/MCP selectors from Cowork/Workspace composer.
- [x] Show active summary only in Cowork/Workspace.
- [x] Use OpenCode native Skill load-on-demand.
- [x] Add persistent MCP config and live adapter.
- [x] Phase 1 MCP: local/remote + static encrypted API headers, no OAuth.

## WAVE 3 — Provider model discovery

- [ ] Safe OpenAI-compatible `GET /models`.
- [ ] Searchable combobox.
- [ ] Manual model ID fallback.
- [ ] Cache/invalidate by target fingerprint.
- [ ] Never block save when discovery unsupported.

## WAVE 4 — Workspace PDF and live refresh

- [x] Packaged PDF preview. (Chromium PDFium; default no-toolbar + fit-to-width. Needed:
      `plugins:true`, `style-src 'unsafe-inline'`, and exempting `chrome-extension://` from the
      CSP header stamp so the built-in viewer keeps its own policy.)
- [x] Auto-refresh tree after verified mutation.
- [x] Auto-open created/modified file when safe (≤1 file per turn; never outside-workspace/secret/unsupported/over a dirty buffer).
- [x] Dirty-edit conflict UX (keep-mine + persistent overwrite warning / reload-from-disk warns of edit loss).
- [x] Explicit current-file context in companion chat.
- [x] Verified-delete of the open file clears the preview and blocks accidental recreate.
- [x] Code-file viewing: syntax highlight (highlight.js) + line numbers, read-only with an edit toggle.

## WAVE 5 — Inspector Phase 1

- [ ] Kế hoạch.
- [ ] Hoạt động.
- [ ] Tệp / File Work Review.
- [ ] No raw runtime payloads.
- [ ] Clear loading/error/empty states.

## WAVE 6 — Logging and local telemetry

- [ ] Detailed local structured logs with rotation/redaction.
- [ ] Local-only aggregate telemetry.
- [ ] Export/clear actions.
- [ ] No network telemetry.
- [ ] Diagnostics documentation and acceptance.

## WAITING

- [ ] D1 Dispatch integration.
- [ ] D2 Microsoft 365 product acceptance.
- [ ] D3 Knowledge/RAG integration.
- [ ] D4 Gateway integration.

## DEFERRED

- [ ] MCP OAuth token ownership.
- [ ] Cloud/multi-user authentication.
- [ ] Full Office editing.
- [ ] Web/Next.js.
