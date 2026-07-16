# CLAUDE.md — Agent Entry Point

## Project identity

Cowork GHC is a **local-first desktop AI workspace for Windows** (Electron): connect an LLM,
pick a workspace, chat with an Agent, control permissions, and co-work on files in one trusted app.

- **Git HEAD + canonical docs in `docs/` are the source of truth.** Do not trust any prompt,
  branch, or commit state that the actual repository contradicts.
- Final acceptance = the **packaged Electron app** plus Product Owner observation, not unit/build
  PASS alone.

## Read first (each task)

1. `git status --short`, current branch, `git log -1`, and the current diff.
2. `docs/README.md` (canonical doc map).
3. `docs/product/current-status.md` — WORKS / PARTIAL / NOT IMPLEMENTED / DEFERRED truth.
4. `docs/product/roadmap.md`, `docs/product/product-plan.md`.
5. The relevant `docs/architecture/*` or `docs/quality/*` document.

Note: `README.md` is stale on persistence/credentials (says "no SQL / Windows Credential Manager").
The DB/vault docs and code below are authoritative; prefer them.

## Workflow

- **LEAN. One Agent implements one bounded, user-visible slice at a time.**
- No Loop Engineer, no routine fan-out, no L0–L10 or broad speculative work.
- Typical task: inspect → smallest user-visible slice → focused tests → build.
- Packaged acceptance only for the main happy path or a milestone.
- Independent review required only for credential/security, runtime/process, release-critical
  packaged, or large architecture changes.
- **Do not push** unless the user explicitly asks.

Commands:

```bash
npm run typecheck        # tsc -b
npm test                 # node --test via tsx
npm run build:app        # renderer + shell
npm run package:win      # packaged Windows build
npm run verify:release   # release regression
scripts\verify-fast.bat  # focused pre-commit checks (run before commit on product code)
```

## Architecture invariants

Runtime chain: `renderer → typed preload → loopback local service → SQLite repos + encrypted vault
→ supervised OpenCode runtime → provider / MCP / workspace`. Code: `app/shell`, `app/ui`,
`core/contracts`, `service/src`, `runtime/src`.

Protect (all confirmed in current code):

- **SQLite is the local source of truth** at `<userData>/cowork-ghc.db` (`service/src/db/`):
  user/settings/provider profiles/encrypted secrets/conversations/messages/Skill state/MCP config.
  Use the centralized data-path resolver; do not hardcode DB paths.
- **Encrypted credential vault** (`vault-crypto.ts`, `vault-credential-store.ts`): scrypt-derived
  KEK wraps an AES-256-GCM vault master key held only in memory after unlock. **No plaintext**
  API/MS365/MCP secret in DB, JSON, renderer, screenshots, or logs. MCP header secrets use vault
  accounts `mcp:<id>:header` only.
- **Renderer never touches the database or secret bytes** — only typed preload + capability IPC.
- Conversations use SQLite; persist user-visible messages and **durable turn summaries only** —
  never raw SSE/token deltas. Conversation identity is independent of ephemeral OpenCode session ids.
- Permission-required file mutations must produce a **verified tool result** (File Work Review);
  assistant prose is never proof of a mutation.
- Filesystem actions stay inside the active workspace boundary.
- **Do not fake D1–D4 capability.** D1 Dispatch / D2 Microsoft 365 / D3 Knowledge-RAG / D4 Gateway
  are mount boundaries only until team merge.
- Do not replace the commercial UI with an older layout. Design skill:
  `.agents/skills/cowork-ghc-commercial-ui/SKILL.md`.
- **Skills live in the `Kỹ năng & MCP` product surface** (rail below Cowork), not Settings, not the
  composer selectors. The Skill catalog is the one Skill system; the extension Skill registry is
  deprecated. Do not move Skills back into Settings.
- **OpenCode is a supervised exact pin: `v1.18.1`** (`runtime/src/pin.ts`; fallback 1.17.20 also
  PASS). Do not upgrade OpenCode on main before a server-contract compatibility matrix passes.

## Current implemented capabilities (per code + current-status)

- Cowork **chat**: progressive streaming, history, bounded context; live attach gated; Skills load
  on-demand via OpenCode native (no full prompt injection).
- **Provider profiles**: multiple saved, DeepSeek preset + custom OpenAI-compatible endpoint/token/
  model, verified fingerprint + status bar.
- **Workspace Companion** (PARTIAL): text/Markdown preview + edit, guarded navigator; PDF/live
  refresh pending.
- **Skills CRUD**: built-in (read-only) + user-local, create/edit/delete/enable/disable via the hub.
- **Permission + File Work Review**: modes Hỏi trước / Tự động trong workspace / Chỉ đọc;
  verified mutation evidence.
- **Persistence + security**: SQLite vault, local unlock/auth, Wave 0A/0B landed.
- **MCP (Phase 1)**: persistent SQLite config + vault header secrets, router mounted, stdio or URL,
  no OAuth, reachability-only adapter (`toolCount` 0).
- Commercial desktop UI (light/dark, native titlebar). MS365 source present (vault tokens after unlock).

## Known limitations / roadmap focus

- OpenCode compatibility gating before any upgrade.
- `Kỹ năng & MCP` hub maturation; MCP OAuth deferred; MCP Phase 1 exposes no tool catalog.
- Provider **model discovery** (`GET /models` + manual fallback) — Wave 3, not yet done.
- Workspace **PDF preview + live refresh** — Wave 4.
- **Inspector Phase 1** (plan/activity/file review) — Wave 5, currently PARTIAL.
- Local structured **logging/telemetry** — Wave 6, PARTIAL.
- **File delete does not work reliably**: the pinned OpenCode build agent exposes no `delete`/
  `patch`/`apply_patch` tool, so "xoá file" turns can falsely claim success. Not a demo blocker;
  do not enable `bash` to work around it. See `docs/quality/known-limitations.md`.
- Web / Next.js remains **DEFERRED**.

## Working rules

- Before every task: read Git status, branch, HEAD, and the relevant code. Trust the repo over any
  older prompt.
- Do not expand scope; no broad refactor inside a bug-fix task.
- When resolving conflicts, do not bulk-apply `ours`/`theirs`.
- Do not claim PASS just because tests/build pass — user-facing work needs packaged evidence.
- Do not generate reports or screenshot matrices unless asked.
- Never delete or stash the user's uncommitted changes; never force-push or delete branches.
- **Never** commit `.env`, API keys, runtime tokens, package output, fixture profiles, or private
  user data. Keep secrets out of logs, UI state, docs, and command-line arguments.
- Keep the final report short: files changed, decisions, tests/build, commit, remaining issues.
