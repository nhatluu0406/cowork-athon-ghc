---
name: cowork-ghc-governance
description: Cowork GHC's real governing documents are AGENTS.md/CLAUDE.md/.agent-workflow/roles — the repo's .specify constitution.md is stale and belongs to a different subsystem
metadata:
  type: project
---

`.specify/memory/constitution.md` in this repo is titled "RAD Knowledge Gateway — Project Constitution" and references `specs/REQ-003-engineering-knowledge-system/FR-38/` — a path that does not exist in this repo. It predates both REQ-204 and Cowork GHC and is **not** the governing document for either. Its INVARIANTs (atomic visibility, determinism, crash safety, source traceability) are generically sound and worth applying as good practice, but do not treat it as a formally-binding gate for Cowork GHC or M365KG work — doing so produces false conflicts in a `/speckit.analyze`-style pass.

Cowork GHC's actual governance:
- `AGENTS.md` / `CLAUDE.md` — LEAN single-agent mode by default, no fan-out for routine work, independent review required only for credential/security changes, runtime/process changes, release-critical packaged changes, or large architecture changes. Loop Engineer (`.loop-engineer/`) is maintenance-only; don't start L7 automatically.
- `.agent-workflow/roles/*.md` — short (15-40 line) role definitions with hard rules, e.g.: UI is a client of the local service (no business logic in components); permission checked at the execution boundary, not just UI; one credential store (Windows keyring via `@napi-rs/keyring`); one owner per child-process lifecycle; no secrets in browser local storage. Roles: `product-architect`, `runtime-llm-engineer`, `frontend-desktop-engineer`, `test-engineer`, `release-verifier`, `code-reviewer`, `security-reviewer`, `ux-performance-reviewer`, `repository-researcher`.
- `docs/product/current-status.md` / `docs/product/productization-roadmap.md` — canonical, actively-maintained status/roadmap (language: Vietnamese-first for `current-status.md`'s content, though doc frontmatter/structure is English-navigable). Check these before assuming what phase/slice is "current."

**Why:** matching precedent set by an already-established governance model beats importing a generic constitution template.

**How to apply:** When planning any Cowork GHC-touching REQ, cite `.agent-workflow/roles/*.md` for module-ownership/rule compliance instead of (or in addition to) `.specify/memory/constitution.md`, and check `docs/product/current-status.md` for whether the work fits the active roadmap phase or needs explicit PO framing as a new initiative.
