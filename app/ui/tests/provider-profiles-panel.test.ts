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

test("provider form shows inline actions (no overflow menu) with a distinct danger delete", async () => {
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
  // No overflow menu — actions are inline now.
  assert.equal(root.querySelectorAll(".provider-profiles__overflow-toggle").length, 0);
  assert.match(root.querySelector(".provider-profiles__secondary")?.textContent ?? "", /Lưu/u);
  assert.match(root.querySelector(".provider-profiles__test-status")?.textContent ?? "", /Đã kiểm tra/u);

  // Inline utility + a visually-distinct danger delete (not hidden in a menu).
  assert.match(root.querySelector(".provider-profiles__utility")?.textContent ?? "", /Xoá khoá API/u);
  const danger = root.querySelector<HTMLButtonElement>(".provider-profiles__danger");
  assert.ok(danger);
  assert.match(danger.textContent ?? "", /Xoá hồ sơ/u);
  assert.ok(root.querySelector(".provider-profiles__danger-zone"));
  root.remove();
});

test("Dò model fills a searchable datalist and keeps manual entry available", async () => {
  const root = document.createElement("div");
  document.body.append(root);
  const custom = profile({
    id: "c1",
    displayName: "Local",
    providerType: "custom-openai-compat",
    baseUrl: "https://api.example.com/v1",
    modelId: "seed-model",
    credentialConfigured: true,
    credentialAccount: "profile:c1",
    isActive: true,
  });
  // A second profile so this one is deletable/editable without single-profile guards mattering.
  const other = profile({ id: "p2", displayName: "DeepSeek", isActive: false });
  const listed = [custom, other];
  let discoverBaseUrl: string | undefined;
  const client = {
    getSettings: async () => settings(listed),
    listProviderProfiles: async () => ({ profiles: listed, activeProfileId: "c1" }),
    createProviderProfile: async () => listed[0]!,
    updateProviderProfile: async () => listed[0]!,
    deleteProviderProfile: async () => undefined,
    setActiveProviderProfile: async () => settings(listed),
    storeProfileCredential: async () => settings(listed),
    removeProfileCredential: async () => settings(listed),
    testProfileConnection: async () => ({ ok: true }),
    discoverProfileModels: async (_profileId: string, baseUrl?: string) => {
      discoverBaseUrl = baseUrl;
      return { ok: true, models: ["beta-model", "alpha-model"] };
    },
  } as unknown as ServiceClient;

  mountProviderProfilesPanel(root, { client });
  await new Promise((r) => setTimeout(r, 0));

  root.querySelector<HTMLButtonElement>(".provider-profiles__edit")!.click();

  const discoverBtn = root.querySelector<HTMLButtonElement>(".provider-profiles__discover");
  assert.ok(discoverBtn);
  assert.equal(discoverBtn.disabled, false);
  discoverBtn.click();
  await new Promise((r) => setTimeout(r, 0));

  const options = [...root.querySelectorAll("datalist#provider-profiles-model-options option")].map(
    (o) => (o as HTMLOptionElement).value,
  );
  assert.deepEqual(options, ["beta-model", "alpha-model"]);
  assert.equal(discoverBaseUrl, "https://api.example.com/v1");
  assert.match(root.querySelector(".provider-profiles__discover-status")?.textContent ?? "", /2 model/u);

  // Manual entry is always retained: the input accepts an id not in the discovered list.
  const modelInput = root.querySelector<HTMLInputElement>(".provider-profiles__model-custom")!;
  assert.equal(modelInput.getAttribute("list"), "provider-profiles-model-options");
  modelInput.value = "hand-typed-model";
  assert.equal(modelInput.value, "hand-typed-model");
  root.remove();
});
