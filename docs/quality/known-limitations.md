---
language: "vi"
status: "active"
updated_at: "2026-07-15"
---

# Known limitations

## Chat / permission

- Permission modes exist, but repeated prompt/policy behavior must remain covered by packaged happy-path checks.
- Internal tool and Skill narration may still appear in assistant prose until transcript cleanup is completed.
- Permission automation is intentionally limited; execution boundary remains authoritative.

## Provider

- Current native presets are limited; custom OpenAI-compatible connections require endpoint and model information.
- Model discovery is not yet implemented. Some providers expose OpenAI-compatible `GET /models`; others require model selection in their portal or manual model ID.
- Verified connection state persistence/invalidation policy needs implementation.
- D4 routing, failover, key pool, quota and cost routing are not implemented.

## Workspace

- PDF packaged preview needs hardening across Electron environments.
- DOCX/XLSX are not Office-grade editors.
- Large/binary files remain bounded.
- Agent-driven auto-open/live refresh needs more complete mapping from mutation events to selected file and safe dirty-state handling.

## Inspector

- Inspector shell exists, but Plan, Activity, Permission history, and File Review need a clear Phase 1 data contract and product behavior.

## Logging / telemetry

- `Ghi log chi tiết` and `Telemetry cục bộ` settings are visible, but user-facing documentation, retention, redaction, export/clear behavior, and acceptance are incomplete.
- Telemetry must remain local-only unless a future explicit opt-in remote contract is approved.

## Authentication

- No local sign-in/app-lock screen exists.
- Current POC relies on Windows user/session security and local app profile isolation.

## External integrations

- D1–D4 product surfaces are placeholders/mount points until external team code is merged.

## Release

- Full RC regression, signing, installer polish, updater, and release channels are deferred.
