import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BUILTIN_PROVIDER_ENV,
  OPENAI_COMPATIBLE_NPM,
  builtInProviderEnv,
  customOpenAiCompatibleEnv,
} from "../src/provider-env.js";

test("confirmed built-in provider env var names (keyless spike, models.dev base.json:1)", () => {
  assert.equal(builtInProviderEnv("openai").primaryEnvVar, "OPENAI_API_KEY");
  assert.equal(builtInProviderEnv("anthropic").primaryEnvVar, "ANTHROPIC_API_KEY");
  assert.equal(builtInProviderEnv("openrouter").primaryEnvVar, "OPENROUTER_API_KEY");
  assert.equal(builtInProviderEnv("google").primaryEnvVar, "GOOGLE_API_KEY");
});

test("google accepts all three env names OpenCode reads", () => {
  assert.deepEqual(builtInProviderEnv("google").acceptedEnvVars, [
    "GOOGLE_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "GEMINI_API_KEY",
  ]);
});

test("built-in map is frozen and provider-neutral (no baseUrl required)", () => {
  assert.ok(Object.isFrozen(BUILTIN_PROVIDER_ENV));
  for (const spec of Object.values(BUILTIN_PROVIDER_ENV)) {
    assert.equal(spec.requiresBaseUrl, false);
    assert.ok(spec.acceptedEnvVars.includes(spec.primaryEnvVar));
  }
});

test("user-defined OpenAI-compatible provider carries its own env name + base URL", () => {
  const spec = customOpenAiCompatibleEnv({ providerId: "my-gateway", envVar: "MY_GATEWAY_KEY" });
  assert.equal(spec.primaryEnvVar, "MY_GATEWAY_KEY");
  assert.equal(spec.requiresBaseUrl, true);
  assert.deepEqual(spec.acceptedEnvVars, ["MY_GATEWAY_KEY"]);
  assert.equal(OPENAI_COMPATIBLE_NPM, "@ai-sdk/openai-compatible");
});

test("custom provider rejects an unsafe env var name", () => {
  assert.throws(() => customOpenAiCompatibleEnv({ providerId: "x", envVar: "bad name" }));
  assert.throws(() => customOpenAiCompatibleEnv({ providerId: "x", envVar: "9KEY; rm -rf" }));
  assert.throws(() => customOpenAiCompatibleEnv({ providerId: "", envVar: "OK_KEY" }));
});
