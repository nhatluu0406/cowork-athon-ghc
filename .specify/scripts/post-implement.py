#!/usr/bin/env python3
"""
post-implement.py — Update change-log after task completion, then check doc sizes.

Usage:
  python .specify/scripts/post-implement.py \
      --task TASK-BUG-011-01 \
      --type "Bug Fix" \
      --summary "Fix orchestrator gitClient scope — use per-repo path" \
      --impact "High — multi-repo indexing now works"

  python .specify/scripts/post-implement.py --task TASK-BUG-011-01 --summary "Fix X"
"""
from __future__ import annotations
import argparse, re, subprocess, sys
from datetime import datetime
from pathlib import Path

CHANGELOG = "docs/history/change-log.md"
SPLIT_SCRIPT = ".specify/scripts/split-doc.py"
SPLIT_LIMIT = 500

# Derive REQ/BUG/CR ID from task ID
def extract_req_id(task_id: str) -> str:
    # TASK-BUG-011-01 → BUG-011
    # TASK-REQ-002-03 → REQ-002
    # TASK-CR-018-01  → CR-018
    m = re.match(r"TASK-([A-Z]+-\d+)", task_id, re.IGNORECASE)
    return m.group(1).upper() if m else task_id

def infer_type(req_id: str) -> str:
    if req_id.startswith("BUG"): return "Bug Fix"
    if req_id.startswith("CR"):  return "Change Request"
    return "Feature"

def append_to_unreleased(changelog: Path, req_id: str, entry_type: str,
                          summary: str, impact: str, date: str) -> None:
    text = changelog.read_text(encoding="utf-8", errors="replace")

    # Find the Unreleased table — look for the header row
    # Table pattern: line starting with |date|ID|Type|...
    table_header_re = re.compile(r"^\|\s*Date\s*\|", re.MULTILINE)
    m = table_header_re.search(text)
    if not m:
        # No table found — append after "## Unreleased" heading
        text = text.replace(
            "## Unreleased\n",
            f"## Unreleased\n\n| Date | ID | Type | Summary | Impact |\n|---|---:|---|---|---|\n"
        )
        m = table_header_re.search(text)

    # Find the separator line after header
    sep_m = re.search(r"\|[-|: ]+\|\n", text[m.start():])
    if sep_m:
        insert_pos = m.start() + sep_m.end()
    else:
        insert_pos = m.end()

    new_row = f"|{date}|{req_id}|{entry_type}|{summary}|{impact}|\n"
    text = text[:insert_pos] + new_row + text[insert_pos:]
    changelog.write_text(text, encoding="utf-8")
    print(f"[post-implement] Appended to {changelog}: {req_id} — {summary[:60]}")

def run_split(repo_root: Path, *files: str) -> None:
    script = repo_root / SPLIT_SCRIPT
    if not script.exists():
        print(f"[post-implement] split-doc.py not found, skipping size check")
        return
    for f in files:
        path = repo_root / f
        if path.exists():
            result = subprocess.run(
                [sys.executable, str(script), f, "--limit", str(SPLIT_LIMIT)],
                cwd=repo_root, capture_output=True, text=True
            )
            if result.stdout: print(result.stdout.rstrip())
            if result.stderr: print(result.stderr.rstrip(), file=sys.stderr)

def main() -> int:
    parser = argparse.ArgumentParser(description="Update change-log after task implementation")
    parser.add_argument("--task", required=True, help="e.g. TASK-BUG-011-01")
    parser.add_argument("--type", dest="entry_type", default=None,
                        help="Entry type: Bug Fix | Feature | Change Request")
    parser.add_argument("--summary", required=True, help="One-line summary")
    parser.add_argument("--impact", default="Medium", help="Impact level")
    parser.add_argument("--spec", default=None, help="Spec dir for tasks.md size check")
    parser.add_argument("--repo-root", default=".")
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    req_id = extract_req_id(args.task)
    entry_type = args.entry_type or infer_type(req_id)
    date = datetime.now().strftime("%Y-%m-%d")

    changelog = repo_root / CHANGELOG
    if changelog.exists():
        append_to_unreleased(changelog, req_id, entry_type, args.summary, args.impact, date)
    else:
        print(f"[post-implement] {CHANGELOG} not found, skipping history update", file=sys.stderr)

    # Check doc sizes and split if needed
    files_to_check = [CHANGELOG]
    if args.spec:
        spec_dir = args.spec.rstrip("/")
        for f in ["spec.md", "plan.md", "tasks.md"]:
            files_to_check.append(f"{spec_dir}/{f}")

    run_split(repo_root, *files_to_check)
    return 0

if __name__ == "__main__":
    sys.exit(main())
