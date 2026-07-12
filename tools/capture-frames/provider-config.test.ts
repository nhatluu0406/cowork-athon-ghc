/**
 * Unit tests for the NON-SECRET OpenCode provider-config writer (CGHC-024 capture).
 * Proves: (1) the api key is written ONLY as an `{env:NAME}` reference — never a resolved
 * secret; (2) unsafe base URLs (non-https, private/loopback hosts) are rejected before
 * OpenCode ever dials them; (3) the write guard refuses if a real key value leaks in.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOpencodeConfig } from "./provider-config.js";

const base = {
  providerId: "custom-openai-compat",
  displayName: "Custom (OpenAI-compatible)",
  baseUrl: "https://api.deepseek.com/v1",
  envVar: "DEEPSEEK_API_KEY",
  models: ["deepseek-chat"],
} as const;

test("api key is written only as an {env:NAME} reference, never a resolved secret", () => {
  const cfg = buildOpencodeConfig(base) as {
    provider: Record<string, { options: { apiKey: string; baseURL: string }; models: object }>;
  };
  const entry = cfg.provider["custom-openai-compat"];
  assert.ok(entry, "provider entry present");
  assert.equal(entry.options.apiKey, "{env:DEEPSEEK_API_KEY}");
  assert.equal(entry.options.baseURL, "https://api.deepseek.com/v1");
  // The serialized config must contain no plausible secret material — only the reference.
  const serialized = JSON.stringify(cfg);
  assert.ok(serialized.includes("{env:DEEPSEEK_API_KEY}"));
  assert.ok(!/sk-[a-zA-Z0-9]/.test(serialized), "no sk- style key in config");
});

test("models are exposed under the provider entry", () => {
  const cfg = buildOpencodeConfig(base) as {
    provider: Record<string, { models: Record<string, unknown> }>;
  };
  assert.deepEqual(Object.keys(cfg.provider["custom-openai-compat"]!.models), ["deepseek-chat"]);
});

test("permission is auto-allow so a headless tool-call scenario can write its file", () => {
  const cfg = buildOpencodeConfig(base) as { permission: Record<string, string> };
  assert.equal(cfg.permission.edit, "allow");
});

test("rejects a non-https base URL", () => {
  assert.throws(() => buildOpencodeConfig({ ...base, baseUrl: "http://api.deepseek.com/v1" }), /https/);
});

test("rejects private / loopback base URL hosts (IPv4 + IPv6 ULA/link-local)", () => {
  for (const host of [
    "127.0.0.1", "localhost", "10.0.0.5", "192.168.1.2", "169.254.1.1", "172.16.0.1",
    "0.0.0.0", "[::1]", "[fc00::1]", "[fd12:3456::1]", "[fe80::1]",
  ]) {
    assert.throws(
      () => buildOpencodeConfig({ ...base, baseUrl: `https://${host}/v1` }),
      /private|loopback/,
      `expected ${host} to be rejected`,
    );
  }
});

test("does NOT false-reject a public hostname whose label starts like a private range (Low-2)", () => {
  // "10.example.com" / "fcbank.com" are public DNS names, not IP literals — must be allowed.
  for (const host of ["10.example.com", "fcbank.com", "fd-provider.ai", "api.deepseek.com"]) {
    assert.doesNotThrow(() => buildOpencodeConfig({ ...base, baseUrl: `https://${host}/v1` }), `${host} must be allowed`);
  }
});

test("rejects an invalid env var name and an empty model list", () => {
  assert.throws(() => buildOpencodeConfig({ ...base, envVar: "not a valid name" }), /env var/);
  assert.throws(() => buildOpencodeConfig({ ...base, models: [] }), /model/);
});
