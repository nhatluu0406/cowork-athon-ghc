#!/usr/bin/env python3
"""
context-assembler.py — Focused context builder for /implement

Modes:
  Single task:   --task TASK-BUG-011-01
  Batch (best):  --spec specs/BUG-011 --all-tasks

Flags:
  --format claude|copilot   Output format (default: claude)
  --dry-run                 Print token estimate, no file written
  --max-file-lines N        Max lines per source file
                            (default: 80 for copilot, 150 for claude)
  --max-tasks N             Max tasks per copilot output file (default: 5)

Output:
  claude single: .specify/context/{task-id}.md
  claude batch:  .specify/context/{spec-id}-all.md
  copilot single:.specify/context/{task-id}-copilot.md
  copilot batch: .specify/context/{spec-id}-copilot.md  (or -copilot-1.md etc.)
"""
from __future__ import annotations
import argparse, re, sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

SUPPORTED_EXTENSIONS = {".go",".ts",".tsx",".js",".jsx",".py",
                        ".json",".yaml",".yml",".sh",".md",".sql"}
MAX_FILE_BYTES = 30_000
MAX_FILE_LINES_CLAUDE  = 150
MAX_FILE_LINES_COPILOT = 80
CONTEXT_DIR = Path(".specify/context")


@dataclass
class TaskMeta:
    id: str
    title: str
    description: str = ""
    ac_refs: list[str] = field(default_factory=list)
    design_refs: list[str] = field(default_factory=list)
    scope_packages: list[str] = field(default_factory=list)
    scope_files: list[str] = field(default_factory=list)
    scope_exclude: list[str] = field(default_factory=list)
    inline_acs: str = ""


@dataclass
class ContextSection:
    label: str
    content: str

    @property
    def token_estimate(self) -> int:
        return len(self.content) // 4


# ---------------------------------------------------------------------------
# Parser: tasks.md  (line-by-line, handles --- separators)
# ---------------------------------------------------------------------------

def _parse_one_task(text: str, task_id: str) -> TaskMeta:
    lines = text.splitlines()
    heading_re = re.compile(r"^(#{1,4})\s+(.*)")
    task_start = None
    task_level = 0
    task_header = ""
    for i, line in enumerate(lines):
        m = heading_re.match(line)
        if m and task_id.upper() in line.upper():
            task_start = i
            task_level = len(m.group(1))
            task_header = m.group(2).strip()
            break
    if task_start is None:
        raise ValueError(f"Task '{task_id}' not found")
    body_lines = []
    for line in lines[task_start + 1:]:
        m = heading_re.match(line)
        if m and len(m.group(1)) <= task_level:
            break
        body_lines.append(line)
    body = "\n".join(body_lines)
    title = re.sub(rf"^{re.escape(task_id)}[:\s]*", "", task_header).strip()
    meta = TaskMeta(id=task_id, title=title)

    m = re.search(r"ac_refs\s*:\s*\[([^\]]+)\]", body)
    if m:
        meta.ac_refs = [x.strip() for x in m.group(1).split(",") if x.strip()]
    m = re.search(r"design_refs\s*:\s*\[([^\]]+)\]", body)
    if m:
        meta.design_refs = [x.strip() for x in m.group(1).split(",") if x.strip()]
    scope_m = re.search(r"scope\s*:\s*\n((?:[ \t]+.+\n?)+)", body)
    if scope_m:
        st = scope_m.group(1)
        pm = re.search(r"packages\s*:\s*\n((?:[ \t]+-\s*.+\n?)+)", st)
        if pm:
            meta.scope_packages = [re.sub(r"^\s*-\s*","",l).strip()
                                    for l in pm.group(1).splitlines() if l.strip()]
        fm = re.search(r"files\s*:\s*\n((?:[ \t]+-\s*.+\n?)+)", st)
        if fm:
            meta.scope_files = [re.sub(r"^\s*-\s*","",l).strip()
                                 for l in fm.group(1).splitlines() if l.strip()]
        em = re.search(r"exclude\s*:\s*\n((?:[ \t]+-\s*.+\n?)+)", st)
        if em:
            meta.scope_exclude = [re.sub(r"^\s*-\s*","",l).strip().strip('"\'')
                                   for l in em.group(1).splitlines() if l.strip()]

    if not meta.scope_files and not meta.scope_packages:
        fm = re.search(r"\*\*Files:\*\*\s*\n((?:\s*-\s*`[^`]+`.*\n?)+)", body)
        if fm:
            meta.scope_files = [
                re.sub(r"^\s*-\s*`([^`]+)`.*$", r"\1", l).strip()
                for l in fm.group(1).splitlines() if re.search(r"`[^`]+`", l)
            ]
    if not meta.ac_refs:
        am = re.search(r"\*\*Acceptance Criteria:\*\*\s*\n((?:\s*-\s*\[.\].*\n?)+)", body)
        if am:
            meta.inline_acs = am.group(1).strip()
    return meta


