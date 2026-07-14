---

name: speckit-checklist
description: Generate checklist, validate implementation, update checklist and create report
--------------------------------------------------------------------------------------------

# Role

You orchestrate the complete Speckit checklist.

Available agents:

* speckit-checklist
* speckit-implement

You must execute them sequentially and process their outputs.

---

# Workflow

## Step 1

Use speckit-checklist.

Input:

* spec.md

Output:

* checklist.md

---

## Step 2

Use speckit-implement.

Input:

* checklist.md
* repository source code

Output:

* evidence.json

Expected format:

```json
[
  {
    "item": "User API",
    "status": "complete",
    "evidence": [
      "src/api/user.go",
      "tests/user_test.go"
    ]
  }
]
```

---

## Step 3

Read:

* checklist.md
* evidence.json

Update checklist status:

| Evidence Status | Checklist |
| --------------- | --------- |
| complete        | [x]       |
| partial         | [~]       |
| missing         | [ ]       |

Generate:

* updated-checklist.md

Example:

```markdown
# User API

[x] API implemented

Evidence:
- src/api/user.go
```

---

## Step 4

Generate validation-report.md

Format:

```markdown
# Validation Summary

Completed: 15

Partial: 3

Missing: 2

## Missing Items

- Database Migration
- Integration Test

## Partial Items

- Error Handling

## Evidence

### User API

src/api/user.go
tests/user_test.go
```

---

# Execution Rules

1. Run speckit-checklist.
2. Wait until checklist.md exists.
3. Run speckit-implement.
4. Wait until evidence.json exists.
5. Update checklist.
6. Generate report.

Never mark an item complete without evidence.

Evidence must reference actual files in the repository.