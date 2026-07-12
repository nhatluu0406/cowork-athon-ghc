# Packaged bootstrap regression fix — settings-only boot

Date: 2026-07-12  
Verifier: Agent Lead (LEAN)

## Finding

**Code regression**, not a stale artifact. Slice 3 packaged verification used an isolated `--user-data-dir` fixture and did not exercise the Product Owner default profile (`%APPDATA%/cowork-ghc`).

With persisted onboarding settings (workspace + provider + credential from Slice 3), automatic boot attempted the **live** OpenCode path first. Live spawn failed (`OpenCode binary not found (ENOENT)`), tiered start did not fall back, and `getBootstrap()` returned an empty handshake → renderer showed:

- `Chưa kết nối được (thiếu cấu hình từ shell)`
- `Shell chưa cung cấp base URL hoặc token.`

## Fix

- **Boot** always starts the Tier-1 **settings-only** service (`ServiceController.start()`).
- **User-gated live connect** (`connectLive` / `restartService`) uses tiered live → settings-only fallback (`ServiceController.startLive()`), including fallback on `RuntimeSpawnError` when enabled.

## Packaged verify

```text
npm run package:win
node tools/verify/bootstrap-packaged.mjs
```

Observed: `settings_only_started` in lifecycle log; renderer **Đã kết nối local service**; workspace + LLM settings UI mounted; relaunch OK; clean stop.
