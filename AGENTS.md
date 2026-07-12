# AGENTS.md — Coding Agent Entry Point (Codex and general agents)

This file orients Codex or any general coding agent that is NOT Claude Code. It is a thin adapter:
the neutral source of truth is `.agent-workflow/` + `.loop-engineer/`. Do not assume `.claude/` is
read by non-Claude agents, and do not depend on `.claude/`. A Codex-usable skill lives at
`.agents/skills/loop-engineer/SKILL.md`.

## Current status (read before doing anything) — 2026-07-12
- **Project:** Cowork GHC — desktop AI cowork product for Windows 11. **Desktop POC is the active scope.**
- **Web (Next.js) = `DEFERRED`** (ADR 0007). Do not build it.
- **Loop:** `L6` Implementation = `RUNNING`, gate `PARTIAL`. **Do NOT start L7.**
- **Packaged slices verified:** Slice 1 service lifecycle (`3856a84`); Slice 2 workspace (`ff32d808`, `CGHC-008` DONE); Slice 3 provider/credential (`CGHC-011`, `CGHC-019` DONE); Slice 4 OpenCode live session (`c96b5b8`); HuyTT12 GUI packaged integration (current local work).
- **Next slice:** Continue `CGHC-028` packaged verification: real permission request if emitted, stop/resume/clean, provider-error E2E, template/session resume. Do **not** start L7.
- **Default operating mode = `LEAN`** (see `.agent-workflow/workflow.yaml` → `operating_mode`).
- **Canonical machine state:** `.loop-engineer/state/*.yaml`. **Handoff:** `.loop-engineer/HANDOFF.md`.
- **DeepSeek token:** product owner supplies via secure credential flow (OS keyring); never in chat/source/logs/`.env` commits.

## Read these first
- Canonical workflow: `.agent-workflow/workflow.yaml`
- Loop definitions: `.agent-workflow/loops.yaml`
- Roles (the source of truth for each specialist): `.agent-workflow/roles/`
- Contracts: `.agent-workflow/contracts/` (delegation, review-output, verification-output)
- Schemas: `.agent-workflow/schemas/`
- Research reference (OpenWork analysis): `docs/openwork-requirements-and-basic-design.md`
- Cowork GHC scope (from L1): `docs/product/cowork-ghc-scope-and-acceptance.md`
- Machine state: `.loop-engineer/state/` (authoritative; Markdown views are secondary)

## How to work
1. Read current state: `node tools/loop-engineer/cli.mjs status`.
2. When given a task, apply the named canonical role explicitly. Example:

   ```text
   Act according to:
   .agent-workflow/roles/code-reviewer.md

   Review task: CGHC-042
   Read acceptance criteria and evidence from:
   .loop-engineer/state/tasks.yaml
   ```

3. Follow `.agent-workflow/contracts/delegation.md` for scope boundaries.
4. Reviewer must differ from implementer. Never claim DONE without acceptance +
   tests + independent review + evidence.

## Hard rules
- Cowork GHC is its own product; OpenWork is research reference only (study complete). The OpenWork
  working copy was removed; provenance is in `docs/references/openwork-reference.md`. Do not re-add it
  or treat it as a dependency.
- Release target = **Windows desktop app**. **Next.js / web = `DEFERRED`** (ADR 0007): no Next.js
  install, no `apps/web`, no active web loop, no web-only auth/cloud/companion before activation
  (desktop POC L9 `PASS`, or product-owner request). Web epic = `CGHC-WEB-001` (backlog).
- Documentation language: human-facing `docs/` are written in **Vietnamese** (body + headings), but
  technical identifiers (file/ID/symbol/route/schema/command/env/framework/product names) stay
  **English**. Machine/agent-facing files (`CLAUDE.md`, `AGENTS.md`, `.agent-workflow/**`, `.claude/**`,
  `tools/**`, `.loop-engineer/state/*.yaml`, schema, source/test/config) stay English. A no-meaning
  translation is a `LANGUAGE_ONLY_CHANGE` and must NOT auto-invalidate L1–L4. Full rule:
  `.claude/rules/documentation.md`.
- Secrets never reach logs/UI/screenshots; no API keys in browser local storage.
- Permission is enforced at the execution boundary, not just the UI.
- Windows lifecycle is driven by `scripts/*.bat` (thin entry points → neutral CLI).
- Machine state is YAML under `.loop-engineer/state/`; do not treat Markdown as the
  state machine.

## Controller & lifecycle CLIs
- Loop controller: `node tools/loop-engineer/cli.mjs <status|next|run|task|slice|verify|resume|all|dry-run|bootstrap|invalidate>`
- Lifecycle (scripts call this): `node tools/loop-engineer/lifecycle.mjs <init|start|stop|clean|status>`