def parse_all_tasks(tasks_path: Path) -> list[str]:
    text = tasks_path.read_text(encoding="utf-8", errors="replace")
    heading_re = re.compile(r"^#{1,4}\s+(?:\[.\]\s+)?(TASK-[A-Z0-9-]+)", re.MULTILINE)
    return [m.group(1) for m in heading_re.finditer(text)]


# ---------------------------------------------------------------------------
# Lookup helpers
# ---------------------------------------------------------------------------

def _extract_block_at(lines: list[str], idx: int) -> str:
    block = [lines[idx]]
    stop = re.compile(r"^#{1,4}\s|^[-*]\s+\*\*[A-Z]{2,}")
    for line in lines[idx+1:]:
        if stop.match(line): break
        block.append(line)
    while block and not block[-1].strip(): block.pop()
    return "\n".join(block)


def lookup_acs(spec_path: Path, ac_refs: list[str]) -> str:
    if not spec_path.exists() or not ac_refs: return ""
    lines = spec_path.read_text(encoding="utf-8", errors="replace").splitlines()
    results = []
    for ac_id in ac_refs:
        found = False
        for i, line in enumerate(lines):
            if ac_id.upper() in line.upper() and (
                re.match(r"^#{1,4}\s", line) or
                re.match(r"^[-*]\s+\*{0,2}" + re.escape(ac_id), line, re.IGNORECASE)
            ):
                results.append(_extract_block_at(lines, i)); found = True; break
        if not found: results.append(f"[{ac_id}: not found in spec.md]")
    return "\n\n".join(results)


def lookup_design(design_path: Path, refs: list[str]) -> str:
    if not design_path.exists() or not refs: return ""
    lines = design_path.read_text(encoding="utf-8", errors="replace").splitlines()
    hr = re.compile(r"^(#{1,4})\s+(.+)")
    results = []
    for ref in refs:
        num = ref.lstrip("§").strip(); found = False
        for i, line in enumerate(lines):
            m = hr.match(line)
            if m and m.group(2).startswith(num):
                level = len(m.group(1)); block = [line]
                for nxt in lines[i+1:]:
                    nm = hr.match(nxt)
                    if nm and len(nm.group(1)) <= level: break
                    block.append(nxt)
                while block and not block[-1].strip(): block.pop()
                results.append("\n".join(block)); found = True; break
        if not found: results.append(f"[{ref}: not found in design docs]")
    return "\n\n".join(results)


# ---------------------------------------------------------------------------
# Code packer
# ---------------------------------------------------------------------------

def _glob_to_re(p: str) -> re.Pattern:
    import fnmatch
    p = p.replace("**", "\x00")
    p = fnmatch.translate(p)
    p = p.replace(re.escape("\x00"), ".*").replace("\\x00", ".*")
    return re.compile(p, re.IGNORECASE)


def _read_file_smart(path: Path, max_lines: int) -> str:
    if path.stat().st_size > MAX_FILE_BYTES:
        return f"// {path.name}: file too large ({path.stat().st_size} bytes), skipped"
    content = path.read_text(encoding="utf-8", errors="replace")
    lines = content.splitlines()
    if len(lines) <= max_lines:
        return content.rstrip()
    truncated = "\n".join(lines[:max_lines])
    return f"{truncated}\n// ... ({len(lines) - max_lines} more lines — read full file if needed)"


def pack_code(repo_root: Path, packages: list[str], files: list[str],
              excludes: list[str], max_lines: int) -> str:
    if not packages and not files: return ""
    excl = [_glob_to_re(p) for p in excludes]

    def excluded(rel: str) -> bool:
        return any(p.search(rel) for p in excl)

    collected: list[tuple[str, str]] = []
    for pkg in packages:
        pp = repo_root / pkg
        if not pp.exists():
            collected.append((pkg, f"// not found: {pkg}")); continue
        for f in sorted(pp.rglob("*")):
            if not f.is_file() or f.suffix not in SUPPORTED_EXTENSIONS: continue
            rel = f.relative_to(repo_root).as_posix()
            if excluded(rel): continue
            collected.append((rel, _read_file_smart(f, max_lines)))
    for fp in files:
        if excluded(fp): continue
        f = repo_root / fp
        if f.exists() and f.is_file():
            collected.append((fp, _read_file_smart(f, max_lines)))
        else:
            collected.append((fp, f"// not found: {fp}"))
    if not collected: return ""
    parts = [f"// {len(collected)} files, max {max_lines} lines each"]
    for rel, content in collected:
        parts.append(f"\n### {rel}\n```\n{content}\n```")
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Assembler
# ---------------------------------------------------------------------------

