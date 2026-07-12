# Skills System (Sub-project #4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the complete skills system — JSON skill store, `/skill` command, manager UI with AI-assisted authoring, and composer autocomplete popup — from the Python original, byte-compatible with existing `~/.cowork_local/skills/*.json` files.

**Architecture:** All logic lives in the main process (`src/main/skills/`: store, parse-command, generate), one source of truth, fully unit-tested. `skills-builtin.ts` becomes the `BUILTIN_SKILLS` list; `run-cowork.ts` re-injects the `[[ACTIVE_SKILLS]]` system message every turn (remove-then-insert, port of `_apply_skills`). `cowork:send` parses `/skill` up front and short-circuits with `{info}` for local commands. The renderer adds two modals (manager + editor) and the autocomplete popup — display only.

**Tech Stack:** TypeScript, existing IPC/preload/provider infrastructure, Vitest. No new dependencies.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-12-skills-system-design.md`. Python reference: `OldVersion/src/cowork_local/core/skills.py:30-310`, `core/code_agent.py:77-93`, `ui/chat_panel.py:509-560`, `ui/skills_dialog.py`, `ui/composer.py:63-186`.
- Every shell command that runs `npm`/`npx`/`node` MUST be prefixed with `export PATH="$PATH:/c/Program Files/nodejs"` (bash).
- On-disk format is byte-compatible with Python: `<slug>.json` containing `{"name","description","instructions","enabled"}`, `JSON.stringify(skill, null, 2)` (Unicode NOT escaped — matches `ensure_ascii=False, indent=2`). Skills dir: `~/.cowork_local/skills/`.
- Slug derivation matches Python `Skill.slug`: trim+lowercase, keep Unicode letters/digits and `-_`, every other char → `-`, collapse `-` runs, fallback `'skill'`. Loaded skills default `enabled: false` (opt-in), EXCEPT built-ins which are always `enabled: true`.
- All user-facing message strings in `parseSkillCommand` are verbatim from `skills.py:274-310` (including the Vietnamese "Chưa bật skill nào. Chọn một skill cụ thể:" line). Both AI-generation system prompts are verbatim from `skills.py:189-193` and `:234-237`.
- `activeSkillsText` format verbatim from `skills.py:169-175`: builtins first, each skill `## Skill: <name>\n<instructions.trim()>`, skills with empty instructions skipped, joined with `\n\n`.
- The `[[ACTIVE_SKILLS]]` envelope stays exactly: `` `${ACTIVE_SKILLS_TAG}\nThe user enabled the following skills — follow them:\n\n${skillsText}` ``. Injection is remove-then-insert each turn (port of `_apply_skills`, `code_agent.py:80-93`).
- One-shot `/skill` content composition matches `chat_panel.py:559`: `prefix + '\n\n---\n\n' + <augmented request>` when a prefix applies.
- Skill-generation functions never crash the caller: `generateSkillInstructions` returns `''` on any provider error; `generateSkill` throws only when nothing usable was produced.
- Tool executors/IPC handlers never throw raw into the renderer for expected failures — import/generate errors return `{error: string}`.
- Accepted deviation (documented in spec review): the live user bubble shows the full typed text including the `/skill:` command, while `display` persists the stripped request — the Python original stripped the command in the live bubble too. Cosmetic only.
- All existing tests keep passing (143 as of start); run `export PATH="$PATH:/c/Program Files/nodejs" && npm test` before every commit. All work directly on `master`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/main/skills/store.ts` (create) | `Skill`, `skillSlug`, `SKILLS_DIR`, `loadSkillFile`, `listSkills`, `saveSkill`, `deleteSkill`, `importSkillFile`, `pruneSeededBuiltins`, `activeSkillsText` |
| `src/main/agent/skills-builtin.ts` (modify) | `BUILTIN_SKILLS: Skill[]`, `ACTIVE_SKILLS_TAG`, `activeSkillsMessage(skillsText)` |
| `src/main/skills/parse-command.ts` (create) | `parseSkillCommand` — all 5 forms |
| `src/main/skills/generate.ts` (create) | `generateSkill`, `generateSkillInstructions` |
| `src/main/agent/run-cowork.ts` (modify) | remove-then-insert injection, `RunCoworkOptions.skillsText` |
| `src/main/ipc.ts` (modify) | `/skill` in `cowork:send`, `skills:*` handlers, startup prune |
| `src/preload/index.ts` (modify) | `skills*` bridge functions |
| `src/renderer/index.html`, `index.ts`, `style.css` (modify) | manager modal, editor modal, generate modal, autocomplete popup, `{info}` send flow |

---

### Task 1: `store.ts` + `BUILTIN_SKILLS` refactor

`listSkills`/`pruneSeededBuiltins`/`activeSkillsText` need the built-in list, so this task also converts `skills-builtin.ts`. `activeSkillsMessage` gains a required `skillsText` parameter; `run-cowork.ts:59` gets a minimal compile fix (full injection redesign is Task 4).

**Files:**
- Create: `src/main/skills/store.ts`
- Modify: `src/main/agent/skills-builtin.ts`
- Modify: `src/main/agent/run-cowork.ts:59` (compile fix only)
- Test: `tests/main/skills/store.test.ts`, modify `tests/main/agent/skills-builtin.test.ts`

**Interfaces:**
- Produces: `interface Skill { name: string; description: string; instructions: string; enabled: boolean }`; `skillSlug(name: string): string`; `SKILLS_DIR: string`; `loadSkillFile(filePath: string): Skill | null`; `listSkills(directory?: string): Skill[]`; `saveSkill(skill: Skill, directory?: string, oldName?: string): string`; `deleteSkill(name: string, directory?: string): void`; `importSkillFile(filePath: string, directory?: string): Skill`; `pruneSeededBuiltins(directory?: string): void`; `activeSkillsText(directory?: string): string`; `BUILTIN_SKILLS: Skill[]`; `activeSkillsMessage(skillsText: string): string`.

- [ ] **Step 1: Write the failing tests** — create `tests/main/skills/store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  Skill,
  skillSlug,
  loadSkillFile,
  listSkills,
  saveSkill,
  deleteSkill,
  importSkillFile,
  pruneSeededBuiltins,
  activeSkillsText,
} from '../../../src/main/skills/store';
import { BUILTIN_SKILLS, HTML_DOC_BUILDER_SKILL } from '../../../src/main/agent/skills-builtin';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-'));
});

afterAll(() => {
  // per-test dirs are tiny; leave OS tmp cleanup to the OS
});

function write(name: string, content: string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content, 'utf-8');
  return p;
}

describe('skillSlug', () => {
  it('matches the Python derivation', () => {
    expect(skillSlug('Always Write Unit Tests')).toBe('always-write-unit-tests');
    expect(skillSlug('  Weird -- Name!! ')).toBe('weird-name');
    expect(skillSlug('keep-dash_underscore')).toBe('keep-dash_underscore');
    expect(skillSlug('!!!')).toBe('skill');
    expect(skillSlug('')).toBe('skill');
  });

  it('preserves Unicode letters (Vietnamese)', () => {
    expect(skillSlug('Báo cáo tuần')).toBe('báo-cáo-tuần');
  });
});

describe('loadSkillFile', () => {
  it('reads the Python JSON format verbatim', () => {
    const p = write('my-skill.json', '{\n  "name": "My Skill",\n  "description": "does things",\n  "instructions": "Do the thing.",\n  "enabled": true\n}');
    expect(loadSkillFile(p)).toEqual({ name: 'My Skill', description: 'does things', instructions: 'Do the thing.', enabled: true });
  });

  it('accepts legacy "content" key and defaults enabled to false', () => {
    const p = write('legacy.json', '{"name": "Legacy", "content": "Old body"}');
    expect(loadSkillFile(p)).toEqual({ name: 'Legacy', description: '', instructions: 'Old body', enabled: false });
  });

  it('parses markdown .skill files: name from first heading, whole text as instructions, disabled', () => {
    const p = write('review.skill', '# Code Review Helper\n\nAlways check error handling.');
    expect(loadSkillFile(p)).toEqual({
      name: 'Code Review Helper',
      description: '',
      instructions: '# Code Review Helper\n\nAlways check error handling.',
      enabled: false,
    });
  });

  it('falls back to the file stem when there is no heading', () => {
    const p = write('notes.md', 'just some text');
    expect(loadSkillFile(p)!.name).toBe('notes');
  });

  it('returns null for an unreadable path', () => {
    expect(loadSkillFile(path.join(dir, 'missing.json'))).toBeNull();
  });
});

