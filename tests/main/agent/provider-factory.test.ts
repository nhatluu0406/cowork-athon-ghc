import { describe, it, expect } from 'vitest';
import { createProvider } from '../../../src/main/agent/provider-factory';
import { AppConfig, DEFAULT_CONFIG } from '../../../src/main/config';
import { AnthropicProvider } from '../../../src/main/agent/provider-anthropic';
import { OpenAICompatProvider } from '../../../src/main/agent/provider-openai-compat';

describe('createProvider', () => {
  it('creates an AnthropicProvider when active_provider is anthropic', () => {
    const config = new AppConfig({ ...JSON.parse(JSON.stringify(DEFAULT_CONFIG)), active_provider: 'anthropic' });
    const provider = createProvider(config);
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it('creates an OpenAICompatProvider when active_provider is openai_compat', () => {
    const config = new AppConfig({ ...JSON.parse(JSON.stringify(DEFAULT_CONFIG)), active_provider: 'openai_compat' });
    const provider = createProvider(config);
    expect(provider).toBeInstanceOf(OpenAICompatProvider);
  });

  it('honors an explicit providerName override', () => {
    const config = new AppConfig({ ...JSON.parse(JSON.stringify(DEFAULT_CONFIG)), active_provider: 'openai_compat' });
    const provider = createProvider(config, 'anthropic');
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });
});
