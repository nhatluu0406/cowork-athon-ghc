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