describe('save / delete / rename / list', () => {
  it('round-trips a skill through save + list with Python-compatible JSON on disk', () => {
    const skill: Skill = { name: 'Tuần Báo', description: 'weekly', instructions: 'Viết báo cáo.', enabled: true };
    const p = saveSkill(skill, dir);
    expect(path.basename(p)).toBe('tuần-báo.json');
    const raw = fs.readFileSync(p, 'utf-8');
    expect(raw).toContain('"Viết báo cáo."'); // Unicode not escaped
    expect(JSON.parse(raw)).toEqual(skill);
    expect(listSkills(dir)).toEqual([skill]);
  });

  it('renames by deleting the old slug file', () => {
    saveSkill({ name: 'Old Name', description: '', instructions: 'x', enabled: false }, dir);
    saveSkill({ name: 'New Name', description: '', instructions: 'x', enabled: false }, dir, 'Old Name');
    const files = fs.readdirSync(dir);
    expect(files).toEqual(['new-name.json']);
  });

  it('deleteSkill removes by name-derived slug and tolerates missing files', () => {
    saveSkill({ name: 'Bye', description: '', instructions: 'x', enabled: false }, dir);
    deleteSkill('Bye', dir);
    deleteSkill('Never Existed', dir);
    expect(listSkills(dir)).toEqual([]);
  });

  it('listSkills excludes skills whose slug collides with a built-in', () => {
    saveSkill({ name: BUILTIN_SKILLS[0].name, description: '', instructions: 'shadow', enabled: true }, dir);
    saveSkill({ name: 'Mine', description: '', instructions: 'x', enabled: false }, dir);
    expect(listSkills(dir).map((s) => s.name)).toEqual(['Mine']);
  });

  it('listSkills returns [] for a missing directory and skips corrupt files', () => {
    expect(listSkills(path.join(dir, 'nope'))).toEqual([]);
    write('broken.json', '{not json');
    // broken.json fails JSON parse -> falls through to text parsing -> still a skill (stem name)
    expect(listSkills(dir).map((s) => s.name)).toEqual(['broken']);
  });
});

describe('importSkillFile', () => {
  it('imports a .skill file and saves it as JSON', () => {
    const src = write('imported.skill', '# Imported One\nBe helpful.');
    const skill = importSkillFile(src, dir);
    expect(skill.name).toBe('Imported One');
    expect(fs.existsSync(path.join(dir, 'imported-one.json'))).toBe(true);
  });

  it('throws a descriptive error for an unreadable file', () => {
    expect(() => importSkillFile(path.join(dir, 'ghost.skill'), dir)).toThrow(/Could not read a skill from/);
  });
});

describe('pruneSeededBuiltins', () => {
  it('deletes only .skill files whose slug matches a built-in', () => {
    write('html-document-builder.skill', '# HTML Document Builder\nseeded copy');
    write('mine.skill', '# Mine\nkeep me');
    saveSkill({ name: 'HTML Document Builder Json', description: '', instructions: 'x', enabled: false }, dir);
    pruneSeededBuiltins(dir);
    const files = fs.readdirSync(dir).sort();
    expect(files).toContain('mine.skill');
    expect(files).not.toContain('html-document-builder.skill');
    expect(files).toContain('html-document-builder-json.json');
  });
});

describe('activeSkillsText', () => {
  it('puts built-ins first, wraps each as "## Skill: <name>", joins with blank lines', () => {
    saveSkill({ name: 'Enabled One', description: '', instructions: 'Rule A.', enabled: true }, dir);
    saveSkill({ name: 'Disabled One', description: '', instructions: 'Rule B.', enabled: false }, dir);
    const text = activeSkillsText(dir);
    const firstBlock = text.split('\n\n')[0];
    expect(firstBlock.startsWith(`## Skill: ${BUILTIN_SKILLS[0].name}`)).toBe(true);
    expect(text).toContain('## Skill: Enabled One\nRule A.');
    expect(text).not.toContain('Disabled One');
  });

  it('skips skills with blank instructions', () => {
    saveSkill({ name: 'Empty', description: '', instructions: '   ', enabled: true }, dir);
    expect(activeSkillsText(dir)).not.toContain('Empty');
  });
});

describe('BUILTIN_SKILLS', () => {
  it('contains the HTML Document Builder as an always-on skill', () => {
    expect(BUILTIN_SKILLS).toHaveLength(1);
    expect(BUILTIN_SKILLS[0]).toEqual({
      name: 'HTML Document Builder',
      description: '',
      instructions: HTML_DOC_BUILDER_SKILL,
      enabled: true,
    });
  });
});
```

- [ ] **Step 2: Update `tests/main/agent/skills-builtin.test.ts`** — `activeSkillsMessage` now takes the text:

Replace the `activeSkillsMessage` describe block with:

```ts
describe('activeSkillsMessage', () => {
  it('wraps the given skills text in the ACTIVE_SKILLS envelope', () => {
    const msg = activeSkillsMessage('## Skill: X\nDo X.');
    expect(msg.startsWith(`${ACTIVE_SKILLS_TAG}\n`)).toBe(true);
    expect(msg).toContain('The user enabled the following skills — follow them:');
    expect(msg).toContain('## Skill: X\nDo X.');
  });
});
```

(Keep the `HTML_DOC_BUILDER_SKILL` verbatim-text tests untouched.)

- [ ] **Step 3: Run to verify failure**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run tests/main/skills/store.test.ts tests/main/agent/skills-builtin.test.ts`
Expected: FAIL — store module missing, `BUILTIN_SKILLS` not exported, `activeSkillsMessage` arity.

- [ ] **Step 4: Implement `src/main/skills/store.ts`**

