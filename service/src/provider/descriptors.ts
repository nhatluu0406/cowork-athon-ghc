/**
 * The five target provider descriptors (CGHC-010, PR10 / ADR 0005 §"Five target
 * providers"). Anthropic, OpenAI, Google (Gemini), OpenRouter, and ONE user-defined
 * OpenAI-compatible endpoint. This is pure, provider-neutral DATA: adding a provider is a
 * new descriptor, never a new code branch (PR1). No descriptor carries a key — credentials
 * cross the port only as a `CredentialRef` handle (ADR 0005:39).
 *
 * Env-var names are consumed from CGHC-001's confirmed `BUILTIN_PROVIDER_ENV` map (the
 * single source of truth for how OpenCode reads a key), not re-declared here.
 *
 * NOT-live-tested (PR10): every descriptor sets `liveTested: false`. The Google env-name
 * (`GOOGLE_API_KEY` vs `GOOGLE_GENERATIVE_AI_API_KEY`) is carried from CGHC-001 as
 * unverified against the live `@ai-sdk/google`; no live LLM call is made in this task.
 */

import type { ProviderDescriptor, ProviderField } from "@cowork-ghc/contracts";
import {
  BUILTIN_PROVIDER_ENV,
  customOpenAiCompatibleEnv,
  type BuiltInProviderId,
  type ProviderEnvSpec,
} from "@cowork-ghc/runtime";

/** Descriptor id for the user-defined OpenAI-compatible endpoint (the 5th target). */
export const CUSTOM_OPENAI_COMPAT_ID = "custom-openai-compat" as const;

const API_KEY_FIELD: ProviderField = {
  name: "apiKey",
  label: "API key",
  required: true,
  secret: true,
};

const BASE_URL_FIELD: ProviderField = {
  name: "baseUrl",
  label: "Base URL (https)",
  required: true,
  secret: false,
};

const ENV_VAR_FIELD: ProviderField = {
  name: "envVar",
  label: "Env var name",
  required: true,
  secret: false,
};

/** Built-in descriptors keyed by their runtime provider id. Models are a curated preset. */
const BUILTIN_DESCRIPTORS: Readonly<Record<BuiltInProviderId, ProviderDescriptor>> = {
  anthropic: {
    id: "anthropic",
    displayName: "Anthropic",
    authKind: "api_key",
    requiredFields: [API_KEY_FIELD],
    models: [
      { ref: { providerID: "anthropic", modelID: "claude-3-5-sonnet-latest" }, displayName: "Claude 3.5 Sonnet" },
    ],
    liveTested: false,
  },
  openai: {
    id: "openai",
    displayName: "OpenAI",
    authKind: "api_key",
    requiredFields: [API_KEY_FIELD],
    models: [{ ref: { providerID: "openai", modelID: "gpt-4o" }, displayName: "GPT-4o" }],
    liveTested: false,
  },
  google: {
    id: "google",
    displayName: "Google (Gemini)",
    authKind: "api_key",
    requiredFields: [API_KEY_FIELD],
    models: [
      { ref: { providerID: "google", modelID: "gemini-1.5-pro" }, displayName: "Gemini 1.5 Pro" },
    ],
    liveTested: false,
  },
  openrouter: {
    id: "openrouter",
    displayName: "OpenRouter",
    authKind: "api_key",
    // Logical model id; the OpenRouter `vendor/` prefix is applied only at the adapter
    // edge by the runtime, never stored in app state (ADR 0005:48, refs.ts).
    requiredFields: [API_KEY_FIELD],
    models: [
      { ref: { providerID: "openrouter", modelID: "anthropic/claude-3.5-sonnet" }, displayName: "Claude 3.5 Sonnet (via OpenRouter)" },
    ],
    liveTested: false,
  },
};

/** The user-defined OpenAI-compatible descriptor. Requires a base_url + a key + env-var name. */
const CUSTOM_DESCRIPTOR: ProviderDescriptor = {
  id: CUSTOM_OPENAI_COMPAT_ID,
  displayName: "Custom (OpenAI-compatible)",
  authKind: "api_key_custom_header",
  requiredFields: [BASE_URL_FIELD, API_KEY_FIELD, ENV_VAR_FIELD],
  models: [], // user-defined at configure time; no preset list
  liveTested: false,
};

/** All five targets, in a stable order. Provider-neutral: consumers iterate, never branch. */
export const PROVIDER_DESCRIPTORS: readonly ProviderDescriptor[] = Object.freeze([
  BUILTIN_DESCRIPTORS.anthropic,
  BUILTIN_DESCRIPTORS.openai,
  BUILTIN_DESCRIPTORS.google,
  BUILTIN_DESCRIPTORS.openrouter,
  CUSTOM_DESCRIPTOR,
]);

/** True when a descriptor id is the user-defined OpenAI-compatible endpoint. */
export function isCustomEndpoint(id: string): boolean {
  return id === CUSTOM_OPENAI_COMPAT_ID;
}

/** True when a descriptor requires a user-supplied base_url (SSRF-checked). */
export function requiresBaseUrl(id: string): boolean {
  return isCustomEndpoint(id);
}

/**
 * Resolve the runtime {@link ProviderEnvSpec} (env-var name OpenCode reads) for a
 * descriptor id. Built-ins come from CGHC-001's confirmed map; the custom endpoint's
 * env-var name is user-supplied. This is how a `CredentialRef` is later injected — the
 * descriptor itself never holds a key.
 */
export function providerEnvSpec(id: string, customEnvVar?: string): ProviderEnvSpec {
  if (id in BUILTIN_PROVIDER_ENV) {
    return BUILTIN_PROVIDER_ENV[id as BuiltInProviderId];
  }
  if (isCustomEndpoint(id)) {
    if (!customEnvVar || customEnvVar.trim().length === 0) {
      throw new Error("Custom OpenAI-compatible provider requires an env-var name.");
    }
    return customOpenAiCompatibleEnv({ providerId: id, envVar: customEnvVar });
  }
  throw new Error(`Unknown provider id: ${JSON.stringify(id)}`);
}
