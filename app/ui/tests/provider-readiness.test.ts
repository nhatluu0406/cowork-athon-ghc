/**
 * Unit tests for provider-readiness model.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { SettingsView } from "../src/service-client.js";
import {
  assessSendPreflight,
  buildReadinessInput,
  isBaseUrlLocallyValid,
  localServiceStatus,
  providerStatus,
  shouldShowContinuationBanner,
} from "../src/provider-readiness.js";

const baseSettings = (): SettingsView => ({
  general: { theme: "system", verboseLogging: false, telemetryEnabled: false },
  providers: [
    {
      providerId: "custom-openai-compat",
      hasCredential: true,
      baseUrl: "https://api.example.com/v1",
    },
  ],
  defaultModel: { providerID: "custom-openai-compat", modelID: "deepseek-chat" },
  activeWorkspace: { rootPath: "C:\\ws" },
});

function input(overrides: Partial<Parameters<typeof buildReadinessInput>[1]> = {}) {
  return buildReadinessInput(true, {
    activeWorkspace: "C:\\ws",
    settings: baseSettings(),
    conv: {
      state: {
        runtimePhase: "idle",
        activeConversationId: null,
        activeRecord: null,
      },
    },
    continuationUnlocked: true,
    connectionTestState: "unknown",
    ...overrides,
  });
}

test("localServiceStatus distinguishes local service phases", () => {
  const ready = localServiceStatus({ phase: "ready", health: { ok: true } as never });
  assert.match(ready.label, /Local service: Sẵn sàng/);
  const down = localServiceStatus({ phase: "unreachable", code: "x", message: "m", detail: "d", attempt: 1 });
  assert.match(down.label, /Local service: Không khả dụng/);
});

test("providerStatus reports missing credential separately from local service", () => {
  const settings = baseSettings();
  const noCred: SettingsView = {
    ...settings,
    providers: [{ providerId: "custom-openai-compat", hasCredential: false }],
  };
  const copy = providerStatus(noCred);
  assert.match(copy.label, /Provider: Chưa cấu hình/);
});

test("assessSendPreflight blocks missing credential before runtime", () => {
  const settings = baseSettings();
  const noCred: SettingsView = {
    ...settings,
    providers: [{ providerId: "custom-openai-compat", hasCredential: false }],
  };
  const preflight = assessSendPreflight(input({ settings: noCred }));
  assert.equal(preflight.canSend, false);
  assert.equal(preflight.blockKind, "credential_missing");
  assert.match(preflight.message, /khoá API/);
  assert.equal(preflight.showSettingsCta, true);
});

test("assessSendPreflight blocks malformed base URL locally", () => {
  const settings = baseSettings();
  const badUrl: SettingsView = {
    ...settings,
    providers: [
      {
        providerId: "custom-openai-compat",
        hasCredential: true,
        baseUrl: "not-a-url",
      },
    ],
  };
  const preflight = assessSendPreflight(input({ settings: badUrl }));
  assert.equal(preflight.canSend, false);
  assert.equal(preflight.blockKind, "base_url_invalid");
});

test("assessSendPreflight allows locally_ready configuration", () => {
  const preflight = assessSendPreflight(input());
  assert.equal(preflight.canSend, true);
});

test("shouldShowContinuationBanner false for empty first-run state", () => {
  assert.equal(shouldShowContinuationBanner(null, null, "idle"), false);
});

test("isBaseUrlLocallyValid rejects garbage", () => {
  assert.equal(isBaseUrlLocallyValid("::::"), false);
  assert.equal(isBaseUrlLocallyValid("https://api.example.com"), true);
});
