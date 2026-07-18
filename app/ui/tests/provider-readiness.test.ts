/**
 * Unit tests for provider-readiness model.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { SettingsView } from "../src/service-client.js";
import {
  assessConfigPreflight,
  assessSendPreflight,
  buildReadinessInput,
  dispatchGateReason,
  isBaseUrlLocallyValid,
  localServiceStatus,
  overallReadiness,
  providerModelLabel,
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

test("providerStatus treats an untested active profile as warning, not healthy", () => {
  const settings: SettingsView = {
    ...baseSettings(),
    providerProfiles: [
      {
        id: "deepseek-main",
        displayName: "DeepSeek",
        providerType: "deepseek",
        baseUrl: "https://api.deepseek.com/v1",
        modelId: "deepseek-chat",
        createdAt: "2026-07-14T00:00:00.000Z",
        updatedAt: "2026-07-14T00:00:00.000Z",
        credentialConfigured: true,
        isActive: true,
        verificationCurrent: false,
      },
    ],
    activeProfileId: "deepseek-main",
  };
  const copy = providerStatus(settings, "unknown");
  assert.equal(copy.label, "DeepSeek · Chưa kiểm tra");
  assert.equal(copy.ok, false);
});

test("providerStatus trusts persisted verificationCurrent after restart", () => {
  const settings: SettingsView = {
    ...baseSettings(),
    providerProfiles: [
      {
        id: "deepseek-main",
        displayName: "DeepSeek",
        providerType: "deepseek",
        baseUrl: "https://api.deepseek.com/v1",
        modelId: "deepseek-chat",
        createdAt: "2026-07-14T00:00:00.000Z",
        updatedAt: "2026-07-14T00:00:00.000Z",
        credentialConfigured: true,
        isActive: true,
        verificationCurrent: true,
        lastVerifiedOk: true,
        lastVerifiedAt: "2026-07-15T12:00:00.000Z",
      },
    ],
    activeProfileId: "deepseek-main",
  };
  const copy = providerStatus(settings, "unknown");
  assert.equal(copy.label, "DeepSeek · Đã kiểm tra");
  assert.equal(copy.ok, true);
});

test("providerStatus reports missing credential separately from local service", () => {
  const settings = baseSettings();
  const noCred: SettingsView = {
    ...settings,
    providers: [{ providerId: "custom-openai-compat", hasCredential: false }],
  };
  const copy = providerStatus(noCred);
  assert.equal(copy.label, "DeepSeek · Chưa cấu hình");
  assert.equal(providerModelLabel(noCred), "DeepSeek / deepseek-chat");
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

test("assessSendPreflight blocks runtime busy phases", () => {
  const busy = assessSendPreflight(
    input({
      conv: {
        state: {
          runtimePhase: "starting",
          activeConversationId: "c1",
          activeRecord: null,
        },
      },
    }),
  );
  assert.equal(busy.canSend, false);
  assert.equal(busy.blockKind, "runtime_busy");
});

test("assessConfigPreflight allows mid-send starting phase so ensureRuntimeSession can proceed", () => {
  const midSend = assessConfigPreflight(
    input({
      conv: {
        state: {
          runtimePhase: "starting",
          activeConversationId: "c1",
          activeRecord: null,
        },
      },
    }),
  );
  assert.equal(midSend.canSend, true);
  assert.equal(midSend.blockKind, null);
});

test("assessConfigPreflight still blocks missing credential", () => {
  const settings = baseSettings();
  const noCred: SettingsView = {
    ...settings,
    providers: [{ providerId: "custom-openai-compat", hasCredential: false }],
  };
  const preflight = assessConfigPreflight(input({ settings: noCred }));
  assert.equal(preflight.canSend, false);
  assert.equal(preflight.blockKind, "credential_missing");
});

test("historical completed conversation is not composer-locked", () => {
  const preflight = assessSendPreflight(
    input({
      continuationUnlocked: false,
      conv: {
        state: {
          runtimePhase: "idle",
          activeConversationId: "c1",
          activeRecord: {
            id: "c1",
            title: "Old",
            workspacePath: "C:\\ws",
            runtimeSessionId: "rt-old",
            status: "completed",
            createdAt: "2026-07-14T00:00:00.000Z",
            updatedAt: "2026-07-14T00:00:00.000Z",
            messageCount: 2,
            messages: [
              { id: "m1", role: "user", text: "hi", at: "2026-07-14T00:00:00.000Z" },
              { id: "m2", role: "assistant", text: "yo", at: "2026-07-14T00:00:01.000Z" },
            ],
            runtimeTurns: [],
          },
        },
      },
    }),
  );
  assert.equal(preflight.canSend, true);
  assert.equal(preflight.blockKind, null);
});

test("shouldShowContinuationBanner stays off for completed history", () => {
  assert.equal(shouldShowContinuationBanner(null, null, "idle"), false);
  assert.equal(
    shouldShowContinuationBanner(
      "c1",
      {
        id: "c1",
        title: "Old",
        workspacePath: "C:\\ws",
        runtimeSessionId: "rt",
        status: "completed",
        createdAt: "2026-07-14T00:00:00.000Z",
        updatedAt: "2026-07-14T00:00:00.000Z",
        messageCount: 1,
        messages: [{ id: "m1", role: "user", text: "hi", at: "2026-07-14T00:00:00.000Z" }],
        runtimeTurns: [],
      },
      "idle",
    ),
    false,
  );
});

test("overallReadiness stays danger while the local service is down", () => {
  const copy = overallReadiness({
    serviceOk: false,
    serviceLabel: "Local service: Không khả dụng",
    activeWorkspace: "C:\\ws",
    settings: baseSettings(),
    connectionTestState: "ok",
  });
  assert.equal(copy.tone, "danger");
  assert.equal(copy.label, "Không khả dụng");
});

test("overallReadiness never reads Sẵn sàng without a workspace", () => {
  const copy = overallReadiness({
    serviceOk: true,
    serviceLabel: "Local service: Sẵn sàng",
    activeWorkspace: null,
    settings: baseSettings(),
    connectionTestState: "ok",
  });
  assert.equal(copy.tone, "warn");
  assert.match(copy.label, /workspace/i);
});

test("overallReadiness never reads Sẵn sàng while the provider is unconfigured (F4)", () => {
  const noCred: SettingsView = {
    ...baseSettings(),
    providers: [{ providerId: "custom-openai-compat", hasCredential: false }],
  };
  const copy = overallReadiness({
    serviceOk: true,
    serviceLabel: "Local service: Sẵn sàng",
    activeWorkspace: "C:\\ws",
    settings: noCred,
    connectionTestState: "unknown",
  });
  assert.equal(copy.tone, "warn");
  assert.match(copy.label, /provider/i);
  assert.notEqual(copy.label, "Sẵn sàng");
});

test("overallReadiness reads Sẵn sàng only when service, workspace and provider are all ready", () => {
  const copy = overallReadiness({
    serviceOk: true,
    serviceLabel: "Local service: Sẵn sàng",
    activeWorkspace: "C:\\ws",
    settings: baseSettings(),
    connectionTestState: "ok",
  });
  assert.equal(copy.tone, "ok");
  assert.equal(copy.label, "Sẵn sàng");
});

test("dispatchGateReason gives an honest reason per block and empty when runnable", () => {
  assert.equal(dispatchGateReason(null), "");
  assert.match(dispatchGateReason("workspace_missing"), /workspace/i);
  assert.match(dispatchGateReason("credential_missing"), /provider/i);
  assert.match(dispatchGateReason("provider_missing"), /provider/i);
  assert.match(dispatchGateReason("local_service_unavailable"), /Local service/i);
});

test("a fresh unconfigured profile blocks dispatch runs with a provider reason (F3)", () => {
  const noCred: SettingsView = {
    ...baseSettings(),
    providers: [{ providerId: "custom-openai-compat", hasCredential: false }],
  };
  const cfg = assessConfigPreflight(input({ settings: noCred }));
  assert.equal(cfg.canSend, false);
  const reason = dispatchGateReason(cfg.blockKind);
  assert.match(reason, /provider/i);
});

test("isBaseUrlLocallyValid rejects garbage", () => {
  assert.equal(isBaseUrlLocallyValid("::::"), false);
  assert.equal(isBaseUrlLocallyValid("https://api.example.com"), true);
});
