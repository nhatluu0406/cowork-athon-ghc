#!/usr/bin/env python3
"""
split-doc.py — Auto-split markdown files exceeding a line limit.

Strategy:
  - Files <= LIMIT lines: no action
  - Files > LIMIT lines: keep header block + most recent entries in original file;
    archive older content to {stem}-archive-{YYYY-MM}-{N}.md

Works for:
  - change-log.md (table at top + ## dated sections below)
  - spec.md, plan.md, tasks.md (## headed sections)

Usage:
  python .specify/scripts/split-doc.py docs/history/change-log.md
  python .specify/scripts/split-doc.py specs/BUG-011/tasks.md --limit 400
  python .specify/scripts/split-doc.py --check docs/history/change-log.md  # exit 1 if over limit
"""
from __future__ import annotations
import argparse, re, sys
from datetime import datetime
from pathlib import Path

DEFAULT_LIMIT = 500
# Lines to keep in the "current" portion after a split (recent content)
KEEP_RECENT = 200


def find_header_end(lines: list[str]) -> int:
    """Return index of last line of the header block (title + table + first separator)."""
    heading_re = re.compile(r"^#{1,4}\s")
    in_table = False
    for i, line in enumerate(lines):
        stripped = line.rstrip()
        if stripped.startswith("|"):
            in_table = True
        elif in_table and not stripped.startswith("|"):
            # First non-table line after table = end of header
            return i
        # If we hit a second heading (dated section) stop
        if i > 0 and heading_re.match(line):
            return i
    return min(5, len(lines))  # fallback


def find_split_points(lines: list[str]) -> list[int]:
    """Return line indices where a top-level section (## heading) starts."""
    heading_re = re.compile(r"^#{1,2}\s")
    return [i for i, line in enumerate(lines) if heading_re.match(line)]


def next_archive_path(original: Path) -> Path:
    month = datetime.now().strftime("%Y-%m")
    stem = original.stem
    parent = original.parent
    n = 1
    while True:
        candidate = parent / f"{stem}-archive-{month}-{n:02d}.md"
        if not candidate.exists():
            return candidate
        n += 1


def split_file(path: Path, limit: int) -> bool:
    """Split if over limit. Returns True if split occurred."""
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines(keepends=True)
    if len(lines) <= limit:
        return False

    header_end = find_header_end(lines)
    split_pts = find_split_points(lines)

    # Find split boundary: keep KEEP_RECENT lines of content + header
    # Walk split points from the end until remaining lines fit
    archive_start = header_end
    for sp in reversed(split_pts):
        kept = len(lines) - sp + header_end
        if kept <= KEEP_RECENT + header_end:
            archive_start = sp
            break

    if archive_start <= header_end:
        # Can't split sensibly (all content is recent)
        print(f"[split-doc] {path}: {len(lines)} lines but no clean split point found — skipping")
        return False

    archive_path = next_archive_path(path)

    # Build archive content: header note + older sections
    archive_lines = [
        f"# Archive: {path.name}\n",
        f"> Archived {datetime.now().strftime('%Y-%m-%d')} — content from line {header_end}–{archive_start-1} of original file.\n",
        f"> Current content continues in [{path.name}]({path.name})\n\n",
    ] + lines[header_end:archive_start]
    archive_path.write_text("".join(archive_lines), encoding="utf-8")

    # Build current content: header + archive notice + recent sections
    notice = (
        f"\n> ⚠️ Older entries archived to [{archive_path.name}]({archive_path.name})\n\n"
    )
    current_lines = lines[:header_end] + [notice] + lines[archive_start:]
    path.write_text("".join(current_lines), encoding="utf-8")

    print(
        f"[split-doc] {path.name}: {len(lines)} → {len(current_lines)} lines "
        f"(archived {archive_start - header_end} lines to {archive_path.name})"
    )
    return True


def check_file(path: Path, limit: int) -> bool:
    """Return True if file is over limit."""
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    over = len(lines) > limit
    if over:
        print(f"[split-doc] WARNING: {path} has {len(lines)} lines (limit {limit})")
    return over


def main() -> int:
    parser = argparse.ArgumentParser(description="Auto-split markdown files over line limit")
    parser.add_argument("files", nargs="+", help="Files to check/split")
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT)
    parser.add_argument("--check", action="store_true", help="Check only, exit 1 if over limit")
    parser.add_argument("--repo-root", default=".")
    args = parser.parse_args()

    root = Path(args.repo_root).resolve()
    any_over = False

    for f in args.files:
        path = root / f if not Path(f).is_absolute() else Path(f)
        if not path.exists():
            print(f"[split-doc] {f}: not found, skipping", file=sys.stderr)
            continue
        if args.check:
            if check_file(path, args.limit):
                any_over = True
        else:
            split_file(path, args.limit)

    return 1 if (args.check and any_over) else 0


if __name__ == "__main__":
    sys.exit(main())