```ts
import * as fs from 'fs';
import * as path from 'path';
import { CONFIG_DIR } from '../config';
import { BUILTIN_SKILLS } from '../agent/skills-builtin';

export interface Skill {
  name: string;
  description: string;
  instructions: string;
  enabled: boolean;
}

export const SKILLS_DIR = path.join(CONFIG_DIR, 'skills');

/** Port of Python Skill.slug: lowercase, keep Unicode alnum + "-_", else "-", collapse runs. */
export function skillSlug(name: string): string {
  const lowered = String(name || '').trim().toLowerCase();
  let s = '';
  for (const ch of lowered) {
    s += /[\p{L}\p{N}\-_]/u.test(ch) ? ch : '-';
  }
  return s.split('-').filter(Boolean).join('-') || 'skill';
}

/** Load one skill file: JSON (.json or JSON-bodied) or Markdown/plain (.skill/.md/.txt). */
export function loadSkillFile(filePath: string): Skill | null {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
  const stem = path.basename(filePath, path.extname(filePath));
  if (path.extname(filePath).toLowerCase() === '.json' || text.trimStart().startsWith('{')) {
    try {
      const data = JSON.parse(text);
      return {
        name: String(data.name ?? stem),
        description: String(data.description ?? ''),
        // Skills are OFF by default — the user opts in (ticks) to use one.
        instructions: String(data.instructions || data.content || ''),
        enabled: Boolean(data.enabled ?? false),
      };
    } catch {
      // fall through to text parsing
    }
  }
  let name = stem;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith('#')) {
      name = line.replace(/^\s*#+/, '').trim() || name;
      break;
    }
  }
  return { name, description: '', instructions: text.trim(), enabled: false };
}

function builtinSlugs(): Set<string> {
  return new Set(BUILTIN_SKILLS.map((s) => skillSlug(s.name)));
}

export function listSkills(directory: string = SKILLS_DIR): Skill[] {
  if (!fs.existsSync(directory)) return [];
  const builtin = builtinSlugs();
  const files = fs.readdirSync(directory);
  const ordered = [
    ...files.filter((f) => f.toLowerCase().endsWith('.json')).sort(),
    ...files.filter((f) => f.toLowerCase().endsWith('.skill')).sort(),
  ];
  const seen = new Set<string>();
  const out: Skill[] = [];
  for (const fname of ordered) {
    if (seen.has(fname)) continue;
    seen.add(fname);
    const skill = loadSkillFile(path.join(directory, fname));
    if (skill && !builtin.has(skillSlug(skill.name))) out.push(skill);
  }
  return out;
}

export function saveSkill(skill: Skill, directory: string = SKILLS_DIR, oldName = ''): string {
  fs.mkdirSync(directory, { recursive: true });
  if (oldName && oldName !== skill.name) deleteSkill(oldName, directory);
  const filePath = path.join(directory, `${skillSlug(skill.name)}.json`);
  fs.writeFileSync(filePath, JSON.stringify(skill, null, 2), 'utf-8');
  return filePath;
}

export function deleteSkill(name: string, directory: string = SKILLS_DIR): void {
  const filePath = path.join(directory, `${skillSlug(name)}.json`);
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // ignore, matches Python's best-effort unlink
  }
}

export function importSkillFile(filePath: string, directory: string = SKILLS_DIR): Skill {
  const skill = loadSkillFile(filePath);
  if (!skill || !skill.name) {
    throw new Error(`Could not read a skill from: ${filePath}`);
  }
  saveSkill(skill, directory);
  return skill;
}

/** Startup cleanup: remove legacy seeded .skill copies of built-ins (never touches user .json). */
export function pruneSeededBuiltins(directory: string = SKILLS_DIR): void {
  if (!fs.existsSync(directory)) return;
  const builtin = builtinSlugs();
  try {
    for (const fname of fs.readdirSync(directory)) {
      if (!fname.toLowerCase().endsWith('.skill')) continue;
      const skill = loadSkillFile(path.join(directory, fname));
      if (skill && builtin.has(skillSlug(skill.name))) {
        fs.rmSync(path.join(directory, fname), { force: true });
      }
    }
  } catch {
    // best-effort, matches Python
  }
}

/** Built-ins first, each "## Skill: <name>\n<instructions>", blank-line joined. */
export function activeSkillsText(directory: string = SKILLS_DIR): string {
  const skills = [...BUILTIN_SKILLS, ...listSkills(directory).filter((s) => s.enabled)];
  return skills
    .filter((s) => s.instructions.trim())
    .map((s) => `## Skill: ${s.name}\n${s.instructions.trim()}`)
    .join('\n\n');
}
```

- [ ] **Step 5: Rewrite `src/main/agent/skills-builtin.ts`** — keep the `HTML_DOC_BUILDER_SKILL` constant EXACTLY as it is today (do not touch the template literal), replace the rest of the file's exports:

```ts
import type { Skill } from '../skills/store';

// ... HTML_DOC_BUILDER_SKILL constant stays byte-identical here ...

/**
 * Built-in, always-on skills — hidden from the Skills manager, always injected.
 * Mirrors builtin_skills() in the Python original (skill_templates/*.skill).
 */
export const BUILTIN_SKILLS: Skill[] = [
  { name: 'HTML Document Builder', description: '', instructions: HTML_DOC_BUILDER_SKILL, enabled: true },
];

export const ACTIVE_SKILLS_TAG = '[[ACTIVE_SKILLS]]';

export function activeSkillsMessage(skillsText: string): string {
  return `${ACTIVE_SKILLS_TAG}\nThe user enabled the following skills — follow them:\n\n${skillsText}`;
}
```

(`import type` keeps the runtime dependency one-directional: store → skills-builtin only.)

- [ ] **Step 6: Compile fix in `src/main/agent/run-cowork.ts`** — line 59 only:

```ts
import { activeSkillsText } from '../skills/store'; // add to imports

    messages.splice(1, 0, { role: 'system', content: activeSkillsMessage(activeSkillsText()) });
```

(The full remove-then-insert redesign is Task 4 — do not do it here.)

- [ ] **Step 7: Run the full suite**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npm test && npx tsc --noEmit`
Expected: all pass (143 existing — with the two updated skills-builtin assertions — plus the new store tests), tsc clean. Note: `run-cowork.test.ts`'s injection tests assert only the tag prefix, so they keep passing.

- [ ] **Step 8: Commit**

```bash
git add src/main/skills/store.ts src/main/agent/skills-builtin.ts src/main/agent/run-cowork.ts tests/main/skills/store.test.ts tests/main/agent/skills-builtin.test.ts
git commit -m "feat: skill store (Python-compatible JSON) + BUILTIN_SKILLS unification"
```

---

### Task 2: `parse-command.ts`

**Files:**
- Create: `src/main/skills/parse-command.ts`
- Test: `tests/main/skills/parse-command.test.ts`

**Interfaces:**
- Consumes: `listSkills`, `activeSkillsText`, `skillSlug`, `SKILLS_DIR`, `Skill` (Task 1 store); `BUILTIN_SKILLS` (skills-builtin).
- Produces: `interface SkillCommand { prefix: string; request: string; info: string | null }`; `parseSkillCommand(text: string, directory?: string): SkillCommand`.

- [ ] **Step 1: Write the failing tests** — create `tests/main/skills/parse-command.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseSkillCommand } from '../../../src/main/skills/parse-command';
import { saveSkill } from '../../../src/main/skills/store';
import { BUILTIN_SKILLS } from '../../../src/main/agent/skills-builtin';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillcmd-'));
});

describe('parseSkillCommand', () => {
  it('passes ordinary text through untouched', () => {
    expect(parseSkillCommand('hello world', dir)).toEqual({ prefix: '', request: 'hello world', info: null });
  });

  it('/skill:<slug> <request> returns the one-shot prefix and stripped request', () => {
    saveSkill({ name: 'Review Helper', description: '', instructions: 'Check errors.', enabled: false }, dir);
    const r = parseSkillCommand('/skill:review-helper look at app.ts', dir);
    expect(r.info).toBeNull();
    expect(r.prefix).toBe('## Skill: Review Helper\nCheck errors.');
    expect(r.request).toBe('look at app.ts');
  });

  it('matches by exact name as well as slug', () => {
    saveSkill({ name: 'Reviewer', description: '', instructions: 'R.', enabled: false }, dir);
    expect(parseSkillCommand('/skill:Reviewer go', dir).prefix).toContain('## Skill: Reviewer');
  });

  it('/skill:<slug> without a request returns the "selected" info', () => {
    saveSkill({ name: 'Reviewer', description: '', instructions: 'R.', enabled: false }, dir);
    const r = parseSkillCommand('/skill:reviewer', dir);
    expect(r.info).toBe('Skill **Reviewer** selected — add your request, e.g. `/skill:reviewer summarise this file`.');
    expect(r.prefix).toBe('');
  });

  it('unknown slug returns the "not found" info', () => {
    const r = parseSkillCommand('/skill:ghost do it', dir);
    expect(r.info).toBe('Skill `ghost` not found. Type `/skill` to see the available skills.');
  });

  it('/skill lists user skills and built-ins with the right tags', () => {
    saveSkill({ name: 'On Skill', description: 'is on', instructions: 'x', enabled: true }, dir);
    saveSkill({ name: 'Off Skill', description: '', instructions: 'x', enabled: false }, dir);
    const info = parseSkillCommand('/skill', dir).info!;
    expect(info.startsWith('**Available skills**\n')).toBe(true);
    expect(info).toContain('- `/skill:on-skill` — **On Skill**: is on');
    expect(info).toContain('- `/skill:off-skill` — **Off Skill**  _(disabled)_');
    expect(info).toContain('_(built-in, always on)_');
    expect(info).toContain('Apply one with `/skill:<name> <your request>`, or `/skill <your request>` to use all enabled skills.');
  });

  it('/skill <request> applies all enabled skills (built-ins always count)', () => {
    saveSkill({ name: 'On Skill', description: '', instructions: 'Rule.', enabled: true }, dir);
    const r = parseSkillCommand('/skill summarise the doc', dir);
    expect(r.info).toBeNull();
    expect(r.request).toBe('summarise the doc');
    expect(r.prefix).toContain(`## Skill: ${BUILTIN_SKILLS[0].name}`);
    expect(r.prefix).toContain('## Skill: On Skill\nRule.');
  });

  it('multi-line requests survive (DOTALL regex)', () => {
    saveSkill({ name: 'R', description: '', instructions: 'x', enabled: false }, dir);
    const r = parseSkillCommand('/skill:r line one\nline two', dir);
    expect(r.request).toBe('line one\nline two');
  });
});
```

(Note: because `BUILTIN_SKILLS` is never empty, `activeSkillsText` is always non-empty, so the Python fallbacks at `skills.py:303-310` — single-skill fallback and the Vietnamese "Chưa bật skill nào" listing — are unreachable in this port. Implement them anyway, verbatim, for fidelity; they are covered by code review rather than tests.)

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run tests/main/skills/parse-command.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `src/main/skills/parse-command.ts`:

```ts
import { BUILTIN_SKILLS } from '../agent/skills-builtin';
import { Skill, SKILLS_DIR, activeSkillsText, listSkills, skillSlug } from './store';

