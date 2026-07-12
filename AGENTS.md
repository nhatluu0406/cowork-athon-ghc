# AGENTS.md - Coding Agent Entry Point

Cowork GHC is a Windows desktop AI cowork product. The packaged POC baseline is `poc-v0.1`.

## Read First

1. `docs/product/current-status.md`
2. `docs/product/productization-roadmap.md`
3. The relevant file in `docs/architecture/` or `docs/quality/`
4. The current Git diff: `git status --short` and `git diff`

## Working Mode

- Use `LEAN` single-agent mode by default.
- Do not use broad fan-out or subagents for routine work.
- Use focused tests for the slice you touch.
- Use packaged verification for user-facing acceptance.
- Commit at meaningful product-slice boundaries.
- Independent review is required only for credential/security changes, runtime/process changes,
  release-critical packaged changes, or large architecture changes.

## Loop Engineer Status

`.loop-engineer/` is now `MAINTENANCE_ONLY`: historical state, evidence, and optional verification tooling.
Do not start the old Loop Engineer workflow unless the product owner explicitly asks for it.
`node tools/loop-engineer/cli.mjs verify` may still be used as a lightweight state check.

Do not start `L7` automatically. Web / Next.js remains `DEFERRED`.

## Safety

- Never commit `.env`, API keys, runtime tokens, package output, fixture profiles, or private user data.
- Secrets must not appear in logs, screenshots, UI state, docs, or command-line arguments.
- The final credential source is Windows keyring.
- Cowork GHC is its own product; OpenWork is research reference only.
