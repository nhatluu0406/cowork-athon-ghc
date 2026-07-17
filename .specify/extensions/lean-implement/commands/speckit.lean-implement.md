---
name: "speckit-lean-implement"
description: "Token-efficient task implementation. Uses context-assembler to scope context. Always recommend batch mode + fresh session for multi-task work."
argument-hint: "TASK-ID or SPEC-DIR (e.g. TASK-BUG-011-01 or specs/BUG-011)"
user-invocable: true
---

## User Input

```text
$ARGUMENTS
```

Parse user input:
- If matches `TASK-[A-Z0-9-]+` → single task mode
- If matches path like `specs/...` or `BUG-011` → batch mode
- If empty → ask: "Provide a task ID (e.g. TASK-BUG-011-01) or spec dir (e.g. specs/BUG-011)"

---

## ⚠️ Cost Warning — Read First

**DO NOT implement multiple tasks in the same conversation.**

Each task implemented in the same session adds to conversation history.
History accumulates → each subsequent task costs more than the last.
6 tasks in 1 session ≈ 4× more tokens than 6 fresh sessions.

**Rule:**
- 1 task → 1 fresh conversation
- Multiple tasks → use batch mode (1 fresh conversation, all tasks in 1 context file)

---

## Mode A — Single Task

```bash
python .specify/scripts/context-assembler.py --task {TASK_ID}
```

On success, print the token summary. Then tell the user:

```
Context ready: .specify/context/{task-id}.md  (~N tokens)

⚡ IMPORTANT: Start a NEW conversation and run:
   Read .specify/context/{task-id}.md and implement this task only.
   Do not read any other file unless a type/import is missing from context.
```

**Do NOT implement here.** The point of lean-implement is to prepare context for a fresh session.

---

## Mode B — Batch (Recommended for multi-task)

If user provides a spec dir or multiple tasks:

```bash
python .specify/scripts/context-assembler.py --spec {SPEC_DIR} --all-tasks
```

Print the token summary table showing all tasks + total.

Then tell the user:

```
Batch context ready: .specify/context/{spec-id}-all.md  (~N tokens total)

⚡ IMPORTANT: Start a NEW conversation and run:
   Read .specify/context/{spec-id}-all.md and implement all tasks in order.
   For each task:
     1. Implement changes for that task only
     2. Mark task [x] in tasks.md
     3. Do not proceed to next task until current one compiles/tests pass
```

---

## Mode C — Dry-run estimate (use before committing)

```bash
python .specify/scripts/context-assembler.py --task {TASK_ID} --dry-run
python .specify/scripts/context-assembler.py --spec {SPEC_DIR} --all-tasks --dry-run
```

Token thresholds:
- < 4K tokens → excellent
- 4–8K tokens → good
- 8–12K tokens → warning, consider `--max-file-lines 80`
- > 12K tokens → too large, use file scope instead of package scope

If over 8K, suggest:
```bash
python .specify/scripts/context-assembler.py --task {TASK_ID} --max-file-lines 80 --dry-run
```

---

## After Implementation (in the fresh session)

After the user confirms implementation is done, they should run:

```bash
# Update change-log + auto-split if > 500 lines
python .specify/scripts/post-implement.py \
  --task {TASK_ID} \
  --summary "{what was actually changed}" \
  --impact "High|Medium|Low" \
  --spec "{SPEC_DIR}"
```

---

## Summary of Session Strategy

| Scenario | Command | Cost |
|----------|---------|------|
| 1 task | `--task TASK-ID` + fresh session | ~2K tokens |
| 6 tasks (wrong) | 6 prompts same session | ~33K tokens (4× waste) |
| 6 tasks (right) | `--all-tasks` + 1 fresh session | ~8K tokens ✅ |
