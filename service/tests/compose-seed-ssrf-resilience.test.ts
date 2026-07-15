/**
 * Boot resilience against a persisted provider endpoint the SSRF policy refuses (regression).
 *
 * Real incident (2026-07-14): a custom OpenAI-compatible profile with
 * `baseUrl: "http://127.0.0.1:8080/v1"` was persisted, and from the next launch on
 * `seedFromSettings` / `syncActiveProfile` re-validated it with the release SSRF policy and
 * THREW — killing the whole service start, including the settings-only onboarding tier whose
 * entire purpose is letting the user repair configuration. The renderer honestly stayed
 * "Không khả dụng" with every panel unmounted: a self-bricked app.
 *
 * Contract proven here: a policy-refused persisted endpoint must degrade to "endpoint not
 * configured at boot" — composition and startup succeed, health answers, and the refused
 * endpoint is NOT configured on the runtime port (the policy is still enforced; only the
 * blast radius changes). Runtime configure/switch paths keep throwing the typed error.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtempSync } from "node:fs";
import { createCoworkService, startCoworkService, type CoworkServiceOptions } from "../src/index.js";
import { createMemoryStore } from "../src/credential/index.js";
import type { SettingsFs } from "../src/diagnostics/index.js";
import { CUSTOM_OPENAI_COMPAT_ID, type DnsResolver } from "../src/provider/index.js";

/** The user's real bricking document shape (version 3), secrets replaced. */
const BRICKED_SETTINGS = JSON.stringify({
  version: 3,
  general: { theme: "system", verboseLogging: false, telemetryEnabled: false },
  providers: [
    {
      providerId: CUSTOM_OPENAI_COMPAT_ID,
      baseUrl: "http://127.0.0.1:8080/v1",
      envVar: "COWORK_TEST_PROFILE_KEY",
    },
  ],
  modelPreference: {
    default: { providerID: CUSTOM_OPENAI_COMPAT_ID, modelID: "local-model" },
  },
  providerProfiles: [
    {
      id: "profile-local-gw",
      displayName: "private-gpt-gateway",
      providerType: CUSTOM_OPENAI_COMPAT_ID,
      baseUrl: "http://127.0.0.1:8080/v1",
      modelId: "local-model",
      envVar: "COWORK_TEST_PROFILE_KEY",
      createdAt: "2026-07-14T16:01:28.028Z",
      updatedAt: "2026-07-14T16:25:51.063Z",
    },
  ],
  activeProfileId: "profile-local-gw",
});

function seededSettingsFs(initial: string): SettingsFs {
  let data: string | undefined = initial;
  return {
    read: () => Promise.resolve(data),
    write: (d) => {
      data = d;
      return Promise.resolve();
    },
  };
}

/** Deterministic resolver: never touches real DNS (loopback literals bypass it anyway). */
const nullResolver: DnsResolver = () => Promise.resolve([]);

function bootOptions(diagnostics?: string[]): CoworkServiceOptions {
  // Hermetic state dir: never share `.runtime/*` with concurrently-running suites (Windows
  // atomic-rename on a shared skills-enabled.json races to EPERM).
  const stateDir = mkdtempSync(path.join(os.tmpdir(), "cowork-ssrf-resilience-"));
  return {
    credentialStore: createMemoryStore(),
    settingsFs: seededSettingsFs(BRICKED_SETTINGS),
    dnsResolver: nullResolver,
    conversationsDir: path.join(stateDir, "conversations"),
    skillsStateFilePath: path.join(stateDir, "skills-enabled.json"),
    agentStoreFilePath: path.join(stateDir, "agents.json"),
    taskStoreFilePath: path.join(stateDir, "tasks.json"),
    ...(diagnostics !== undefined
      ? { onBootDiagnostic: (line: string) => diagnostics.push(line) }
      : {}),
  };
}

test("composition survives a persisted SSRF-refused provider endpoint", async () => {
  // Before the fix this rejects with SsrfBlockedError(scheme_not_https) out of seedFromSettings.
  const diagnostics: string[] = [];
  const composed = await createCoworkService(bootOptions(diagnostics));
  assert.ok(composed, "service must compose despite the refused persisted endpoint");

  // The refused endpoint must NOT be configured on the runtime port (policy still enforced).
  assert.equal(composed.deps.providerPort.baseUrlFor(CUSTOM_OPENAI_COMPAT_ID), undefined);

  // Runtime profile switching keeps the honest typed refusal — only BOOT degrades.
  await assert.rejects(
    composed.deps.profileRuntimeBridge.syncProfileById("profile-local-gw"),
    (err: unknown) => err instanceof Error && err.name === "SsrfBlockedError",
  );

  // The skip leaves a redacted trace (never a silent swallow), with no URL/secret in it.
  assert.ok(
    diagnostics.some((line) => line.includes("endpoint_skipped") && line.includes("scheme_not_https")),
    `expected a boot diagnostic, got: ${JSON.stringify(diagnostics)}`,
  );
  for (const line of diagnostics) {
    assert.ok(!line.includes("127.0.0.1") && !line.includes("8080"), "diagnostic must not carry the URL");
  }
});

test("service starts and answers health despite the refused persisted endpoint", async () => {
  const { running } = await startCoworkService(bootOptions());
  try {
    const response = await fetch(`${running.baseUrl}/v1/health`, {
      headers: { authorization: `Bearer ${running.clientToken}` },
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { ok?: boolean };
    assert.equal(body.ok, true);
  } finally {
    await running.service.stop();
  }
});
