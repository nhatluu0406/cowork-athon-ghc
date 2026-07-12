# CLAUDE.md - Agent Entry Point

Cowork GHC is a Windows desktop AI cowork product. The active baseline is the packaged POC `poc-v0.1`.

## Read First

1. `docs/product/current-status.md`
2. `docs/product/productization-roadmap.md`
3. The relevant architecture or quality document
4. The current Git diff

## Default Process

Use LEAN single-agent work:

```text
Read current status
→ select one product slice
→ inspect current Git diff
→ implement as one Agent
→ run focused tests
→ run packaged verification when user-facing
→ update current status
→ commit
```

No fan-out for routine work. Use focused tests. Use packaged verification for user-facing acceptance.
Commit at meaningful product-slice boundaries.

Independent review is required only for credential/security changes, runtime/process changes,
release-critical packaged changes, or large architecture changes.

## Loop Engineer

`.loop-engineer/` is `MAINTENANCE_ONLY`: provenance, evidence, and optional verification tooling.
Do not start the old Loop Engineer workflow unless explicitly requested.
Do not start `L7` automatically.

Web / Next.js remains `DEFERRED`.

## Safety

Never commit `.env`, API keys, runtime tokens, package output, fixture profiles, or private user data.
Secrets must not appear in logs, screenshots, UI state, docs, or command-line arguments.
