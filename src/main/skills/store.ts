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
