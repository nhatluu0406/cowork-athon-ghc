/**
 * CGHC-022 — the settings router exposes the new onboarding-persistence routes over the
 * loopback boundary as a TRUE client of the service (token-guarded, server-side validated).
 *
 * Covers the two routes a later live launch needs: `PUT /v1/settings/providers/env-var`
 * (the non-secret child env-var NAME) and `PUT /v1/settings/active-workspace` (the granted
 * root). Asserts the returned {@link SettingsView} carries the new `envVar` + `activeWorkspace`
 * fields, and that a malformed body is a 400 (`SettingsRequestError` → bad_request), not a 500.
 * A real in-memory store backs the router so persistence is exercised end to end.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { ModelRef } from "@cowork-ghc/contracts";
import { startService } from "../src/index.js";
import {
  createSettingsRouter,
  openSettingsStore,
  SETTINGS_ENV_VAR_PATH,
  SETTINGS_ACTIVE_WORKSPACE_PATH,
  type SettingsFs,
  type SettingsModelPort,
  type SettingsView,
} from "../src/diagnostics/index.js";

function memoryFs(): SettingsFs {
  let data: string | undefined;
  return {
    read: async () => data,
    write: async (next: string) => {
      data = next;
    },
  };
}

const NO_MODEL: SettingsModelPort = {
  clearSessionModel: () => false,
  defaultModelRef: (): ModelRef | undefined => undefined,
};

async function running() {
  const store = await openSettingsStore({ fs: memoryFs() });
  const service = await startService({ routers: [createSettingsRouter(store, NO_MODEL)] });
  return { service, store };
}

test("PUT env-var: token-guarded, persists the non-secret name, view shows envVar", async () => {
  const { service } = await running();
  try {
    // Missing token -> 401 (route is token-guarded, no public opt-out).
    const unauth = await fetch(`${service.baseUrl}${SETTINGS_ENV_VAR_PATH}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerId: "custom-openai-compat", envVar: "CUSTOM_API_KEY" }),
    });
    assert.equal(unauth.status, 401);

    const headers = {
      authorization: `Bearer ${service.clientToken}`,
      "content-type": "application/json",
    };
    const res = await fetch(`${service.baseUrl}${SETTINGS_ENV_VAR_PATH}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ providerId: "custom-openai-compat", envVar: "CUSTOM_API_KEY" }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: { settings: SettingsView } };
    const provider = body.data.settings.providers.find((p) => p.providerId === "custom-openai-compat");
    assert.equal(provider?.envVar, "CUSTOM_API_KEY", "view surfaces the persisted envVar name");
  } finally {
    await service.service.stop();
  }
});

test("PUT active-workspace: persists the root and the view exposes activeWorkspace", async () => {
  const { service } = await running();
  try {
    const headers = {
      authorization: `Bearer ${service.clientToken}`,
      "content-type": "application/json",
    };

    // Before any grant the view reports activeWorkspace: null.
    const before = await fetch(`${service.baseUrl}/v1/settings`, {
      headers: { authorization: `Bearer ${service.clientToken}` },
    });
    const beforeBody = (await before.json()) as { data: { settings: SettingsView } };
    assert.equal(beforeBody.data.settings.activeWorkspace, null);

    const res = await fetch(`${service.baseUrl}${SETTINGS_ACTIVE_WORKSPACE_PATH}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ rootPath: "C:/Users/test/Workspace" }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: { settings: SettingsView } };
    assert.deepEqual(body.data.settings.activeWorkspace, { rootPath: "C:/Users/test/Workspace" });
  } finally {
    await service.service.stop();
  }
});

test("malformed env-var / active-workspace bodies are 400 bad_request (not 500)", async () => {
  const { service } = await running();
  try {
    const headers = {
      authorization: `Bearer ${service.clientToken}`,
      "content-type": "application/json",
    };
    const cases: { path: string; body: string }[] = [
      { path: SETTINGS_ENV_VAR_PATH, body: "{}" },
      { path: SETTINGS_ENV_VAR_PATH, body: JSON.stringify({ providerId: "openai", envVar: "" }) },
      { path: SETTINGS_ENV_VAR_PATH, body: JSON.stringify({ envVar: "X" }) },
      { path: SETTINGS_ACTIVE_WORKSPACE_PATH, body: "{}" },
      { path: SETTINGS_ACTIVE_WORKSPACE_PATH, body: JSON.stringify({ rootPath: "   " }) },
    ];
    for (const c of cases) {
      const res = await fetch(`${service.baseUrl}${c.path}`, { method: "PUT", headers, body: c.body });
      assert.equal(res.status, 400, `${c.path} body ${c.body} must be 400`);
      const env = (await res.json()) as { ok: boolean; error?: { code: string; message: string } };
      assert.equal(env.ok, false);
      assert.equal(env.error?.code, "bad_request");
      assert.ok((env.error?.message ?? "").length > 0, "a non-empty, secret-free message is surfaced");
    }
  } finally {
    await service.service.stop();
  }
});

test("view includes new fields with credential + baseUrl untouched", async () => {
  const { service, store } = await running();
  try {
    await store.setProviderCredentialRef("openai", { store: "os", account: "cowork/openai/default" });
    const res = await fetch(`${service.baseUrl}/v1/settings`, {
      headers: { authorization: `Bearer ${service.clientToken}` },
    });
    const body = (await res.json()) as { data: { settings: SettingsView } };
    const view = body.data.settings;
    assert.equal(view.activeWorkspace, null, "activeWorkspace field present (null until granted)");
    const openai = view.providers.find((p) => p.providerId === "openai");
    assert.equal(openai?.hasCredential, true);
    assert.equal(openai?.credentialAccount, "cowork/openai/default", "handle label only, never a key");
    assert.equal(openai?.envVar, undefined, "envVar absent when unset");
  } finally {
    await service.service.stop();
  }
});
