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
