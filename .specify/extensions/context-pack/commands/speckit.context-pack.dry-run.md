---
name: "speckit.context-pack.dry-run"
description: "Show token estimate for a task context without writing output"
argument-hint: "Task ID (e.g. TASK-007)"
---

## Context Pack — Dry Run

Run the context assembler in dry-run mode to estimate token usage before committing to implementation.
Useful for validating scope declarations in tasks.md.

### Step 1: Determine Task ID

Use `$ARGUMENTS` as TASK_ID. If empty, ask the user for a task ID.

### Step 2: Run assembler in dry-run mode

```bash
python .specify/scripts/context-assembler.py --task {TASK_ID} --dry-run
```

### Step 3: Display results

Print the full output. Interpret the results:

- **< 4,000 tokens**: Excellent — very focused context
- **4,000–8,000 tokens**: Good — reasonable scope
- **8,000–12,000 tokens**: Warning — consider narrowing `scope.packages`
- **> 12,000 tokens**: Overloaded — split the task or reduce scope

If CODE SCOPE section is > 80% of total tokens, suggest adding `scope.exclude` patterns
for test files (`**/*_test.go`) or generated files.
