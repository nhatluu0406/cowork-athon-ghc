---
name: "speckit.context-pack.run"
description: "Assemble focused context for a task using context-assembler.py"
argument-hint: "Task ID (e.g. TASK-007). Auto-detected from tasks.md if omitted."
---

## Context Pack — Run

This command assembles a focused, token-efficient context file for a specific task.
It performs structured lookup (no semantic search needed) to pack:
- Acceptance Criteria referenced by the task
- Design sections referenced by the task
- Source code in the task's declared scope

### Step 1: Determine Task ID

If `$ARGUMENTS` is provided, use it as TASK_ID.
Otherwise, read the current tasks.md and identify the next incomplete task (first `- [ ]` entry).

### Step 2: Check assembler exists

Check if `.specify/scripts/context-assembler.py` exists in the repo root.
If not found, print a warning and stop:
```
⚠ context-assembler.py not found at .specify/scripts/context-assembler.py
  Skipping context assembly. Run /speckit-implement without focused context.
```

### Step 3: Run assembler

Execute the following command from the repo root:

```bash
python .specify/scripts/context-assembler.py --task {TASK_ID}
```

Capture stdout. The output contains a token estimate table like:
```
==================================================
Task:    TASK-007 — Add reranker support
==================================================
  TASK                      ~    120 tokens
  ACCEPTANCE CRITERIA       ~    380 tokens
  DESIGN                    ~    650 tokens
  CODE SCOPE                ~  4,200 tokens
  TOTAL                     ~  5,350 tokens
==================================================

Context written → .specify/context/task-007.md
```

### Step 4: Report and hand off

Print the token summary from stdout.

Then output:

```
✓ Context assembled → .specify/context/{task-id}.md
  Use this file as the primary context for implementing {TASK_ID}.
  Proceed to /speckit-implement.
```

The generated `.specify/context/{task-id}.md` will be automatically read by
`/speckit-implement` in its step 3a (Context Assembly).

### Failure handling

If the script exits with a non-zero code:
- Print the error output
- Output: `⚠ Context assembly failed — /speckit-implement will use manual context loading (fallback).`
- Do NOT block the implementation workflow

### Notes

- Tasks without `scope`, `ac_refs`, or `design_refs` fields will produce a minimal context
  (task summary only). This is expected for tasks added before the context-pack extension.
- To add context fields to an existing task, edit tasks.md and add the fields under the task header.
  See `.specify/templates/tasks-template.md` for the field format.
