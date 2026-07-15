---
language: "vi"
status: "active"
updated_at: "2026-07-15"
---

# Roadmap V2 — basic-first, one wave at a time

## WAVE 0A — Local database, app lock and encrypted credentials

- [ ] Add SQLite adapter and migrations.
- [ ] Implement first-run local account + unlock.
- [ ] Implement wrapped vault master key and encrypted secret table.
- [ ] Migrate provider and MS365 keys from Windows Credential Manager.
- [ ] Move settings/provider profiles/verification state to SQLite.
- [ ] Remove keyring dependency only after packaged migration PASS.

## WAVE 0B — Conversation/session persistence migration

- [ ] Move conversation summaries/messages/provider snapshots to SQLite.
- [ ] Preserve rename/delete/search/reopen behavior.
- [ ] Store durable turn summaries, not raw token deltas.
- [ ] Import existing `.runtime/conversations`.
- [ ] Keep File Work Review snapshots on filesystem with DB references.
- [ ] Remove legacy JSON writes after migration PASS.

## WAVE 1 — Chat, Provider UX, Tooltip, Sidebar, Brand and latency truth

- [ ] Refine user/assistant message surfaces.
- [ ] Keep tool/Skill/runtime internals out of visible transcript.
- [ ] Simplify provider actions and verified state.
- [ ] Fix tooltip clipping and sidebar spacing.
- [ ] Render real Cowork logo in topbar/taskbar identity.
- [ ] Benchmark one chat/create/modify turn by timing stage.
- [ ] Do not upgrade OpenCode until timing baseline exists.

## WAVE 2 — OpenCode compatibility + Kỹ năng & MCP Hub

- [ ] Test OpenCode 1.18.1 compatibility; fallback target 1.17.20.
- [ ] Add `Kỹ năng & MCP` rail surface below Cowork.
- [ ] Remove Skills from Settings.
- [ ] Remove Skill/MCP selection from composer.
- [ ] Show active summary only in Cowork/Workspace.
- [ ] Use OpenCode native Skill load-on-demand.
- [ ] Add persistent MCP config and live adapter.
- [ ] Phase 1 MCP: local/remote + static encrypted API headers, no OAuth.

## WAVE 3 — Provider model discovery

- [ ] Safe OpenAI-compatible `GET /models`.
- [ ] Searchable combobox.
- [ ] Manual model ID fallback.
- [ ] Cache/invalidate by target fingerprint.
- [ ] Never block save when discovery unsupported.

## WAVE 4 — Workspace PDF and live refresh

- [ ] Packaged PDF preview.
- [ ] Auto-refresh tree after verified mutation.
- [ ] Auto-open created/modified file when safe.
- [ ] Dirty-edit conflict UX.
- [ ] Explicit current-file context in companion chat.

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
