import type { Skill } from '../skills/store';

/**
 * Built-in, always-on skills. Sub-project #4 (Skills system) will fold this
 * constant into its built-in skill list; keep the text and envelope format
 * identical to the Python original (skill_templates/html-document.skill,
 * _apply_skills in code_agent.py).
 */
export const HTML_DOC_BUILDER_SKILL = `# HTML Document Builder

You turn the user's request into a polished, self-contained **HTML document** and
save it as the final \`\`.html\`\` file.

When the user asks for a document — report, one-pager, memo, proposal, meeting
minutes, guide, letter, summary, etc.:

1. Write the full content called for: clear structure, accurate to the request,
   in the user's language.
2. Produce ONE standalone \`\`.html\`\` file (no external dependencies):
   - Put ALL CSS inline in a \`\`<style>\`\` block; embed any images as base64 data URIs.
   - Include \`\`<meta charset="utf-8">\`\` and a \`\`<title>\`\`.
   - Clean, readable typography; a centred content column (max-width ~820px);
     clear heading hierarchy; bordered tables; a subtle accent colour; spacing
     that prints well on A4.
3. Save it with the save_file tool as \`\`<name>.html\`\` — that is the final deliverable.
4. Do NOT ask clarifying or confirmation questions — make reasonable assumptions,
   complete the request end-to-end, then report the saved file name.
`;

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
