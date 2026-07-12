import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const CONFIG_DIR = path.join(os.homedir(), '.cowork_local');
export const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
export const HISTORY_DIR = path.join(CONFIG_DIR, 'history');

export interface ProviderConf {
  base_url?: string;
  api_key: string;
  model: string;
}

export interface CoworkConf {
  output_dir: string;
  max_parallel: number;
}

export interface HistoryConf {
  location: string;
  custom_dir: string;
  autosave: boolean;
}

export interface LastSessionConf {
  cowork: string;
}

export interface AttachmentsConf {
  max_files: number;
  max_tokens: number;
}

export interface AppConfigData {
  active_provider: string;
  theme: string;
  providers: {
    openai_compat: ProviderConf;
    anthropic: ProviderConf;
  };
  cowork: CoworkConf;
  history: HistoryConf;
  last_session: LastSessionConf;
  attachments: AttachmentsConf;
}

export const PROVIDER_LABELS: Record<string, string> = {
  openai_compat: 'OpenAI-compatible (Internal Gateway)',
  anthropic: 'Anthropic Claude',
};

export const DEFAULT_CONFIG: AppConfigData = {
  active_provider: 'openai_compat',
  theme: 'dark',
  providers: {
    openai_compat: { base_url: 'https://your-internal-gateway/v1', api_key: '', model: 'gpt-4o-mini' },
    anthropic: { base_url: 'https://api.anthropic.com', api_key: '', model: 'claude-sonnet-4-6' },
  },
  cowork: { output_dir: '', max_parallel: 5 },
  history: { location: 'local', custom_dir: '', autosave: true },
  last_session: { cowork: '' },
  attachments: { max_files: 10, max_tokens: 500000 },
};

export function deepMerge<T>(base: T, override: any): T {
  const out: any = JSON.parse(JSON.stringify(base));
  for (const key of Object.keys(override || {})) {
    const value = override[key];
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof out[key] === 'object') {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function applyEnvOverrides(data: AppConfigData): AppConfigData {
  const out = JSON.parse(JSON.stringify(data)) as AppConfigData;
  if (process.env.OPENAI_API_KEY) out.providers.openai_compat.api_key = process.env.OPENAI_API_KEY;
  if (process.env.OPENAI_BASE_URL) out.providers.openai_compat.base_url = process.env.OPENAI_BASE_URL;
  if (process.env.OPENAI_MODEL) out.providers.openai_compat.model = process.env.OPENAI_MODEL;
  if (process.env.ANTHROPIC_API_KEY) out.providers.anthropic.api_key = process.env.ANTHROPIC_API_KEY;
  if (process.env.ANTHROPIC_MODEL) out.providers.anthropic.model = process.env.ANTHROPIC_MODEL;
  if (process.env.COWORK_ACTIVE_PROVIDER) out.active_provider = process.env.COWORK_ACTIVE_PROVIDER;
  return out;
}

export class AppConfig {
  constructor(
    public data: AppConfigData,
    public path: string = CONFIG_PATH,
  ) {}

  static load(configPath: string = CONFIG_PATH): AppConfig {
    let merged = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as AppConfigData;
    if (fs.existsSync(configPath)) {
      try {
        const stored = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        merged = deepMerge(merged, stored);
      } catch {
        merged = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      }
    }
    merged = applyEnvOverrides(merged);
    return new AppConfig(merged, configPath);
  }

  save(): void {
    fs.mkdirSync(path.dirname(this.path), { recursive: true });
    fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  /**
   * Deep-merges a partial config update into the current data (recursing into nested
   * objects like `providers.anthropic` instead of replacing them wholesale) and persists
   * the result to disk. Prefer this over a shallow `{ ...data, ...partial }` spread,
   * which would silently drop sibling fields of any nested object the caller updates.
   */
  mergeAndSave(partial: Partial<AppConfigData>): void {
    this.data = deepMerge(this.data, partial);
    this.save();
  }

  get activeProvider(): string {
    const val = this.data.active_provider;
    return val in PROVIDER_LABELS ? val : 'openai_compat';
  }

  providerConf(name?: string): ProviderConf {
    const key = name || this.activeProvider;
    return (this.data.providers as any)[key];
  }

  coworkOutputDir(): string {
    const custom = (this.data.cowork.output_dir || '').trim();
    if (custom) return path.resolve(custom.startsWith('~') ? custom.replace('~', os.homedir()) : custom);
    return path.join(CONFIG_DIR, 'output', 'cowork');
  }

  historyDir(): string {
    const custom = (this.data.history.custom_dir || '').trim();
    if (custom) return path.resolve(custom.startsWith('~') ? custom.replace('~', os.homedir()) : custom);
    return HISTORY_DIR;
  }
}