def assemble_task(repo_root: Path, task: TaskMeta, spec_root: Path,
                  design_root: Path, max_lines: int) -> list[ContextSection]:
    sections: list[ContextSection] = []
    summary = f"# Task: {task.id}\n"
    if task.title: summary += f"**{task.title}**\n"
    sections.append(ContextSection("TASK", summary))

    if task.inline_acs:
        sections.append(ContextSection("ACCEPTANCE CRITERIA", task.inline_acs))
    elif task.ac_refs:
        c = lookup_acs(spec_root / "spec.md", task.ac_refs)
        if c: sections.append(ContextSection("ACCEPTANCE CRITERIA", c))

    if task.design_refs:
        c = lookup_design(design_root / "basic-design.md", task.design_refs)
        if not c.strip() or "not found" in c:
            c = lookup_design(design_root / "detail-design.md", task.design_refs)
        if c: sections.append(ContextSection("DESIGN", c))

    code = pack_code(repo_root, task.scope_packages, task.scope_files,
                     task.scope_exclude, max_lines)
    if code: sections.append(ContextSection("CODE SCOPE", code))
    return sections


# ---------------------------------------------------------------------------
# Renderers — Claude format
# ---------------------------------------------------------------------------

def render_single(task: TaskMeta, sections: list[ContextSection]) -> str:
    total = sum(s.token_estimate for s in sections)
    lines = [f"<!-- task={task.id} tokens~{total} -->", ""]
    for s in sections:
        lines.append(f"\n---\n## {s.label}\n\n{s.content}")
    return "\n".join(lines)


