import { describe, it, expect } from 'vitest';
import {
  HTML_DOC_BUILDER_SKILL,
  ACTIVE_SKILLS_TAG,
  activeSkillsMessage,
} from '../../../src/main/agent/skills-builtin';

describe('HTML_DOC_BUILDER_SKILL', () => {
  it('carries the original skill text verbatim (spot checks)', () => {
    expect(HTML_DOC_BUILDER_SKILL).toContain('# HTML Document Builder');
    expect(HTML_DOC_BUILDER_SKILL).toContain('self-contained **HTML document**');
    expect(HTML_DOC_BUILDER_SKILL).toContain('Put ALL CSS inline in a ``<style>`` block');
    expect(HTML_DOC_BUILDER_SKILL).toContain('centred content column (max-width ~820px)');
    expect(HTML_DOC_BUILDER_SKILL).toContain('Do NOT ask clarifying or confirmation questions');
  });

  it('uses the ported step 3 (save_file tool, no .scratch)', () => {
    expect(HTML_DOC_BUILDER_SKILL).toContain('Save it with the save_file tool as ``<name>.html``');
    expect(HTML_DOC_BUILDER_SKILL).not.toContain('.scratch');
  });
});

describe('activeSkillsMessage', () => {
  it('wraps the given skills text in the ACTIVE_SKILLS envelope', () => {
    const msg = activeSkillsMessage('## Skill: X\nDo X.');
    expect(msg.startsWith(`${ACTIVE_SKILLS_TAG}\n`)).toBe(true);
    expect(msg).toContain('The user enabled the following skills — follow them:');
    expect(msg).toContain('## Skill: X\nDo X.');
  });
});
