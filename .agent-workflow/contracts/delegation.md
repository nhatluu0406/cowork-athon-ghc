# Delegation Contract

Every delegation from the Loop Engineer Lead to a specialist agent MUST use this
template. Agents may not expand scope on their own. If scope is insufficient, the
agent reports back and the Lead re-scopes.

```text
Task ID:
Goal:
Related requirement:
Vertical slice:
Scope (in):
Out of scope:
Input:
Files allowed to modify:
Dependencies:
Acceptance criteria:
Required tests:
Required evidence:
Expected return payload:
```

## Rules

- The delegated agent works only within "Files allowed to modify".
- Reviewer agents MUST NOT have implemented the code they review.
- Never assign the same file to two implementers at the same time.
- Research/log-heavy work is delegated to subagents; only decisions and synthesis
  return to the main context. Do not return long raw logs.
- If a blocker requires a secret, paid live test, destructive action, destructive
  git change, serious license issue, or an irreducible product decision — stop and
  ask the user; otherwise choose the most reasonable option, record the assumption,
  and continue.

## Return payload

The agent's final message is the return value. It must contain, in order:

1. Outcome: `DONE` | `BLOCKED` | `PARTIAL` | `NEEDS_DECISION`.
2. What changed (file paths + one-line each).
3. Evidence paths written under `.loop-engineer/evidence/`.
4. Test result summary (command + pass/fail counts).
5. Assumptions made.
6. Open findings by severity (Critical / High / Medium / Low).
7. Suggested next step (advisory; the Lead decides).