export interface SkillCommand {
  prefix: string;
  request: string;
  info: string | null;
}

/**
 * Port of parse_skill_command (skills.py:247-310).
 * Forms: /skill (list) · /skill:<name> [<req>] · /skill <req> (all enabled skills).
 */
export function parseSkillCommand(text: string, directory: string = SKILLS_DIR): SkillCommand {
  const raw = String(text || '').trim();
  const m = /^\/skill(?::([^\s]+))?[ \t]*([\s\S]*)$/.exec(raw);
  if (!m) return { prefix: '', request: text, info: null };
  const slug = m[1];
  const rest = (m[2] || '').trim();
  const userSkills = listSkills(directory);
  const builtins = BUILTIN_SKILLS;
  const builtinSlugSet = new Set(builtins.map((s) => skillSlug(s.name)));
  // Built-ins are hidden from the manager but must surface here, or a fresh
  // install (no custom skills yet) makes /skill look empty/broken.
  const skills: Skill[] = [...userSkills, ...builtins];

  if (slug) {
    const match = skills.find((s) => skillSlug(s.name) === slug || s.name === slug);
    if (!match) {
      return { prefix: '', request: text, info: `Skill \`${slug}\` not found. Type \`/skill\` to see the available skills.` };
    }
    if (!rest) {
      return {
        prefix: '',
        request: text,
        info: `Skill **${match.name}** selected — add your request, e.g. \`/skill:${slug} summarise this file\`.`,
      };
    }
    return { prefix: `## Skill: ${match.name}\n${match.instructions.trim()}`, request: rest, info: null };
  }

  if (!rest) {
    if (!skills.length) {
      return { prefix: '', request: text, info: 'No skills found yet. Add one in the Skills manager (**Skills** button).' };
    }
    const tag = (s: Skill): string => {
      if (builtinSlugSet.has(skillSlug(s.name))) return '  _(built-in, always on)_';
      return s.enabled ? '' : '  _(disabled)_';
    };
    const listing = skills
      .map((s) => `- \`/skill:${skillSlug(s.name)}\` — **${s.name}**` + (s.description ? `: ${s.description}` : '') + tag(s))
      .join('\n');
    return {
      prefix: '',
      request: text,
      info:
        '**Available skills**\n' +
        listing +
        '\n\nApply one with `/skill:<name> <your request>`, or `/skill <your request>` to use all enabled skills.',
    };
  }

  // /skill <request> with no specific name → apply all enabled skills.
  const active = activeSkillsText(directory);
  if (active) return { prefix: active, request: rest, info: null };
  if (skills.length === 1) {
    const s = skills[0];
    return { prefix: `## Skill: ${s.name}\n${s.instructions.trim()}`, request: rest, info: null };
  }
  const listing = skills
    .map((s) => `- \`/skill:${skillSlug(s.name)}\` — **${s.name}**` + (s.description ? `: ${s.description}` : ''))
    .join('\n');
  return { prefix: '', request: text, info: 'Chưa bật skill nào. Chọn một skill cụ thể:\n' + listing };
}
```

- [ ] **Step 4: Run the full suite**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/skills/parse-command.ts tests/main/skills/parse-command.test.ts
git commit -m "feat: /skill command parser (all 5 forms, verbatim messages)"
```

---

### Task 3: `generate.ts` — AI-assisted authoring

**Files:**
- Create: `src/main/skills/generate.ts`
- Test: `tests/main/skills/generate.test.ts`

**Interfaces:**
- Consumes: `Provider`, `Message`, `contentText` from `../agent/types`; `Skill` from `./store`.
- Produces: `generateSkill(provider: Provider, description: string): Promise<Skill>` (throws only when nothing usable); `generateSkillInstructions(provider: Provider, description?: string, name?: string): Promise<string>` (returns `''` on any error).

- [ ] **Step 1: Write the failing tests** — create `tests/main/skills/generate.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { generateSkill, generateSkillInstructions } from '../../../src/main/skills/generate';
import { Provider, Message } from '../../../src/main/agent/types';

function fakeProvider(reply: string | Error): Provider & { lastMessages?: Message[] } {
  const p: any = {
    name: 'fake',
    model: 'fake-model',
    listModels: async () => [],
    chat: vi.fn(async (messages: Message[]) => {
      p.lastMessages = messages;
      if (reply instanceof Error) throw reply;
      return { role: 'assistant', content: reply, tool_calls: [] };
    }),
  };
  return p;
}

describe('generateSkill', () => {
  it('parses a clean JSON reply into a disabled skill', async () => {
    const provider = fakeProvider('{"name": "Unit Tester", "description": "writes tests", "instructions": "- Always add tests."}');
    const skill = await generateSkill(provider, 'make it write tests');
    expect(skill).toEqual({ name: 'Unit Tester', description: 'writes tests', instructions: '- Always add tests.', enabled: false });
    expect((provider.chat as any).mock.calls[0][0][0].content).toContain('You design reusable agent skills');
  });

  it('extracts the JSON object even when surrounded by prose', async () => {
    const provider = fakeProvider('Sure! Here you go:\n{"name":"X","description":"d","instructions":"i"}\nEnjoy.');
    expect((await generateSkill(provider, 'x')).name).toBe('X');
  });

  it('falls back to instructions-only generation when JSON is broken, deriving name/description from the prompt', async () => {
    const provider: any = fakeProvider('');
    provider.chat = vi
      .fn()
      .mockResolvedValueOnce({ role: 'assistant', content: 'not json at all', tool_calls: [] })
      .mockResolvedValueOnce({ role: 'assistant', content: '- Fallback rule.', tool_calls: [] });
    const skill = await generateSkill(provider, 'a very long description that goes on and on past forty characters total');
    expect(skill.instructions).toBe('- Fallback rule.');
    expect(skill.name.length).toBeLessThanOrEqual(40);
    expect(skill.description.length).toBeLessThanOrEqual(80);
    expect(skill.enabled).toBe(false);
  });

  it('throws for an empty description and when nothing usable was produced', async () => {
    await expect(generateSkill(fakeProvider('x'), '   ')).rejects.toThrow(/empty description/);
    const dead: any = fakeProvider('');
    dead.chat = vi.fn().mockRejectedValue(new Error('down'));
    await expect(generateSkill(dead, 'desc')).rejects.toThrow(/no instructions/);
  });
});

describe('generateSkillInstructions', () => {
  it('sends the verbatim system prompt and returns trimmed content', async () => {
    const provider = fakeProvider('  - Do the thing.  ');
    const out = await generateSkillInstructions(provider, 'short desc', 'My Skill');
    expect(out).toBe('- Do the thing.');
    const msgs = (provider.chat as any).mock.calls[0][0];
    expect(msgs[0].content).toContain('You write the INSTRUCTIONS body of a reusable agent skill');
    expect(msgs[1].content).toBe('Skill name: My Skill\nShort description: short desc');
  });

  it('returns empty string on provider error and for empty inputs', async () => {
    expect(await generateSkillInstructions(fakeProvider(new Error('boom')), 'desc')).toBe('');
    expect(await generateSkillInstructions(fakeProvider('x'), '', '')).toBe('');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run tests/main/skills/generate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `src/main/skills/generate.ts`:

```ts
import { Provider, contentText } from '../agent/types';
import { Skill } from './store';

const GENERATE_SKILL_SYSTEM =
  'You design reusable agent skills. From the user\'s description, output a SINGLE JSON ' +
  'object with EXACTLY these keys: "name" (a short Title Case name), "description" ' +
  '(one sentence), "instructions" (clear imperative guidance — a few short bullet ' +
  'points telling a coding/assistant agent how to behave whenever this skill is ' +
  'active). Reply with ONLY the JSON object — no code fences, no preamble.';

