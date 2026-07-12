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
