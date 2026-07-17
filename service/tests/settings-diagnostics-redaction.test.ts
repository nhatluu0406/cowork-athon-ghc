/**
 * CGHC-022 SD4 — the settings diagnostics export REUSES the CGHC-021 value-based scrubber,
 * so a planted secret-shaped value never appears in the exported artifact.
 *
 * The settings document is secret-free by construction (a provider references a credential
 * HANDLE only). This test proves the defense-in-depth guarantee: even when a secret-shaped
 * string is planted into a settings field (here the credential account label + a base_url),
 * the export redacts the REGISTERED secret value to zero occurrences. It also confirms the
 * non-secret projection (hasCredential, versions, model ref) is reported truthfully.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSecretScrubber,
  exportSettingsDiagnosticsJson,
  composeSettingsDiagnostics,
  defaultSettings,
  type CoworkSettings,
} from "../src/diagnostics/index.js";

// PLANTED FAKE secret — never a real key.
const FAKE_KEY = "sk-FAKE-settings-value-9a8b7c6d5e4f30211f2e3d4c";

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function plantedSettings(): CoworkSettings {
  return {
    ...defaultSettings(),
    general: { theme: "dark", verboseLogging: true, telemetryEnabled: false },
    // A secret planted where a value could plausibly leak: the account label and a base_url.
    providers: [
      { providerId: "openai", credentialRef: { store: "os", account: `acct-${FAKE_KEY}` } },
      { providerId: "custom-openai-compat", baseUrl: `https://x.test/${FAKE_KEY}/v1` },
    ],
    modelPreference: { default: { providerID: "openai", modelID: "gpt-4o" } },
  };
}

test("SD4: exported settings diagnostics contain the secret VALUE 0 times", () => {
  const scrubber = createSecretScrubber([FAKE_KEY]);
  const settings = plantedSettings();

  // Positive control: the composed (pre-scrub) snapshot REALLY carries the secret, so a
  // 0-hits result is not vacuous — the export could fail if redaction were missing.
  const raw = composeSettingsDiagnostics({ settings, loadSource: "loaded" });
  assert.ok(JSON.stringify(raw).includes(FAKE_KEY), "raw snapshot contains the planted secret");

  const json = exportSettingsDiagnosticsJson({ settings, loadSource: "loaded" }, scrubber);

  // Load-bearing: the registered secret value appears nowhere in the exported artifact.
  assert.equal(countOccurrences(json, FAKE_KEY), 0, "0 hits of the planted secret in the export");
});

test("SD4: the non-secret projection is reported truthfully", () => {
  const scrubber = createSecretScrubber();
  const settings = plantedSettings();
  const json = exportSettingsDiagnosticsJson(
    { settings, loadSource: "recovered", recoveryReason: "unparseable" },
    scrubber,
  );
  const parsed = JSON.parse(json) as {
    version: number;
    general: { theme: string };
    providers: { providerId: string; hasCredential: boolean; baseUrl?: string }[];
    defaultModel: { modelID: string } | null;
    loadSource: string;
    recoveryReason?: string;
  };
  assert.equal(parsed.general.theme, "dark");
  assert.equal(parsed.providers.find((p) => p.providerId === "openai")?.hasCredential, true);
  assert.equal(parsed.providers.find((p) => p.providerId === "custom-openai-compat")?.hasCredential, false);
  assert.equal(parsed.defaultModel?.modelID, "gpt-4o");
  assert.equal(parsed.loadSource, "recovered", "SD5 provenance surfaced in the bundle");
  assert.equal(parsed.recoveryReason, "unparseable");
});
