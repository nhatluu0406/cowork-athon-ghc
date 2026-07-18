/**
 * Research-workspace scaffolder (Dispatch "Research task", simple slice).
 *
 * Creates a fresh, plain (non-git) workspace folder pre-seeded with a Claude Code-style
 * `.agents/` layout so a research session starts from a known persona + skill instead of a
 * blank directory:
 *   <baseDir>/research-<timestamp>/
 *     .agents/agents/researcher.md      ← the built-in `researcher` persona, materialized
 *     .agents/skills/research/SKILL.md  ← a minimal, read-only research skill
 *
 * This is deliberately small: it only lays down files and returns the path. Wiring it to the
 * active workspace + a Cowork conversation is the caller's job (renderer). Whether the runtime
 * auto-adopts the persona/skill is a follow-up — the files are a real, inspectable starting
 * point either way. The `.agents/skills` frontmatter is Claude Code style (`name`/`description`)
 * to match the skill discovery added in commit 796c2ec.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BUILTIN_AGENTS } from "../agents/builtins.js";

export interface ResearchScaffoldResult {
  /** Absolute path of the created workspace root. */
  readonly rootPath: string;
  /** Absolute paths of the files written, for logging/tests (never secrets). */
  readonly files: readonly string[];
}

/** A filesystem-safe, sortable folder name: `research-2026-07-18-142530-123`. */
export function researchFolderName(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-").replace("T", "-").slice(0, 23);
  return `research-${stamp}`;
}

const RESEARCH_SKILL_MD = `---
name: research
description: Read-only investigation of the workspace — gather evidence with concrete path citations and a short, honest conclusion. No file edits.
---

# Research skill

Use this skill to investigate a goal inside this workspace without changing anything.

## Method
1. Restate the goal in one line and list the assumptions you are making.
2. Read broadly before concluding; cite concrete \`path:line\` references for every claim.
3. Separate what the evidence shows from what you infer.
4. End with a short, ranked conclusion and the open questions that remain.

## Rules
- Read-only: do not edit, create, or delete files.
- Never fake a finding — if the evidence is missing, say so.
`;

function researcherAgentMd(): string {
  const agent = BUILTIN_AGENTS.find((a) => a.id === "researcher");
  const persona =
    agent?.systemPrompt ??
    "Bạn là tác nhân nghiên cứu. Chỉ đọc và phân tích workspace; KHÔNG chỉnh sửa tệp.";
  return `---
name: researcher
description: Read-only research agent (built-in persona). Analyses the workspace and reports findings with path citations; never edits files.
---

${persona}
`;
}

/**
 * Create the research workspace under `baseDir` and return its root path. Uses `mkdir -p`
 * semantics so a missing `baseDir` is created too. Throws on any filesystem failure — the
 * caller reports an honest error rather than pretending init succeeded.
 */
export async function scaffoldResearchWorkspace(
  baseDir: string,
  now: Date = new Date(),
): Promise<ResearchScaffoldResult> {
  const rootPath = join(baseDir, researchFolderName(now));
  const agentsDir = join(rootPath, ".agents", "agents");
  const skillDir = join(rootPath, ".agents", "skills", "research");
  await mkdir(agentsDir, { recursive: true });
  await mkdir(skillDir, { recursive: true });

  const agentFile = join(agentsDir, "researcher.md");
  const skillFile = join(skillDir, "SKILL.md");
  await writeFile(agentFile, researcherAgentMd(), "utf8");
  await writeFile(skillFile, RESEARCH_SKILL_MD, "utf8");

  return { rootPath, files: [agentFile, skillFile] };
}
