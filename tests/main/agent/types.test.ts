import { describe, it, expect } from 'vitest';
import { toolSpecToOpenAI, toolSpecToAnthropic, ToolSpec, contentText, ContentPart } from '../../../src/main/agent/types';

describe('tool spec conversion', () => {
  const spec: ToolSpec = {
    name: 'save_file',
    description: 'Save a file',
    parameters: { type: 'object', properties: { filename: { type: 'string' } }, required: ['filename'] },
  };

  it('converts to OpenAI function-calling shape', () => {
    expect(toolSpecToOpenAI(spec)).toEqual({
      type: 'function',
      function: {
        name: 'save_file',
        description: 'Save a file',
        parameters: spec.parameters,
      },
    });
  });

  it('converts to Anthropic tool shape', () => {
    expect(toolSpecToAnthropic(spec)).toEqual({
      name: 'save_file',
      description: 'Save a file',
      input_schema: spec.parameters,
    });
  });
});

describe('contentText', () => {
  it('returns a plain string unchanged', () => {
    expect(contentText('hello')).toBe('hello');
  });

  it('returns empty string for undefined/null', () => {
    expect(contentText(undefined)).toBe('');
    expect(contentText(null)).toBe('');
  });

  it('joins text parts and skips image parts', () => {
    const parts: ContentPart[] = [
      { type: 'text', text: 'first' },
      { type: 'image', mimeType: 'image/png', data: 'aWNvbg==' },
      { type: 'text', text: 'second' },
    ];
    expect(contentText(parts)).toBe('first\nsecond');
  });

  it('returns empty string for an empty part array', () => {
    expect(contentText([])).toBe('');
  });
});
