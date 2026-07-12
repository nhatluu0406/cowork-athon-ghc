# Verification Output Contract

Applies to the Release Verifier and to any loop/task VERIFY step.

Verification exercises the real artifact end-to-end and observes behavior. It does
not rely on the dev server alone as final evidence, and it does not make large
feature changes during final verification.

## Output structure

```text
Verification target: <loop-id | task-id | release>
Environment: <OS, node/tool versions, packaged vs dev>
Result: PASS | PARTIAL | FAIL

Checks:
- <check name>: PASS|FAIL — <observed behavior> — evidence: <path/screenshot/log>

Windows scripts (when in scope):
- init.bat:  PASS|FAIL — <observed>
- start.bat: PASS|FAIL — <observed>
- stop.bat:  PASS|FAIL — <observed>
- clean.bat: PASS|FAIL — <observed; confirm preserved paths intact>

Summary: <one paragraph>
Blocking issues: <list or "none">
```

## Rules

- Report faithfully: if a check failed, say so with the output. If a step was
  skipped, say it was skipped and why.
- A `PASS` means observed behavior matched acceptance criteria, with evidence.
- `PARTIAL` means core flow works but named gaps remain.
- Evidence is written under `.loop-engineer/evidence/<target>/verification-*.md`.
- Live LLM checks require prior user permission and are bounded (few requests,
  short prompt, low-cost model, no infinite retry, no credential in logs).