const GENERATE_INSTRUCTIONS_SYSTEM =
  'You write the INSTRUCTIONS body of a reusable agent skill. Given a short description, ' +
  'produce clear, imperative guidance (a few short bullet points or paragraphs) telling a ' +
  'coding assistant how to behave whenever this skill is active. Reply with ONLY the ' +
  'instructions text — no preamble, no title.';

/** Port of generate_skill (skills.py:178-222). Throws only when nothing usable was produced. */
export async function generateSkill(provider: Provider, description: string): Promise<Skill> {
  const prompt = String(description || '').trim();
  if (!prompt) throw new Error('empty description');
  let content = '';
  try {
    const a = await provider.chat(
      [
        { role: 'system', content: GENERATE_SKILL_SYSTEM },
        { role: 'user', content: prompt },
      ],
      null,
      {},
    );
    content = contentText(a.content).trim();
  } catch {
    content = '';
  }

  let name = '';
  let desc = '';
  let instructions = '';
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start >= 0 && start < end) {
    try {
      const data = JSON.parse(content.slice(start, end + 1));
      name = String(data.name ?? '').trim();
      desc = String(data.description ?? '').trim();
      instructions = String(data.instructions || data.content || '').trim();
    } catch {
      // fall through to the instructions-only generator
    }
  }
  if (!instructions) {
    instructions = await generateSkillInstructions(provider, prompt, '');
  }
  if (!instructions) throw new Error('generation produced no instructions');
  if (!name) name = prompt.slice(0, 40).trim().replace(/\.+$/, '') || 'New Skill';
  if (!desc) desc = prompt.slice(0, 80).trim();
  return { name, description: desc, instructions, enabled: false };
}

/** Port of generate_skill_instructions (skills.py:225-244). Returns '' on any error. */
export async function generateSkillInstructions(
  provider: Provider,
  description = '',
  name = '',
): Promise<string> {
  const desc = String(description || '').trim();
  if (!desc && !name) return '';
  const user = (name ? `Skill name: ${name}\n` : '') + `Short description: ${desc}`;
  try {
    const a = await provider.chat(
      [
        { role: 'system', content: GENERATE_INSTRUCTIONS_SYSTEM },
        { role: 'user', content: user },
      ],
      null,
      {},
    );
    return contentText(a.content).trim();
  } catch {
    return '';
  }
}
```

- [ ] **Step 4: Run the full suite**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/skills/generate.ts tests/main/skills/generate.test.ts
git commit -m "feat: AI-assisted skill generation (verbatim prompts, safe fallbacks)"
```

---

### Task 4: `run-cowork.ts` — remove-then-insert injection + `skillsText` option

**Files:**
- Modify: `src/main/agent/run-cowork.ts:52-60` (injection block) and `RunCoworkOptions`
- Test: `tests/main/agent/run-cowork.test.ts`

**Interfaces:**
- Consumes: `activeSkillsText` (Task 1), `activeSkillsMessage`, `ACTIVE_SKILLS_TAG`.
- Produces: `RunCoworkOptions.skillsText?: string` (default `activeSkillsText()`); the skills system message is REPLACED every call (port of `_apply_skills`, `code_agent.py:80-93`); when the effective text is blank, no skills message is present after the call.

- [ ] **Step 1: Write the failing tests** — add to `tests/main/agent/run-cowork.test.ts` (reuse the file's existing fake-provider helpers):

```ts
it('replaces the ACTIVE_SKILLS message when skillsText changes between turns (no duplicates)', async () => {
  const messages: Message[] = [];
  await runCowork(fakeProviderReturning({ role: 'assistant', content: 'a', tool_calls: [] }), messages, os.tmpdir(), () => {}, {
    skillsText: '## Skill: One\nFirst.',
  });
  await runCowork(fakeProviderReturning({ role: 'assistant', content: 'b', tool_calls: [] }), messages, os.tmpdir(), () => {}, {
    skillsText: '## Skill: Two\nSecond.',
  });
  const skillMsgs = messages.filter(
    (m) => m.role === 'system' && typeof m.content === 'string' && m.content.startsWith(ACTIVE_SKILLS_TAG),
  );
  expect(skillMsgs).toHaveLength(1);
  expect(String(skillMsgs[0].content)).toContain('## Skill: Two');
  expect(String(skillMsgs[0].content)).not.toContain('## Skill: One');
  expect(messages[1]).toBe(skillMsgs[0]); // still at index 1, after the base system prompt
});

it('removes the skills message entirely when skillsText is blank', async () => {
  const messages: Message[] = [];
  await runCowork(fakeProviderReturning({ role: 'assistant', content: 'a', tool_calls: [] }), messages, os.tmpdir(), () => {}, {
    skillsText: '## Skill: One\nFirst.',
  });
  await runCowork(fakeProviderReturning({ role: 'assistant', content: 'b', tool_calls: [] }), messages, os.tmpdir(), () => {}, {
    skillsText: '   ',
  });
  expect(
    messages.some((m) => m.role === 'system' && typeof m.content === 'string' && m.content.startsWith(ACTIVE_SKILLS_TAG)),
  ).toBe(false);
});
```

Also UPDATE the existing test `'injects the ACTIVE_SKILLS system message at index 1 exactly once'`: its second `runCowork` call now re-inserts (replaces) rather than skips — the assertion `skillMsgs).toHaveLength(1)` still holds unchanged; keep the test as-is unless it asserts object identity across calls (if it does, relax only that).

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run tests/main/agent/run-cowork.test.ts`
Expected: FAIL — `skillsText` unknown option / old message not replaced.

- [ ] **Step 3: Implement** — in `run-cowork.ts`, extend the options interface:

```ts
export interface RunCoworkOptions {
  cancel?: CancelFn;
  maxSteps?: number;
  title?: string;
  pdfRenderer?: PdfRenderer;
  /** Combined active-skills block; defaults to activeSkillsText(). Injected fresh every call. */
  skillsText?: string;
}
```

Replace the injection block (lines 52-60) with:

```ts
  if (!messages.length || messages[0].role !== 'system') {
    messages.unshift({ role: 'system', content: COWORK_TOOL_PROMPT });
  }
  // Port of _apply_skills: drop any previous skills message, then insert the
  // current one — so enable/disable changes take effect on the very next turn.
  const skillsText = opts.skillsText ?? activeSkillsText();
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'system' && typeof m.content === 'string' && m.content.startsWith(ACTIVE_SKILLS_TAG)) {
      messages.splice(i, 1);
    }
  }
  if (skillsText.trim()) {
    const at = messages.length && messages[0].role === 'system' ? 1 : 0;
    messages.splice(at, 0, { role: 'system', content: activeSkillsMessage(skillsText) });
  }
```

- [ ] **Step 4: Run the full suite**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/run-cowork.ts tests/main/agent/run-cowork.test.ts
git commit -m "feat: re-inject ACTIVE_SKILLS every turn (remove-then-insert) + skillsText option"
```

---

### Task 5: IPC + preload — `/skill` in `cowork:send`, `skills:*` handlers, startup prune

No automated tests (IPC wiring convention). Gates: `npx tsc --noEmit`, full `npm test`, `npm run build`.

