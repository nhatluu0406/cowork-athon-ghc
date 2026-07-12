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
