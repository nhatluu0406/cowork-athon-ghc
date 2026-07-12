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
