/**
 * Provider profiles panel UX — primary save+test and overflow actions.
 */

import "./setup-dom.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mountProviderProfilesPanel } from "../src/provider-profiles-panel.js";
import type { ProviderProfileView, SettingsView, ServiceClient } from "../src/service-client.js";

function profile(partial?: Partial<ProviderProfileView>): ProviderProfileView {
  return {
    id: "p1",
    displayName: "DeepSeek",
    providerType: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
    modelId: "deepseek-chat",
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    credentialConfigured: true,
    credentialAccount: "profile:p1",
    isActive: true,
    verificationCurrent: false,
    ...partial,
  };
}

function settings(profiles: readonly ProviderProfileView[]): SettingsView {
  return {
    general: { theme: "system", verboseLogging: false, telemetryEnabled: false },
    providers: [],
    defaultModel: null,
    activeWorkspace: null,
    providerProfiles: profiles,
    activeProfileId: profiles[0]?.id ?? null,
  };
}

test("provider form exposes one primary Lưu & kiểm tra action plus overflow menu", async () => {
  const root = document.createElement("div");
  document.body.append(root);
  const listed = [profile({ verificationCurrent: true, lastVerifiedOk: true, lastVerifiedAt: "2026-07-15T03:00:00.000Z" })];
  const client = {
    getSettings: async () => settings(listed),
    listProviderProfiles: async () => ({ profiles: listed, activeProfileId: "p1" }),
    createProviderProfile: async () => listed[0]!,
    updateProviderProfile: async () => listed[0]!,
    deleteProviderProfile: async () => undefined,
    setActiveProviderProfile: async () => settings(listed),
    storeProfileCredential: async () => settings(listed),
    removeProfileCredential: async () => settings(listed),
    testProfileConnection: async () => ({ ok: true }),
  } as unknown as ServiceClient;

  mountProviderProfilesPanel(root, { client });
  await new Promise((r) => setTimeout(r, 0));

  const edit = root.querySelector<HTMLButtonElement>(".provider-profiles__edit");
  assert.ok(edit);
  edit.click();

  assert.equal(root.querySelectorAll(".provider-profiles__primary").length, 1);
  assert.match(root.querySelector(".provider-profiles__primary")?.textContent ?? "", /Lưu & kiểm tra/u);
  assert.equal(root.querySelectorAll(".llm-test-connection").length, 0);
  assert.ok(root.querySelector(".provider-profiles__overflow-toggle"));
  assert.match(root.querySelector(".provider-profiles__test-status")?.textContent ?? "", /Đã xác minh/u);

  root.querySelector<HTMLButtonElement>(".provider-profiles__overflow-toggle")!.click();
  const items = [...root.querySelectorAll(".provider-profiles__overflow-item")].map((n) => n.textContent);
  assert.ok(items.some((t) => t?.includes("Lưu không kiểm tra")));
  assert.ok(items.some((t) => t?.includes("Xoá khoá API")));
  assert.ok(items.some((t) => t?.includes("Xoá hồ sơ")));
  root.remove();
});
