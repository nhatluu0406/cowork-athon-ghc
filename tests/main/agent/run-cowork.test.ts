import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { runCowork, COWORK_TOOL_PROMPT } from '../../../src/main/agent/run-cowork';
import { Provider, Message, ToolSpec, ChatCallbacks, StreamEvent } from '../../../src/main/agent/types';
import { ACTIVE_SKILLS_TAG } from '../../../src/main/agent/skills-builtin';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-run-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

class ScriptedProvider implements Provider {
  readonly name = 'scripted';
  readonly model = 'scripted-model';
  private call = 0;
  constructor(private turns: Array<(messages: Message[], callbacks: ChatCallbacks) => Message>) {}
  async chat(messages: Message[], _tools: ToolSpec[] | null, callbacks: ChatCallbacks): Promise<Message> {
    const turn = this.turns[this.call++];
    return turn(messages, callbacks);
  }
  async listModels() {
    return [];
  }
}

function fakeProviderReturning(finalMessage: Message): Provider {
  return new ScriptedProvider([() => finalMessage]);
}

function fakeProviderWithToolCall(toolCall: { id: string; name: string; arguments: Record<string, any> }): Provider {
  return new ScriptedProvider([
    () => ({ role: 'assistant', content: '', tool_calls: [toolCall] }),
    () => ({ role: 'assistant', content: 'done', tool_calls: [] }),
  ]);
}

describe('runCowork', () => {
  it('injects the ACTIVE_SKILLS system message at index 1 exactly once', async () => {
    const messages: Message[] = [];
    await runCowork(
      fakeProviderReturning({ role: 'assistant', content: 'hi', tool_calls: [] }),
      messages,
      os.tmpdir(),
      () => {},
    );
    expect(messages[0].role).toBe('system');
    expect(String(messages[1].content).startsWith(ACTIVE_SKILLS_TAG)).toBe(true);
    // second run on the same array must NOT duplicate it
    await runCowork(
      fakeProviderReturning({ role: 'assistant', content: 'again', tool_calls: [] }),
      messages,
      os.tmpdir(),
      () => {},
    );
    const skillMsgs = messages.filter(
      (m) => m.role === 'system' && String(m.content).startsWith(ACTIVE_SKILLS_TAG),
    );
    expect(skillMsgs).toHaveLength(1);
  });

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

  it('dispatches create_xlsx: writes the file, emits tool_result + outputs_added, pushes the tool message', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-doc-'));
    const events: StreamEvent[] = [];
    const provider = fakeProviderWithToolCall({
      id: 'tc1',
      name: 'create_xlsx',
      arguments: { filename: 'data', sheets: [{ name: 'S', rows: [['a', 1]] }] },
    });
    const messages: Message[] = [{ role: 'user', content: 'make a sheet' }];
    await runCowork(provider, messages, outDir, (e) => events.push(e), { title: 'Sheet title' });
    const toolResult = events.find((e) => e.type === 'tool_result') as any;
    expect(toolResult.ok).toBe(true);
    expect(toolResult.path).toContain('Sheet title.xlsx');
    expect(events.some((e) => e.type === 'outputs_added')).toBe(true);
    const toolMsg = messages.find((m) => m.role === 'tool' && m.tool_call_id === 'tc1');
    expect(toolMsg).toBeDefined();
    expect(XLSX.read(fs.readFileSync(toolResult.path), { type: 'buffer' }).SheetNames).toEqual(['S']);
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('feeds a failing doc tool result back to the model instead of throwing', async () => {
    const events: StreamEvent[] = [];
    const provider = fakeProviderWithToolCall({ id: 'tc2', name: 'create_pptx', arguments: { filename: 'd', slides: [] } });
    const messages: Message[] = [{ role: 'user', content: 'deck' }];
    await runCowork(provider, messages, os.tmpdir(), (e) => events.push(e));
    const toolResult = events.find((e) => e.type === 'tool_result') as any;
    expect(toolResult.ok).toBe(false);
    const toolMsg = messages.find((m) => m.role === 'tool' && m.tool_call_id === 'tc2');
    expect(String(toolMsg!.content)).toMatch(/slides/);
  });

  it('COWORK_TOOL_PROMPT teaches the four tools and no script workflow', () => {
    for (const t of ['create_docx', 'create_xlsx', 'create_pptx', 'create_pdf', 'save_file']) {
      expect(COWORK_TOOL_PROMPT).toContain(t);
    }
    expect(COWORK_TOOL_PROMPT).not.toMatch(/run_command|\.scratch|install_package|Python script/i);
  });

  it('streams plain text and emits assistant_done when there is no tool call', async () => {
    const provider = new ScriptedProvider([
      (_messages, callbacks) => {
        callbacks.onText?.('Hello');
        callbacks.onText?.(' there');
        return { role: 'assistant', content: 'Hello there', tool_calls: [] };
      },
    ]);
    const events: StreamEvent[] = [];
    await runCowork(provider, [{ role: 'user', content: 'hi' }], tmpDir, (e) => events.push(e), { title: 'Test chat' });

    expect(events).toContainEqual({ type: 'text', delta: 'Hello' });
    expect(events).toContainEqual({ type: 'text', delta: ' there' });
    expect(events).toContainEqual({ type: 'assistant_done', content: 'Hello there' });
  });

  it('runs the save_file tool and emits tool_proposed/tool_result/outputs_added', async () => {
    const provider = new ScriptedProvider([
      () => ({
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call_1', name: 'save_file', arguments: { filename: 'note.md', content: '# Note' } }],
      }),
      () => ({ role: 'assistant', content: 'Done.', tool_calls: [] }),
    ]);
    const events: StreamEvent[] = [];
    await runCowork(provider, [{ role: 'user', content: 'save a note' }], tmpDir, (e) => events.push(e), {
      title: 'Weekly report',
    });

    const proposed = events.find((e) => e.type === 'tool_proposed');
    expect(proposed).toBeTruthy();
    const result = events.find((e) => e.type === 'tool_result');
    expect(result).toMatchObject({ type: 'tool_result', name: 'save_file', ok: true });
    const added = events.find((e) => e.type === 'outputs_added');
    expect(added).toBeTruthy();
    expect(fs.existsSync(path.join(tmpDir, 'Weekly report.md'))).toBe(true);
  });

  it('handles update_plan by emitting plan_set without writing a file', async () => {
    const provider = new ScriptedProvider([
      () => ({
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call_1', name: 'update_plan', arguments: { steps: [{ title: 'Step 1', status: 'running' }] } }],
      }),
      () => ({ role: 'assistant', content: 'Working on it.', tool_calls: [] }),
    ]);
    const events: StreamEvent[] = [];
    await runCowork(provider, [{ role: 'user', content: 'do something' }], tmpDir, (e) => events.push(e));

    expect(events).toContainEqual({ type: 'plan_set', steps: [{ title: 'Step 1', status: 'running' }] });
    expect(fs.readdirSync(tmpDir).length).toBe(0);
  });

  it('stops immediately when cancel() is already true', async () => {
    const provider = new ScriptedProvider([() => ({ role: 'assistant', content: 'should not run', tool_calls: [] })]);
    const events: StreamEvent[] = [];
    await runCowork(provider, [{ role: 'user', content: 'hi' }], tmpDir, (e) => events.push(e), {
      cancel: () => true,
    });
    expect(events).toEqual([]);
  });
});
