import { AppConfig } from '../config';
import { Provider } from './types';
import { AnthropicProvider } from './provider-anthropic';
import { OpenAICompatProvider } from './provider-openai-compat';

export function createProvider(config: AppConfig, providerName?: string): Provider {
  const name = providerName || config.activeProvider;
  const conf = config.providerConf(name);
  if (name === 'anthropic') {
    return new AnthropicProvider({ base_url: conf.base_url, api_key: conf.api_key, model: conf.model });
  }
  return new OpenAICompatProvider({ base_url: conf.base_url || '', api_key: conf.api_key, model: conf.model });
}
