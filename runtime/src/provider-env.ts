/**
 * Per-provider environment variable names the pinned OpenCode reads (keyless spike,
 * ADR 0006 SEC-1 / design §6). OpenCode resolves provider credentials from the
 * process environment using the models.dev provider registry `env[]` array, where
 * `env[0]` is the primary credential (reference note:
 * `apps/app/src/react-app/domains/connections/provider-auth/cloud-provider-config.ts:42-47`).
 *
 * The concrete names below were confirmed against the models.dev catalog cached in the
 * reference source (read-only, for fact confirmation — NOT copied, NOT a build
 * dependency). Cowork GHC injects the resolved key as an env var into the OpenCode
 * child spawn and NEVER writes `auth.json`/`env.json` (ADR 0001 consequence + SEC-1).
 *
 * Reference (fact-confirmation only; `/ee` is Fair Source — never copied):
 *   `ee/apps/inference/src/models/base.json:1`
 *     openai      => env ["OPENAI_API_KEY"]                                   npm @ai-sdk/openai
 *     anthropic   => env ["ANTHROPIC_API_KEY"]                                npm @ai-sdk/anthropic
 *     openrouter  => env ["OPENROUTER_API_KEY"] api https://openrouter.ai/api/v1
 *     google      => env ["GOOGLE_API_KEY","GOOGLE_GENERATIVE_AI_API_KEY","GEMINI_API_KEY"] npm @ai-sdk/google
 *   OpenAI-compatible custom providers each define their OWN env var name +
 *   base URL (e.g. requesty => ["REQUESTY_API_KEY"] api https://router.requesty.ai/v1;
 *   alibaba-cn => ["DASHSCOPE_API_KEY"]), npm @ai-sdk/openai-compatible.
 */

import { isValidEnvName } from "./env-name.js";

/** Built-in provider identifiers Cowork GHC supports at launch. */
export type BuiltInProviderId = "openai" | "anthropic" | "openrouter" | "google";

/** Spec for how a provider's credential is passed to OpenCode via process env. */
export interface ProviderEnvSpec {
  /** OpenCode / models.dev provider id. */
  readonly providerId: string;
  /** The env var Cowork GHC injects the resolved key into (models.dev `env[0]`). */
  readonly primaryEnvVar: string;
  /** All env var names OpenCode accepts for this provider (models.dev `env[]`). */
  readonly acceptedEnvVars: readonly string[];
  /** Whether this provider requires a user-supplied base URL (OpenAI-compatible). */
  readonly requiresBaseUrl: boolean;
}

/**
 * Typed map of the confirmed built-in provider env var names. `primaryEnvVar` is the
 * name Cowork GHC injects; `acceptedEnvVars` documents every name OpenCode will read
 * (so redaction and detection cover all of them).
 */
export const BUILTIN_PROVIDER_ENV: Readonly<Record<BuiltInProviderId, ProviderEnvSpec>> =
  Object.freeze({
    openai: {
      providerId: "openai",
      primaryEnvVar: "OPENAI_API_KEY",
      acceptedEnvVars: ["OPENAI_API_KEY"],
      requiresBaseUrl: false,
    },
    anthropic: {
      providerId: "anthropic",
      primaryEnvVar: "ANTHROPIC_API_KEY",
      acceptedEnvVars: ["ANTHROPIC_API_KEY"],
      requiresBaseUrl: false,
    },
    openrouter: {
      providerId: "openrouter",
      primaryEnvVar: "OPENROUTER_API_KEY",
      acceptedEnvVars: ["OPENROUTER_API_KEY"],
      requiresBaseUrl: false,
    },
    google: {
      providerId: "google",
      primaryEnvVar: "GOOGLE_API_KEY",
      acceptedEnvVars: [
        "GOOGLE_API_KEY",
        "GOOGLE_GENERATIVE_AI_API_KEY",
        "GEMINI_API_KEY",
      ],
      requiresBaseUrl: false,
    },
  });

/** The npm adapter OpenCode uses for user-defined OpenAI-compatible providers. */
export const OPENAI_COMPATIBLE_NPM = "@ai-sdk/openai-compatible" as const;

/** Look up the env spec for a built-in provider id. */
export function builtInProviderEnv(providerId: BuiltInProviderId): ProviderEnvSpec {
  return BUILTIN_PROVIDER_ENV[providerId];
}

/**
 * Build an env spec for a user-defined OpenAI-compatible provider. The env var name
 * and base URL are user-supplied (they are NOT fixed by OpenCode) — the 5th provider
 * class in the acceptance criteria. The env var name must be a valid POSIX-style env
 * identifier so it is safe to inject.
 */
export function customOpenAiCompatibleEnv(input: {
  providerId: string;
  envVar: string;
}): ProviderEnvSpec {
  const envVar = input.envVar.trim();
  if (!isValidEnvName(envVar)) {
    throw new Error(`Invalid env var name for custom provider: ${JSON.stringify(input.envVar)}`);
  }
  const providerId = input.providerId.trim();
  if (!providerId) {
    throw new Error("Custom provider id must be a non-empty string");
  }
  return {
    providerId,
    primaryEnvVar: envVar,
    acceptedEnvVars: [envVar],
    requiresBaseUrl: true,
  };
}
