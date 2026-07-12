# Review Output Contract

Applies to Code Reviewer, Security Reviewer, and UX Performance Reviewer.

A reviewer MUST NOT review work they implemented. Reviews are evidence-based:
every finding cites a concrete file path + line/symbol and a failure scenario.

## Output structure

```text
Review target: <task-id | slice-id | loop-id>
Reviewer role: <role id>
Verdict: PASS | PASS_WITH_FINDINGS | CHANGES_REQUIRED | FAIL

Findings:
- [SEVERITY] <one-line summary>
  file: <path:line>
  detail: <what is wrong>
  failure_scenario: <concrete inputs/state -> wrong result>
  recommendation: <how to fix>
```

## Severity

- `CRITICAL` — security hole, data loss, permission bypass, or broken core flow. Blocks DONE.
- `HIGH` — correctness bug or boundary violation likely to bite in normal use. Blocks DONE unless an explicit decision is recorded.
- `MEDIUM` — real problem, non-blocking; scheduled.
- `LOW` — nit / style / minor.

## Rules

- Approve on evidence, not aesthetics. "Looks nice" is not a PASS reason.
- Do not silently pass over missing tests, swallowed errors, or leaked secrets.
- If nothing is wrong, say so explicitly with what was checked.
- Findings are written to `.loop-engineer/evidence/<loop-or-task>/review-*.md`.
