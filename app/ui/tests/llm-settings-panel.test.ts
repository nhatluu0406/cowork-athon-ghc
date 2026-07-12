/**
 * LLM settings panel focused tests (Slice 3).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import "./setup-dom.js";
import { mountLlmSettingsPanel } from "../src/llm-settings-panel.js";
import { CUSTOM_OPENAI_COMPAT_ID, DEEPSEEK_PRESET } from "../src/provider-presets.js";
import type { ServiceClient, SettingsView } from "../src/service-client.js";

function baseSettings(overrides?: Partial<SettingsView>): SettingsView {
  return {
    general: { theme: "system", verboseLogging: false, telemetryEnabled: false },
    providers: [],
    defaultModel: null,
    activeWorkspace: null,
    ...overrides,
  };
}

function mockClient(state: {
  settings?: SettingsView;
  secretLog?: string[];
}): Pick<
  ServiceClient,
  | "getSettings"
  | "listProviders"
  | "setProviderBaseUrl"
  | "setProviderEnvVar"
  | "setDefaultModel"
  | "storeProviderCredential"
  | "removeProviderCredential"
  | "importProviderCredentialFromEnv"
  | "testProviderConnection"
> {
  let settings = state.settings ?? baseSettings();
  const secretLog = state.secretLog ?? [];
  return {
    listProviders: async () => [
      {
        id: CUSTOM_OPENAI_COMPAT_ID,
        displayName: "Custom",
        authKind: "api_key_custom_header",
        requiredFields: [],
        models: [],
        liveTested: false,
      },
    ],
    getSettings: async () => settings,
    setProviderBaseUrl: async (_id, baseUrl) => {
      settings = {
        ...settings,
        providers: [{ providerId: CUSTOM_OPENAI_COMPAT_ID, hasCredential: false, baseUrl }],
      };
      return settings;
    },
    setProviderEnvVar: async (_id, envVar) => {
      settings = {
        ...settings,
        providers: [{ providerId: CUSTOM_OPENAI_COMPAT_ID, hasCredential: false, envVar }],
      };
      return settings;
    },
    setDefaultModel: async (model) => {
      settings = { ...settings, defaultModel: model };
      return settings;
    },
    storeProviderCredential: async (_id, secret) => {
      secretLog.push(secret);
      settings = {
        ...settings,
        providers: [
          {
            providerId: CUSTOM_OPENAI_COMPAT_ID,
            hasCredential: true,
            credentialAccount: "provider:custom-openai-compat",
          },
        ],
        defaultModel: DEEPSEEK_PRESET.models[0]!.ref,
      };
      return settings;
    },
    removeProviderCredential: async () => {
      settings = baseSettings({ defaultModel: DEEPSEEK_PRESET.models[0]!.ref });
      return settings;
    },
    importProviderCredentialFromEnv: async () => {
      settings = {
        ...settings,
        providers: [
          {
            providerId: CUSTOM_OPENAI_COMPAT_ID,
            hasCredential: true,
            credentialAccount: "provider:custom-openai-compat",
          },
        ],
      };
      return settings;
    },
    testProviderConnection: async () => ({ ok: true }),
  };
}

test("credential save shows configured status without echoing secret in summary", async () => {
  const root = document.createElement("div");
  const secretLog: string[] = [];
  mountLlmSettingsPanel(root, { client: mockClient({ secretLog }) });
  await new Promise((r) => setTimeout(r, 30));
  const input = root.querySelector<HTMLInputElement>(".llm-credential-input");
  assert.ok(input);
  input.value = "sk-test-secret-value-1234567890";
  root.querySelector<HTMLButtonElement>(".llm-save-credential")?.click();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(secretLog.length, 1);
  const summary = root.querySelector(".llm-settings-summary")?.textContent ?? "";
  assert.ok(!summary.includes("sk-test"));
  assert.match(summary, /Đã cấu hình/);
  assert.match(root.querySelector(".llm-credential-status")?.textContent ?? "", /Đã cấu hình/);
});

test("test connection success is shown in status", async () => {
  const root = document.createElement("div");
  mountLlmSettingsPanel(root, {
    client: mockClient({
      settings: baseSettings({
        defaultModel: DEEPSEEK_PRESET.models[0]!.ref,
        providers: [
          {
            providerId: CUSTOM_OPENAI_COMPAT_ID,
            hasCredential: true,
            credentialAccount: "provider:custom-openai-compat",
          },
        ],
      }),
    }),
  });
  await new Promise((r) => setTimeout(r, 30));
  root.querySelector<HTMLButtonElement>(".llm-test-connection")?.click();
  await new Promise((r) => setTimeout(r, 30));
  assert.match(root.querySelector(".llm-settings-status")?.textContent ?? "", /thành công/i);
});
