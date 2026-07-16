# Harness Routing Rationale (sdlc-suite Phase 6b)

Generated 2026-07-16. **Scope (user decision 2026-07-16): this session's agents execute the
DISPATCH backlog only** (agent-harness-plan.md Phase 4–5 remnants + dispatch verification).
The full remaining backlog was assessed for routing, but non-dispatch units (remote hardening,
roadmap NOW/NEXT, SSRF save-path follow-up) are deferred — listed at the bottom of
`orchestrator.yaml`, tracked in agent-harness-plan.md / roadmap.md.
Agent-facing file → English (docs language policy).

## Step 0 — Constitution check

No `constitution.md`; the repo's CLAUDE.md + `.claude/rules/*` function as one. Hard floors
merged into `shared/governance.yaml`:

- Independent review REQUIRED for credential/security, runtime/process, release-critical
  packaged, and large architecture changes (CLAUDE.md).
- Packaged verification for user-facing acceptance; `scripts\verify-fast.bat` before commit.
- Never commit secrets; secrets never in logs/UI/screenshots/args (security.md).
- Permission enforced at the execution boundary; one source of truth per state type.

## Step 1 — Axis scores (remaining backlog as a portfolio)

| Axis | Score | Evidence |
|---|---|---|
| Clarity | 2–3 (Med-High) | Every remaining task has written acceptance criteria in agent-harness-plan.md §4 / roadmap NOW |
| Independence | 3 (High) | Plan §5 explicitly lists safe parallelization; units map to distinct modules (service/src/tasks, app/remote-pwa, service/src/remote-gateway, UI surfaces) |
| Risk | 3 (High) for the security slice only | TLS+cert-pinning (2.2), device token → keyring (2.1), SSRF save-path validation; plan mandates independent security review |
| Ambiguity of failure | 1 (Low) | Failures localize to a module; test suites are per-module |

## Step 2 — Route

Priority Risk > Ambiguity > Independence > Clarity, with the composition rule:

**supervisor-worker** (top level, Independence=High) **composed with planner-critic** for the
high-risk security units (Risk=High forces a critic gate) and plain pipeline behavior inside
low-risk workers. This matches the repo's existing rule that only security/runtime/release
changes need independent review — routine slices stay LEAN single-agent.

## Roles → `.claude/agents/*.md` (single source of truth — no parallel role set)

The kit's `agents/{role}/` files are NOT duplicated here: the repo already has role
definitions in `.claude/agents/`. This harness references them; frontmatter now carries
`model:` and `skills:` per role. Orchestrator = **Claude Fable 5** (the interactive session;
model id `claude-fable-5`) — it decomposes, dispatches via the Agent tool, merges results,
and never implements high-risk slices itself without the critic gate.

| Harness role | Agent file | Model | Skills (frontmatter) |
|---|---|---|---|
| orchestrator | (main session) | fable | using-agent-skills, planning-and-task-breakdown |
| worker-service | runtime-llm-engineer | sonnet | incremental-implementation, test-driven-development, api-and-interface-design, systematic-debugging |
| worker-ui / worker-pwa | frontend-desktop-engineer | sonnet | frontend-ui-engineering, frontend-design, incremental-implementation |
| worker-tests | test-engineer | sonnet | test-driven-development, testing-patterns |
| critic (quality) | code-reviewer | opus | code-review-and-quality |
| critic (security) | security-reviewer | opus | security-and-hardening, security-audit |
| planner (design/ADR) | product-architect | opus | spec-driven-development, architecture-decision-records, documentation-and-adrs |
| integration-checker / release gate | release-verifier | sonnet | shipping-and-launch, verification-before-completion |
| researcher (read-only) | repository-researcher | haiku | context-engineering |
| critic (UX/perf) | ux-performance-reviewer | sonnet | performance-optimization, wcag-audit-patterns |

## Flagged inferences (Step 4 ❓)

- Axis scores inferred from the plan documents, not re-confirmed by the PO per task.
- The commercial UI pass (roadmap NEXT) has fuzzier acceptance ("xuất sắc") — if it drifts,
  re-route that unit through planner-critic with ux-performance-reviewer as critic.
