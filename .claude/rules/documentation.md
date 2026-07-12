# Documentation Rules

## Release target & web scope
- The current release target is the **Windows desktop application**. Finish desktop first.
- **Next.js / web application is `DEFERRED`** (ADR `docs/architecture/decisions/0007-web-application-deferral.md`).
  Do NOT install Next.js, create `apps/web`, add an active web loop, or build web-only
  auth/cloud/deployment/companion services. Do not slow the desktop POC for web feature parity, and do
  not assume a full web app is certainly needed. Web activates only after the desktop POC reaches L9
  `PASS` or on explicit product-owner request. Future web loops `W0`–`W6` are a deferred proposal only
  and must never make `/loop-engineer all` auto-run a web phase.

## Language policy

### Human-facing docs under `docs/` → Vietnamese body
Write the main content in Vietnamese: product requirement, scope, acceptance criteria, architecture
docs, ADRs, master plan, test strategy, security model, performance/integration plans, runbooks,
release checklists, verification reports, retrospectives, user-facing dev docs. New `docs/` files use
Vietnamese headings and a Vietnamese body; frontmatter includes `language: "vi"`.

### Keep these English (never translate)
File/folder names + slugs (kebab-case), frontmatter keys, enum values, Requirement/Task/Loop/ADR IDs,
package/module names, class/function/symbol names, API routes, event names, schema fields, commands,
env vars, config keys, paths, tool/framework/product/protocol names. Do not hard-translate common
technical terms (runtime, provider, adapter, contract, streaming, session, workspace, plugin, skill,
MCP, API, event, state, cache, gateway, retry, failover, load balancing) when translation reduces
clarity; give a short Vietnamese gloss at first use when helpful.

### Machine/agent-facing files stay English (not translated)
`CLAUDE.md`, `AGENTS.md`, `.agent-workflow/**`, `.claude/**`, `tools/loop-engineer/**`,
`.loop-engineer/state/*.yaml`, JSON Schema, source code, test code, config files. Rationale: better
compatibility with Claude Code / Codex / other coding agents, fewer command mistranslations, reusable
roles/workflows, checkable schema/automation. `STATUS.md`, `TASKS.md`, and product-owner reports use
Vietnamese when it does not affect machine state. YAML/JSON remain the machine-readable source of truth.

## New documents
- New `docs/` files: Vietnamese body + Vietnamese headings; English kebab-case filename; English
  frontmatter keys; English enum values; diagram node labels may be Vietnamese but real component names
  stay English; code blocks keep technical language. Do not create a competing second English version
  unless there is a concrete need.
- **ADR structural section headings** (`Context`, `Decision`, `Consequences`, `Alternatives considered`,
  `Requirements traceability`, `Open items`) are a fixed template (MADR/Nygard convention) and function
  as schema/enum-like identifiers — they **may remain English** (an optional Vietnamese gloss is fine).
  The ADR narrative body under those headings is still Vietnamese. Clarified during CGHC-027 (L6).

## Translating existing English docs
- Do NOT mass-translate `docs/` mechanically, and never let translation stall desktop implementation.
- Inventory first: `.loop-engineer/reports/docs-language-audit.md` classifies each doc
  (`CANONICAL_CRITICAL` / `CANONICAL_SUPPORTING` / `REFERENCE_ONLY` / `GENERATED_REPORT` /
  `OBSOLETE_OR_DUPLICATE`). Prioritize before L6: scope, acceptance, architecture design, key ADRs,
  master plan, security model, test strategy.
- Do NOT translate: upstream reference kept for reference (`docs/openwork-requirements-and-basic-design.md`),
  license text, source-pinned content, generated API docs with no value from translation, code samples,
  commands, schemas.
- Work is task `CGHC-DOC-001` (planned in L5), split into small parts. Acceptance: canonical content in
  Vietnamese; identifiers not mistranslated; Requirement/ADR IDs unchanged; no info lost; no new
  inference; Mermaid stays valid; internal links intact; no competing EN/VI source-of-truth; the
  translated file stays the same canonical file; both a technical and a language review are done.

## Language-only change vs semantic delta
- A translation with no meaning change is a `LANGUAGE_ONLY_CHANGE`: store old hash + new hash + reason
  `LANGUAGE_ONLY_CHANGE`, confirm Requirement/ADR IDs and acceptance meaning unchanged, attach review
  evidence. It must NOT auto-invalidate L1–L4 just because a file hash changed.
- If translation reveals an ambiguous/conflicting requirement, a missing boundary, a changed acceptance
  meaning, or stale info: that is a semantic delta — record it, identify affected loops, and invalidate
  only genuinely-dependent loops. Never invalidate the whole project.
