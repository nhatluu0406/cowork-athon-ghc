import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AppConfig, DEFAULT_CONFIG } from '../../src/main/config';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-config-test-'));
  vi.unstubAllEnvs();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('AppConfig', () => {
  it('loads defaults when no config file exists', () => {
    const configPath = path.join(tmpDir, 'config.json');
    const config = AppConfig.load(configPath);
    expect(config.data.active_provider).toBe(DEFAULT_CONFIG.active_provider);
    expect(config.data.cowork.max_parallel).toBe(5);
  });

  it('deep-merges a stored config file over the defaults', () => {
    const configPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ cowork: { max_parallel: 8 } }));
    const config = AppConfig.load(configPath);
    expect(config.data.cowork.max_parallel).toBe(8);
    expect(config.data.cowork.output_dir).toBe(DEFAULT_CONFIG.cowork.output_dir);
  });

  it('applies environment variable overrides after the stored config', () => {
    const configPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ providers: { anthropic: { api_key: 'stored-key' } } }));
    vi.stubEnv('ANTHROPIC_API_KEY', 'env-key');
    const config = AppConfig.load(configPath);
    expect(config.data.providers.anthropic.api_key).toBe('env-key');
  });

  it('saves data back to disk as JSON', () => {
    const configPath = path.join(tmpDir, 'config.json');
    const config = AppConfig.load(configPath);
    config.data.active_provider = 'anthropic';
    config.save();
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(raw.active_provider).toBe('anthropic');
  });

  it('providerConf returns the config for the active provider by default', () => {
    const configPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ active_provider: 'anthropic' }));
    const config = AppConfig.load(configPath);
    expect(config.providerConf().model).toBe(DEFAULT_CONFIG.providers.anthropic.model);
  });

  it('coworkOutputDir falls back to ~/.cowork_local/output/cowork when unset', () => {
    const configPath = path.join(tmpDir, 'config.json');
    const config = AppConfig.load(configPath);
    expect(config.coworkOutputDir().endsWith(path.join('.cowork_local', 'output', 'cowork'))).toBe(true);
  });

  it('coworkOutputDir honors an explicit output_dir', () => {
    const configPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ cowork: { output_dir: '/custom/out' } }));
    const config = AppConfig.load(configPath);
    expect(config.coworkOutputDir()).toBe(path.resolve('/custom/out'));
  });

  it('mergeAndSave deep-merges a nested partial without wiping sibling fields', () => {
    const configPath = path.join(tmpDir, 'config.json');
    const config = AppConfig.load(configPath);

    config.mergeAndSave({ providers: { anthropic: { api_key: 'new-key' } } as any });

    // The updated field took effect.
    expect(config.data.providers.anthropic.api_key).toBe('new-key');
    // Sibling fields of the same nested object survive the merge.
    expect(config.data.providers.anthropic.model).toBe(DEFAULT_CONFIG.providers.anthropic.model);
    expect(config.data.providers.anthropic.base_url).toBe(DEFAULT_CONFIG.providers.anthropic.base_url);
    // A completely different nested object (openai_compat) is untouched.
    expect(config.data.providers.openai_compat).toEqual(DEFAULT_CONFIG.providers.openai_compat);

    // The merge was also persisted to disk.
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(raw.providers.anthropic.api_key).toBe('new-key');
    expect(raw.providers.anthropic.model).toBe(DEFAULT_CONFIG.providers.anthropic.model);
  });

  it('includes a default empty last_session.cowork', () => {
    const configPath = path.join(tmpDir, 'config.json');
    const config = AppConfig.load(configPath);
    expect(config.data.last_session).toEqual({ cowork: '' });
  });

  it('deep-merges a stored last_session over the default without needing the key to pre-exist', () => {
    const configPath = path.join(tmpDir, 'config.json');
    // Simulates an old config.json written before this field existed.
    fs.writeFileSync(configPath, JSON.stringify({ active_provider: 'anthropic' }));
    const config = AppConfig.load(configPath);
    expect(config.data.last_session).toEqual({ cowork: '' });
  });

  it('preserves a stored last_session.cowork value', () => {
    const configPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ last_session: { cowork: '20260101-000000-000' } }));
    const config = AppConfig.load(configPath);
    expect(config.data.last_session.cowork).toBe('20260101-000000-000');
  });

  it('exposes attachments defaults', () => {
    const config = AppConfig.load(path.join(tmpDir, 'nope.json'));
    expect(config.data.attachments).toEqual({ max_files: 10, max_tokens: 500000 });
  });

  it('backfills attachments for configs written before the field existed', () => {
    const p = path.join(tmpDir, 'old.json');
    fs.writeFileSync(p, JSON.stringify({ active_provider: 'anthropic' }), 'utf-8');
    const config = AppConfig.load(p);
    expect(config.data.attachments).toEqual({ max_files: 10, max_tokens: 500000 });
    expect(config.data.active_provider).toBe('anthropic');
  });

  it('persists a stored attachments override', () => {
    const p = path.join(tmpDir, 'att.json');
    fs.writeFileSync(p, JSON.stringify({ attachments: { max_files: 3 } }), 'utf-8');
    const config = AppConfig.load(p);
    expect(config.data.attachments).toEqual({ max_files: 3, max_tokens: 500000 });
  });
});