**Files:**
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`

**Interfaces:**
- Consumes: `parseSkillCommand` (Task 2), `listSkills`/`saveSkill`/`deleteSkill`/`importSkillFile`/`pruneSeededBuiltins`/`Skill` (Task 1), `generateSkill`/`generateSkillInstructions` (Task 3), `BUILTIN_SKILLS`, `ContentPart`, existing `augmentPrompt`/`createProvider`/`config`.
- Produces: `cowork:send` return type `{ messageId: string; queued: boolean } | { info: string }`; IPC channels `skills:list` → `Skill[]`, `skills:builtins` → `Skill[]`, `skills:save(skill, oldName?)`, `skills:delete(name)`, `skills:import` → `{ imported: Skill | null } | { error: string }`, `skills:generate(description)` → `{ skill: Skill } | { error: string }`, `skills:generateInstructions(description, name?)` → `string`. Preload: `skillsList`, `skillsBuiltins`, `skillsSave`, `skillsDelete`, `skillsImport`, `skillsGenerate`, `skillsGenerateInstructions`.

- [ ] **Step 1: `cowork:send` skill handling** — in `src/main/ipc.ts`, add imports:

```ts
import { parseSkillCommand } from './skills/parse-command';
import {
  Skill,
  listSkills,
  saveSkill,
  deleteSkill,
  importSkillFile,
  pruneSeededBuiltins,
} from './skills/store';
import { generateSkill, generateSkillInstructions } from './skills/generate';
import { BUILTIN_SKILLS } from './agent/skills-builtin';
import { ContentPart, Message } from './agent/types'; // Message already imported — merge
```

Add a module-level helper (near `persistConversation`):

```ts
// Port of chat_panel.py:559 — prepend the /skill prefix to the (possibly
// attachment-augmented) request content with the original "---" separator.
function prependSkillPrefix(prefix: string, content: string | ContentPart[]): string | ContentPart[] {
  if (!prefix) return content;
  const sep = '\n\n---\n\n';
  if (typeof content === 'string') return prefix + sep + content;
  const [first, ...restParts] = content;
  if (first && first.type === 'text') {
    return [{ type: 'text', text: prefix + sep + first.text }, ...restParts];
  }
  return [{ type: 'text', text: prefix }, ...content];
}
```

Replace the `cowork:send` handler body with:

```ts
ipcMain.handle('cowork:send', async (_e, conversationId: string, text: string, attachmentPaths: string[] = []) => {
  const { prefix, request, info } = parseSkillCommand(text);
  if (info !== null) {
    // Local /skill command (list / select / error) — answered inline, no agent turn.
    return { info };
  }
  const limits = {
    maxFiles: config.data.attachments.max_files,
    maxTokens: config.data.attachments.max_tokens,
  };
  const augmented = await augmentPrompt(request, attachmentPaths, limits);
  const content = prependSkillPrefix(prefix, augmented);
  const userMessage: Message = { role: 'user', content };
  if (prefix || attachmentPaths.length) {
    userMessage.display = request;
  }
  if (attachmentPaths.length) {
    userMessage.attachments = [...attachmentPaths];
  }
  turnConversation.set(userMessage, conversationId);
  const result = manager.send(conversationId, userMessage, () => getHistory(conversationId), (messageId, event) => {
    mainWin.webContents.send('cowork:event', messageId, event);
  });
  return result;
});
```

- [ ] **Step 2: `skills:*` handlers** — add next to the `settings:*` handlers:

```ts
ipcMain.handle('skills:list', () => listSkills());

ipcMain.handle('skills:builtins', () => BUILTIN_SKILLS);

ipcMain.handle('skills:save', (_e, skill: Skill, oldName?: string) => {
  saveSkill(skill, undefined, oldName || '');
});

ipcMain.handle('skills:delete', (_e, name: string) => {
  deleteSkill(name);
});