def render_batch(spec_id: str,
                 tasks_sections: list[tuple[TaskMeta, list[ContextSection]]]) -> str:
    total = sum(s.token_estimate for _, secs in tasks_sections for s in secs)
    lines = [
        f"<!-- batch spec={spec_id} tasks={len(tasks_sections)} tokens~{total} -->",
        "",
        f"# Implementation Batch: {spec_id}",
        f"**{len(tasks_sections)} tasks** — implement in order, mark each done before next.",
        "",
    ]
    for task, sections in tasks_sections:
        lines.append(f"\n{'='*60}")
        lines.append(f"## TASK: {task.id}")
        if task.title: lines.append(f"**{task.title}**")
        for s in sections:
            if s.label != "TASK":
                lines.append(f"\n### {s.label}\n\n{s.content}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Renderers — Copilot format
# ---------------------------------------------------------------------------

def render_single_copilot(task: TaskMeta, sections: list[ContextSection]) -> str:
    total = sum(s.token_estimate for s in sections)
    lines = [
        f"# Task: {task.id}",
        f"",
        f"> **Copilot:** Implement ONLY this task.",
        f"> Do NOT use @workspace or @codebase — all context is below.",
        f"> ⚠️  Include `#file:` in your first message only. Remove it from replies.",
        f"> Context: ~{total:,} tokens",
        f"",
    ]
    if task.title:
        lines.append(f"**{task.title}**\n")
    for s in sections:
        if s.label == "TASK": continue
        if s.content.strip():
            lines.append(f"\n## {s.label}\n\n{s.content}")
    lines += [
        f"",
        f"---",
        f"## Instructions",
        f"",
        f"1. Implement changes to satisfy the ACCEPTANCE CRITERIA above.",
        f"2. Only modify files listed in CODE SCOPE.",
        f"3. Follow existing code style.",
        f"4. When done, reply: `{task.id} done` (without #file:)",
    ]
    return "\n".join(lines)


def render_batch_copilot(spec_id: str,
                         tasks_sections: list[tuple[TaskMeta, list[ContextSection]]],
                         part: int = 1, total_parts: int = 1) -> str:
    total = sum(s.token_estimate for _, secs in tasks_sections for s in secs)
    n = len(tasks_sections)
    part_label = f" (Part {part}/{total_parts})" if total_parts > 1 else ""
    first_task = tasks_sections[0][0].id
    last_task  = tasks_sections[-1][0].id
    lines = [
        f"# {spec_id}{part_label}: {first_task} → {last_task}",
        f"",
        f"> **Copilot instructions:**",
        f"> - Do NOT use @workspace or @codebase — all context is in this file.",
        f"> - ⚠️  **First message only**: include `#file:` — remove it from ALL replies.",
        f"> - Implement tasks **in order**, one at a time.",
        f"> - After EACH task: reply `TASK-ID done` (no #file:) before proceeding.",
        f"> - Mark each completed task `[x]` in tasks.md.",
        f"> - Context: ~{total:,} tokens | {n} tasks | Part {part}/{total_parts}",
        f"",
        f"---",
        f"",
    ]
    for i, (task, sections) in enumerate(tasks_sections, 1):
        lines.append(f"\n## Task {i}/{n}: {task.id}")
        if task.title: lines.append(f"**{task.title}**")
        lines.append("")
        for s in sections:
            if s.label == "TASK": continue
            if s.content.strip():
                lines.append(f"\n### {s.label}\n\n{s.content}")
        lines += [
            f"",
            f"> Reply `{task.id} done` (without #file:) to continue.",
            f"",
            f"---",
        ]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Auto-detect spec dir + helpers
# ---------------------------------------------------------------------------

def find_spec(repo_root: Path, task_id: str) -> Optional[Path]:
    specs_dir = repo_root / "specs"
    if not specs_dir.exists(): return None
    for d in sorted(specs_dir.iterdir()):
        tm = d / "tasks.md"
        if tm.exists() and task_id.upper() in tm.read_text(encoding="utf-8", errors="replace").upper():
            return d
    return None


def spec_id_from_dir(spec_dir: Path) -> str:
    name = spec_dir.name
    m = re.search(r"([A-Z]+-\d+)", name.upper())
    return m.group(1) if m else name


def _print_token_summary(label: str,
                          tasks_sections: list[tuple[TaskMeta, list[ContextSection]]]) -> None:
    total = sum(s.token_estimate for _, secs in tasks_sections for s in secs)
    n = len(tasks_sections)
    print(f"\n{'='*52}")
    print(f"Batch: {label}  ({n} tasks)")
    print(f"{'='*52}")
    for task, secs in tasks_sections:
        t = sum(s.token_estimate for s in secs)
        print(f"  {task.id:<30} ~{t:>6,} tokens")
    print(f"  {'─'*48}")
    print(f"  {'TOTAL (1 session)':<30} ~{total:>6,} tokens")
    print(f"  {'vs separate sessions (est.)':<30} ~{total*4:>6,} tokens")
    print(f"  Savings: ~75%")
    print(f"{'='*52}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description="Assemble focused context for task(s)")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--task", help="Single task ID, e.g. TASK-BUG-011-01")
    group.add_argument("--all-tasks", action="store_true",
                       help="Batch all tasks in --spec")
    parser.add_argument("--spec", default=None,
                        help="Spec directory, e.g. specs/BUG-011")
    parser.add_argument("--design", default="docs/design")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--max-file-lines", type=int, default=None,
                        help="Max lines per source file "
                             "(default: 80 for copilot, 150 for claude)")
    parser.add_argument("--max-tasks", type=int, default=5,
                        help="Max tasks per copilot output file (default: 5). "
                             "Use 0 for unlimited.")
    parser.add_argument("--format", choices=["claude", "copilot"], default="claude",
                        help="Output format: claude (default) or copilot")
    parser.add_argument("--repo-root", default=".")
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    design_root = repo_root / args.design

    # Auto default for max_file_lines based on format
    max_file_lines = args.max_file_lines
    if max_file_lines is None:
        max_file_lines = MAX_FILE_LINES_COPILOT if args.format == "copilot" else MAX_FILE_LINES_CLAUDE

    # ── Batch mode ──────────────────────────────────────────────────────────
    if args.all_tasks:
        if not args.spec:
            print("ERROR: --all-tasks requires --spec", file=sys.stderr); return 1
        spec_dir = repo_root / args.spec
        tasks_md = spec_dir / "tasks.md"
        if not tasks_md.exists():
            print(f"ERROR: {tasks_md} not found", file=sys.stderr); return 1
        task_ids = parse_all_tasks(tasks_md)
        if not task_ids:
            print("ERROR: no task IDs found in tasks.md", file=sys.stderr); return 1

        text = tasks_md.read_text(encoding="utf-8", errors="replace")
        tasks_sections: list[tuple[TaskMeta, list[ContextSection]]] = []
        for tid in task_ids:
            try:
                task = _parse_one_task(text, tid)
            except ValueError as e:
                print(f"WARNING: {e}, skipping", file=sys.stderr); continue
            secs = assemble_task(repo_root, task, spec_dir, design_root, max_file_lines)
            tasks_sections.append((task, secs))

        sid = spec_id_from_dir(spec_dir)
        _print_token_summary(sid, tasks_sections)

        if args.dry_run:
            print("\n[dry-run] No file written."); return 0

        out_dir = repo_root / CONTEXT_DIR
        out_dir.mkdir(parents=True, exist_ok=True)

        # Copilot: chunk into parts of --max-tasks
        if args.format == "copilot":
            chunk = args.max_tasks if args.max_tasks > 0 else len(tasks_sections)
            chunks = [tasks_sections[i:i+chunk]
                      for i in range(0, len(tasks_sections), chunk)]
            total_parts = len(chunks)
            print(f"\nGenerated {total_parts} Copilot file(s) "
                  f"({args.max_tasks if args.max_tasks > 0 else 'all'} tasks each, "
                  f"{max_file_lines} lines/file):")
            for part_num, chunk_tasks in enumerate(chunks, 1):
                part_suffix = (f"-copilot-{part_num}" if total_parts > 1
                               else "-copilot")
                out_path = out_dir / f"{sid.lower()}{part_suffix}.md"
                out_path.write_text(
                    render_batch_copilot(sid, chunk_tasks,
                                        part=part_num, total_parts=total_parts),
                    encoding="utf-8"
                )
                t = sum(s.token_estimate for _, secs in chunk_tasks for s in secs)
                rel = out_path.relative_to(repo_root)
                ids = f"{chunk_tasks[0][0].id} → {chunk_tasks[-1][0].id}"
                print(f"\n  Part {part_num}/{total_parts}: [{ids}]  ~{t:,} tokens")
                print(f"  File:  {rel}")
                print(f"  Chat:  #file:{rel}")
                print(f"  ⚠️   Remove #file: from all follow-up replies")
        else:
            out_path = out_dir / f"{sid.lower()}-all.md"
            out_path.write_text(render_batch(sid, tasks_sections), encoding="utf-8")
            rel = out_path.relative_to(repo_root)
            print(f"\nBatch context (claude) -> {rel}")
            print(f"\nUsage: New conversation →")
            print(f"  Read {rel} and implement all tasks in order.")
        return 0

    # ── Single task mode ─────────────────────────────────────────────────────
    task_id = args.task.upper()
    if args.spec:
        spec_dir = repo_root / args.spec
    else:
        spec_dir = find_spec(repo_root, task_id)
        if not spec_dir:
            print(f"ERROR: spec dir not found for {task_id} — use --spec",
                  file=sys.stderr); return 1

    tasks_md = spec_dir / "tasks.md"
    if not tasks_md.exists():
        print(f"ERROR: tasks.md not found at {tasks_md}", file=sys.stderr); return 1

    text = tasks_md.read_text(encoding="utf-8", errors="replace")
    try:
        task = _parse_one_task(text, task_id)
    except ValueError as e:
        print(f"ERROR: {e}", file=sys.stderr); return 1

    sections = assemble_task(repo_root, task, spec_dir, design_root, max_file_lines)
    total = sum(s.token_estimate for s in sections)

    print(f"\n{'='*52}")
    print(f"Task:    {task.id}")
    if task.title: print(f"Title:   {task.title}")
    print(f"Format:  {args.format}  |  Max lines/file: {max_file_lines}")
    print(f"{'='*52}")
    for s in sections:
        print(f"  {s.label:<26} ~{s.token_estimate:>6,} tokens")
    print(f"  {'TOTAL':<26} ~{total:>6,} tokens")
    print(f"{'='*52}")
    if total > 8000:
        print(f"\n⚠️  Large context. Try --max-file-lines 50 or --all-tasks.")

    if args.dry_run:
        print("\n[dry-run] No file written."); return 0

    out_dir = repo_root / CONTEXT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    suffix = "-copilot" if args.format == "copilot" else ""
    out_path = out_dir / f"{task_id.lower()}{suffix}.md"
    content = (render_single_copilot(task, sections)
               if args.format == "copilot"
               else render_single(task, sections))
    out_path.write_text(content, encoding="utf-8")
    rel = out_path.relative_to(repo_root)
    print(f"\nContext ({args.format}) -> {rel}")
    if args.format == "copilot":
        print(f"\nUsage in VS Code Copilot Chat (new chat):")
        print(f"  #file:{rel}")
        print(f'  Implement this task. Reply "{task_id} done" (no #file:) when done.')
    else:
        print(f"\n⚡ New conversation →")
        print(f"  Read {rel} and implement this task only.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