ipcMain.handle('skills:import', async () => {
  const result = await dialog.showOpenDialog(mainWin, {
    properties: ['openFile'],
    filters: [
      { name: 'Skills', extensions: ['skill', 'json', 'md', 'txt'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths.length) return { imported: null };
  try {
    return { imported: importSkillFile(result.filePaths[0]) };
  } catch (exc: any) {
    return { error: exc?.message || String(exc) };
  }
});

ipcMain.handle('skills:generate', async (_e, description: string) => {
  try {
    return { skill: await generateSkill(createProvider(config), description) };
  } catch (exc: any) {
    return { error: exc?.message || String(exc) };
  }
});

ipcMain.handle('skills:generateInstructions', (_e, description: string, name?: string) =>
  generateSkillInstructions(createProvider(config), description, name || ''),
);
```

At the very top of `registerIpcHandlers` (first statement), add the startup prune:

```ts
pruneSeededBuiltins();
```

- [ ] **Step 3: Preload** — in `src/preload/index.ts`, add inside the `exposeInMainWorld` object:

```ts
skillsList: () => ipcRenderer.invoke('skills:list'),
skillsBuiltins: () => ipcRenderer.invoke('skills:builtins'),
skillsSave: (skill: Record<string, any>, oldName?: string) => ipcRenderer.invoke('skills:save', skill, oldName),
skillsDelete: (name: string) => ipcRenderer.invoke('skills:delete', name),
skillsImport: () => ipcRenderer.invoke('skills:import'),
skillsGenerate: (description: string) => ipcRenderer.invoke('skills:generate', description),
skillsGenerateInstructions: (description: string, name?: string) =>
  ipcRenderer.invoke('skills:generateInstructions', description, name),
```

(`send`'s signature is unchanged — only its resolved value gains the `{info}` variant, typed in the renderer in Task 7.)

- [ ] **Step 4: Verify gates**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx tsc --noEmit && npm test && npm run build`
Expected: all clean/passing.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc.ts src/preload/index.ts
git commit -m "feat: /skill parsing in cowork:send, skills IPC handlers, startup prune"
```

---

### Task 6: Renderer — Skills manager modal + editor + auto-generate

No automated tests (renderer convention). Gates: tsc, full suite, build.

**Files:**
- Modify: `src/renderer/index.html` (three modals + id on the Skills button)
- Modify: `src/renderer/index.ts`
- Modify: `src/renderer/style.css`

**Interfaces:**
- Consumes: preload `skillsList`, `skillsSave`, `skillsDelete`, `skillsImport`, `skillsGenerate`, `skillsGenerateInstructions` (Task 5); existing `escapeHtml`.
- Produces (used by Task 7): `openSkillsModal(): void` (module-level function), the `#skills-modal` element.

- [ ] **Step 1: Markup** — in `index.html`:

Give the existing chat-header Skills button an id (line ~102): change `<button class="label-btn">` to `<button class="label-btn" id="btn-skills">` (keep its inner content).

Add before the closing `</body>`-adjacent settings modal (next to `#settings-modal`):

```html
<!-- ═══ SKILLS MODALS ═════════════════════════════════════════ -->
<div class="modal" id="skills-modal" hidden>
  <div class="modal__panel modal__panel--wide">
    <h2>Skills</h2>
    <p class="modal-hint">Tick to enable a skill. Enabled skills are followed by the agent.</p>
    <div class="skills-list" id="skills-list"></div>
    <div class="modal__actions">
      <button id="skills-generate" class="primary">✨ Auto-generate</button>
      <button id="skills-import">Import…</button>
      <button id="skills-edit">Edit</button>
      <button id="skills-delete">Delete</button>
      <button id="skills-close">Close</button>
    </div>
  </div>
</div>

<div class="modal" id="skill-edit-modal" hidden>
  <div class="modal__panel modal__panel--wide">
    <h2 id="skill-edit-title">Edit skill</h2>
    <label>Name <input type="text" id="skill-name" placeholder="e.g. Always write unit tests"></label>
    <label>Short description <input type="text" id="skill-description"></label>
    <label>Instructions <textarea id="skill-instructions" rows="9" placeholder="Describe the rules / guidance the agent must follow…"></textarea></label>
    <div class="modal__actions">
      <button id="skill-gen-instructions">✨ Generate from description</button>
      <button id="skill-edit-cancel">Cancel</button>
      <button id="skill-edit-save" class="primary">Save</button>
    </div>
  </div>
</div>

<div class="modal" id="skill-gen-modal" hidden>
  <div class="modal__panel">
    <h2>Auto-generate skill</h2>
    <label>Describe the skill you want (what should the agent do?)
      <textarea id="skill-gen-desc" rows="6"></textarea>
    </label>
    <div class="modal__actions">
      <button id="skill-gen-cancel">Cancel</button>
      <button id="skill-gen-ok" class="primary">Generate</button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: CSS** — append to `style.css`:

```css
/* ── Skills manager ── */
.modal__panel--wide {
  min-width: 560px;
  max-width: 680px;
}
.modal-hint {
  font-size: 12px;
  color: var(--text-dim, #6b7280);
  margin: 4px 0 10px;
}
.skills-list {
  border: 1px solid rgba(140, 146, 152, 0.35);
  border-radius: 8px;
  min-height: 180px;
  max-height: 300px;
  overflow-y: auto;
  margin-bottom: 10px;
}
.skill-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  cursor: pointer;
  font-size: 13px;
}
.skill-row + .skill-row {
  border-top: 1px solid rgba(140, 146, 152, 0.18);
}
.skill-row--selected {
  background: rgba(243, 111, 33, 0.1);
}
.skill-row__desc {
  color: var(--text-dim, #6b7280);
}
.skills-empty {
  padding: 16px;
  color: var(--text-dim, #6b7280);
  font-size: 13px;
}
```

- [ ] **Step 3: Renderer logic** — in `index.ts`, extend `CoworkAPI`:

```ts
interface SkillInfo {
  name: string;
  description: string;
  instructions: string;
  enabled: boolean;
}
// inside CoworkAPI:
skillsList(): Promise<SkillInfo[]>;
skillsBuiltins(): Promise<SkillInfo[]>;
skillsSave(skill: SkillInfo, oldName?: string): Promise<void>;
skillsDelete(name: string): Promise<void>;
skillsImport(): Promise<{ imported: SkillInfo | null } | { error: string }>;
skillsGenerate(description: string): Promise<{ skill: SkillInfo } | { error: string }>;
skillsGenerateInstructions(description: string, name?: string): Promise<string>;
```

Add the manager section (after the Settings modal section):

```ts
// ── Skills manager ───────────────────────────────────────────
const skillsModal = document.getElementById('skills-modal') as HTMLElement | null;
const skillEditModal = document.getElementById('skill-edit-modal') as HTMLElement | null;
const skillGenModal = document.getElementById('skill-gen-modal') as HTMLElement | null;

let managerSkills: SkillInfo[] = [];
let selectedSkillName: string | null = null;
let editingOldName = '';

async function refreshSkillsList(): Promise<void> {
  if (!api) return;
  managerSkills = await api.skillsList();
  const list = document.getElementById('skills-list');
  if (!list) return;
  if (!managerSkills.length) {
    list.innerHTML = `<div class="skills-empty">(No skills yet — click '✨ Auto-generate' or 'Import…')</div>`;
    selectedSkillName = null;
    return;
  }
  if (!managerSkills.some((s) => s.name === selectedSkillName)) selectedSkillName = null;
  list.innerHTML = '';
  for (const skill of managerSkills) {
    const row = document.createElement('div');
    row.className = 'skill-row' + (skill.name === selectedSkillName ? ' skill-row--selected' : '');
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = skill.enabled;
    check.addEventListener('click', (e) => e.stopPropagation());
    check.addEventListener('change', () => {
      void api!.skillsSave({ ...skill, enabled: check.checked }).then(refreshSkillsList);
    });
    const label = document.createElement('span');
    label.textContent = skill.name + (skill.description ? '  —  ' : '');
    const desc = document.createElement('span');
    desc.className = 'skill-row__desc';
    desc.textContent = skill.description;
    row.append(check, label, desc);
    row.addEventListener('click', () => {
      selectedSkillName = skill.name;
      void refreshSkillsList();
    });
    list.appendChild(row);
  }
}

function openSkillsModal(): void {
  if (!skillsModal) return;
  skillsModal.hidden = false;
  void refreshSkillsList();
}

function openSkillEditor(skill: SkillInfo | null): void {
  if (!skillEditModal) return;
  editingOldName = skill?.name || '';
  (document.getElementById('skill-edit-title') as HTMLElement).textContent = skill ? 'Edit skill' : 'New skill';
  (document.getElementById('skill-name') as HTMLInputElement).value = skill?.name || '';
  (document.getElementById('skill-description') as HTMLInputElement).value = skill?.description || '';
  (document.getElementById('skill-instructions') as HTMLTextAreaElement).value = skill?.instructions || '';
  skillEditModal.hidden = false;
}

document.getElementById('btn-skills')?.addEventListener('click', openSkillsModal);
document.getElementById('skills-close')?.addEventListener('click', () => {
  if (skillsModal) skillsModal.hidden = true;
});

document.getElementById('skills-edit')?.addEventListener('click', () => {
  const skill = managerSkills.find((s) => s.name === selectedSkillName);
  if (skill) openSkillEditor(skill);
  else showComposerStatus('Chọn một skill trong danh sách trước.');
});

document.getElementById('skills-delete')?.addEventListener('click', () => {
  const skill = managerSkills.find((s) => s.name === selectedSkillName);
  if (!skill) {
    showComposerStatus('Chọn một skill trong danh sách trước.');
    return;
  }
  if (!window.confirm(`Xóa skill "${skill.name}"?`)) return;
  void api!.skillsDelete(skill.name).then(refreshSkillsList);
});

document.getElementById('skills-import')?.addEventListener('click', async () => {
  if (!api) return;
  const result = await api.skillsImport();
  if ('error' in result) window.alert(result.error);
  await refreshSkillsList();
});

document.getElementById('skill-edit-cancel')?.addEventListener('click', () => {
  if (skillEditModal) skillEditModal.hidden = true;
});

document.getElementById('skill-edit-save')?.addEventListener('click', async () => {
  if (!api || !skillEditModal) return;
  const name = (document.getElementById('skill-name') as HTMLInputElement).value.trim();
  if (!name) {
    window.alert('Skill cần có tên.');
    return;
  }
  const existing = managerSkills.find((s) => s.name === editingOldName);
  await api.skillsSave(
    {
      name,
      description: (document.getElementById('skill-description') as HTMLInputElement).value.trim(),
      instructions: (document.getElementById('skill-instructions') as HTMLTextAreaElement).value.trim(),
      enabled: existing ? existing.enabled : false,
    },
    editingOldName || undefined,
  );
  skillEditModal.hidden = true;
  await refreshSkillsList();
});

document.getElementById('skill-gen-instructions')?.addEventListener('click', async () => {
  if (!api) return;
  const name = (document.getElementById('skill-name') as HTMLInputElement).value.trim();
  const desc = (document.getElementById('skill-description') as HTMLInputElement).value.trim();
  if (!desc && !name) {
    window.alert('Nhập mô tả ngắn trước.');
    return;
  }
  const btn = document.getElementById('skill-gen-instructions') as HTMLButtonElement;
  btn.disabled = true;
  try {
    const text = await api.skillsGenerateInstructions(desc, name);
    if (text) (document.getElementById('skill-instructions') as HTMLTextAreaElement).value = text;
    else window.alert('Không sinh được nội dung — kiểm tra cấu hình model.');
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('skills-generate')?.addEventListener('click', () => {
  if (!skillGenModal) return;
  (document.getElementById('skill-gen-desc') as HTMLTextAreaElement).value = '';
  skillGenModal.hidden = false;
});

document.getElementById('skill-gen-cancel')?.addEventListener('click', () => {
  if (skillGenModal) skillGenModal.hidden = true;
});

document.getElementById('skill-gen-ok')?.addEventListener('click', async () => {
  if (!api || !skillGenModal) return;
  const desc = (document.getElementById('skill-gen-desc') as HTMLTextAreaElement).value.trim();
  if (!desc) return;
  const btn = document.getElementById('skill-gen-ok') as HTMLButtonElement;
  btn.disabled = true;
  try {
    const result = await api.skillsGenerate(desc);
    if ('error' in result) {
      window.alert(`Không sinh được skill: ${result.error}`);
      return;
    }
    skillGenModal.hidden = true;
    openSkillEditor(result.skill); // review before saving, like the Python dialog
    editingOldName = ''; // NEW skill: saving must not delete any existing file (openSkillEditor set it to the generated name)
  } finally {
    btn.disabled = false;
  }
});
```

- [ ] **Step 4: Verify gates**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx tsc --noEmit && npm test && npm run build`
Expected: all clean/passing.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/index.html src/renderer/index.ts src/renderer/style.css
git commit -m "feat: Skills manager modal with editor, import and AI auto-generate"
```

---

### Task 7: Renderer — `/skill` info flow + composer autocomplete popup

**Files:**
- Modify: `src/renderer/index.html` (popup container)
- Modify: `src/renderer/index.ts`
- Modify: `src/renderer/style.css`

**Interfaces:**
- Consumes: `openSkillsModal` (Task 6), preload `skillsList`/`skillsBuiltins`, extended `send` result union, existing `appendUserBubble`/`appendAssistantText`/`pendingAttachments`/`renderAttachmentChips`.
- Produces: complete `/skill` UX.

- [ ] **Step 1: `send` result union + info flow** — in `index.ts`, change the `CoworkAPI.send` signature:

```ts
send(conversationId: string, text: string, attachmentPaths?: string[]): Promise<{ messageId: string; queued: boolean } | { info: string }>;
```

Replace the tail of `sendMessage` (from `appendUserBubble` down) with:

```ts
  appendUserBubble(text || '(tệp đính kèm)', attachments);
  composerInput!.innerText = '';
  composerInput!.focus();

  const result = await api.send(currentConversationId, text, attachments);
  if ('info' in result) {
    // Local /skill command answered inline — restore any attachments that were
    // snapshotted for this send; they were not consumed by a real turn.
    if (attachments.length) {
      pendingAttachments = attachments;
      renderAttachmentChips();
    }
    appendAssistantText(`info_${Math.random()}`, result.info);
    return;
  }
  setInFlight(result.messageId);
```

- [ ] **Step 2: Popup markup** — in `index.html`, add as the FIRST child of `.composer__box` (above the attachments strip):

```html
<div class="skill-popup" id="skill-popup" hidden></div>
```

- [ ] **Step 3: Popup CSS** — append to `style.css`:

```css
/* ── /skill autocomplete popup ── */
.composer__box {
  position: relative;
}
.skill-popup {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: calc(100% + 6px);
  background: var(--panel-bg, #ffffff);
  border: 1px solid rgba(140, 146, 152, 0.35);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  max-height: 220px;
  overflow-y: auto;
  z-index: 40;
  font-size: 13px;
}
.skill-popup__item {
  padding: 7px 12px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.skill-popup__item--active {
  background: rgba(243, 111, 33, 0.12);
}
.skill-popup__item--manage {
  border-top: 1px solid rgba(140, 146, 152, 0.25);
}
.skill-popup__desc {
  color: var(--text-dim, #6b7280);
}
```

- [ ] **Step 4: Popup logic** — add to `index.ts` (after the attachments section, before the existing composer keydown handler; the keydown ADDITION below must be registered BEFORE the existing Enter handler or merged into it — merge is cleaner, see note):

```ts
// ── /skill autocomplete popup ─────────────────────────────────
const skillPopup = document.getElementById('skill-popup') as HTMLElement | null;
let popupEntries: Array<{ slug: string; label: string; desc: string }> = [];
let popupIndex = 0;

function skillFilter(text: string): string | null {
  const first = text.split('\n', 1)[0];
  if (first.length >= 2 && '/skill'.startsWith(first)) return '';
  const m = /^\/skill:?([\w\-.]*)$/.exec(first);
  return m ? m[1] : null;
}

function slugify(name: string): string {
  // display-only slug for popup insertion; the authoritative slug lives in main.
  let s = '';
  for (const ch of name.trim().toLowerCase()) {
    s += /[\p{L}\p{N}\-_]/u.test(ch) ? ch : '-';
  }
  return s.split('-').filter(Boolean).join('-') || 'skill';
}

function hideSkillPopup(): void {
  if (skillPopup) skillPopup.hidden = true;
  popupEntries = [];
}

function renderSkillPopup(): void {
  if (!skillPopup) return;
  skillPopup.innerHTML = '';
  popupEntries.forEach((entry, i) => {
    const item = document.createElement('div');
    item.className =
      'skill-popup__item' +
      (i === popupIndex ? ' skill-popup__item--active' : '') +
      (entry.slug === '__manage__' ? ' skill-popup__item--manage' : '');
    item.textContent = entry.label;
    if (entry.desc) {
      const d = document.createElement('span');
      d.className = 'skill-popup__desc';
      d.textContent = `  —  ${entry.desc}`;
      item.appendChild(d);
    }
    item.addEventListener('mousedown', (e) => {
      e.preventDefault(); // keep composer focus
      acceptSkillEntry(entry.slug);
    });
    skillPopup.appendChild(item);
  });
  skillPopup.hidden = popupEntries.length === 0;
}

function acceptSkillEntry(slug: string): void {
  hideSkillPopup();
  if (slug === '__manage__') {
    openSkillsModal();
    return;
  }
  if (!slug || !composerInput) return;
  composerInput.innerText = `/skill:${slug} `;
  composerInput.focus();
  const range = document.createRange();
  range.selectNodeContents(composerInput);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

async function maybeShowSkillPopup(): Promise<void> {
  if (!api || !composerInput || !skillPopup) return;
  const filter = skillFilter(composerInput.innerText);
  if (filter === null) {
    hideSkillPopup();
    return;
  }
  const [user, builtins] = await Promise.all([api.skillsList(), api.skillsBuiltins()]);
  const pool = [...user, ...builtins];
  const f = filter.toLowerCase();
  const matches = pool.filter(
    (s) =>
      s.name.toLowerCase().includes(f) ||
      slugify(s.name).includes(f) ||
      (s.description || '').toLowerCase().includes(f),
  );
  popupEntries = matches.map((s) => ({
    slug: slugify(s.name),
    label: (s.enabled ? '✓ ' : '   ') + s.name,
    desc: s.description || '',
  }));
  if (!matches.length) popupEntries.push({ slug: '', label: '   (no skills yet)', desc: '' });
  popupEntries.push({ slug: '__manage__', label: '⚙  Manage skills…', desc: '' });
  popupIndex = matches.length ? 0 : popupEntries.length - 1;
  renderSkillPopup();
}

composerInput?.addEventListener('input', () => void maybeShowSkillPopup());

composerInput?.addEventListener('blur', () => {
  // mousedown on popup items calls preventDefault, so blur here means "clicked away".
  setTimeout(hideSkillPopup, 120);
});
```

MERGE the popup keys into the existing composer keydown handler (replace the existing handler):

```ts
composerInput?.addEventListener('keydown', (e) => {
  const key = (e as KeyboardEvent).key;
  if (skillPopup && !skillPopup.hidden) {
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      e.preventDefault();
      const n = popupEntries.length;
      if (n) popupIndex = (popupIndex + (key === 'ArrowDown' ? 1 : -1) + n) % n;
      renderSkillPopup();
      return;
    }
    if (key === 'Tab') {
      e.preventDefault();
      acceptSkillEntry(popupEntries[popupIndex]?.slug || '');
      return;
    }
    if (key === 'Escape') {
      e.preventDefault();
      hideSkillPopup();
      return;
    }
    if (key === 'Enter' && !(e as KeyboardEvent).shiftKey) {
      hideSkillPopup(); // fall through to send below
    }
  }
  if (key === 'Enter' && !(e as KeyboardEvent).shiftKey) {
    e.preventDefault();
    void sendMessage();
  }
});
```

- [ ] **Step 5: Verify gates**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx tsc --noEmit && npm test && npm run build`
Expected: all clean/passing.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/index.html src/renderer/index.ts src/renderer/style.css
git commit -m "feat: /skill inline info flow + composer autocomplete popup"
```

---

### Task 8: Manual end-to-end verification (deferred to the user)

No code. Run `npm start` (with `ELECTRON_RUN_AS_NODE` unset) + real API key and verify:

- [ ] Nút "Skills" trên chat header mở manager; danh sách trống hiện placeholder.
- [ ] **✨ Auto-generate**: mô tả một skill → editor mở với nội dung sinh sẵn → Save → skill xuất hiện (chưa tick).
- [ ] **Edit** đổi tên → file `<slug-mới>.json` thay `<slug-cũ>.json` trong `~/.cowork_local/skills/`; **Delete** xoá; **Import…** nhập file `.md`/`.skill`.
- [ ] Tick bật skill → gửi tin nhắn thường → model tuân theo skill (system message chứa `## Skill: <tên>`).
- [ ] `/skill` → bubble liệt kê (kèm HTML Document Builder `_(built-in, always on)_`); `/skill:<slug>` → "selected"; `/skill:sai` → "not found"; `/skill:<slug> <req>` → one-shot; `/skill <req>` → dùng mọi skill bật. Các lệnh local trả lời ngay cả khi đang có turn chạy.
- [ ] Gõ `/s` → popup hiện, ↑/↓ + Tab điền `/skill:<slug> `, Esc đóng, "⚙ Manage skills…" mở manager.
- [ ] Skill tạo bởi bản Python cũ (nếu có trong `~/.cowork_local/skills/`) hiện đúng trong manager.
- [ ] Regression: chat thường, attachments, Nén, Stop, history, doc-gen tools vẫn hoạt động.
