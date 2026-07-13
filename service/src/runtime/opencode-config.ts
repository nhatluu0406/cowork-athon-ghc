/**
 * Production OpenCode project-config writer for the supervisor (CGHC-028 Wave A1).
 *
 * OpenCode needs a NON-SECRET provider definition to reach a user-defined OpenAI-compatible
 * endpoint (base URL + adapter + model list). The API key is written ONLY as the literal
 * `{env:NAME}` reference OpenCode resolves from the child process env at launch (verified
 * against pinned v1.17.11). The resolved key value NEVER touches this file — it flows solely
 * via the injected child env (runtime `buildLaunchSpec`), so we never write `auth.json`/`env.json`
 * or persist a key (ADR 0001 / ADR 0006 SEC-1). This mirrors the proven CGHC-024 capture-tool
 * writer, promoted to a production module (tool code is not a build dependency).
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { OPENAI_COMPATIBLE_NPM, isValidEnvName } from "@cowork-ghc/runtime";
import { isE2eMockLlmUrl } from "../provider/e2e-mock-llm.js";

/** Non-secret provider definition for the child's `opencode.json`. */
export interface OpencodeProviderConfig {
  /** Provider id OpenCode registers (e.g. "custom-openai-compat", "openai"). */
  readonly providerId: string;
  /** Human label (non-functional). */
  readonly displayName?: string;
  /** Env var OpenCode reads the key from; injected into the child env by the supervisor. */
  readonly envVar: string;
  /** Model ids to expose (e.g. ["deepseek-chat"]). */
  readonly models: readonly string[];
  /**
   * OpenAI-compatible base URL — present ONLY for a user-defined custom endpoint. When set it
   * MUST be https and non-loopback/non-private. Omit for a built-in provider (models.dev-known).
   */
  readonly baseUrl?: string;
  /** Optional per-tool permission map for the workspace (e.g. `{ edit: "ask" }`). */
  readonly permission?: Readonly<Record<string, string>>;
}

/** Live-session tool permission policy written into `opencode.json` (non-secret). */
export const LIVE_SESSION_PERMISSION_POLICY: Readonly<Record<string, string>> = {
  "*": "ask",
  read: "allow",
  list: "allow",
  glob: "allow",
  grep: "allow",
  delete: "ask",
  bash: "deny",
  webfetch: "deny",
  websearch: "deny",
};
function assertSafeBaseUrl(baseUrl: string): void {
  if (isE2eMockLlmUrl(baseUrl)) return;
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid provider base URL: ${JSON.stringify(baseUrl)}`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`Provider base URL must be https, got ${JSON.stringify(url.protocol)}`);
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const isIpv6 = host.includes(":");
  const privateIpv4 =
    isIpv4 &&
    (host === "0.0.0.0" ||
      host === "127.0.0.1" ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      host.startsWith("169.254.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host));
  const privateIpv6 =
    isIpv6 && (host === "::1" || /^f[cd][0-9a-f]{0,2}:/.test(host) || host.startsWith("fe80:"));
  if (host === "localhost" || privateIpv4 || privateIpv6) {
    throw new Error(`Provider base URL host looks private/loopback: ${JSON.stringify(host)}`);
  }
}

/** Build the NON-SECRET `opencode.json` object. The api key is only the `{env:NAME}` template. */
export function buildOpencodeConfig(config: OpencodeProviderConfig): Record<string, unknown> {
  if (!config.providerId.trim()) throw new Error("providerId must be non-empty");
  if (!isValidEnvName(config.envVar)) {
    throw new Error(`Invalid env var name: ${JSON.stringify(config.envVar)}`);
  }
  if (config.models.length === 0) throw new Error("at least one model id is required");

  const models: Record<string, { name: string }> = {};
  for (const id of config.models) {
    if (!id.trim()) throw new Error("model id must be non-empty");
    models[id] = { name: id };
  }

  const options: Record<string, unknown> = { apiKey: `{env:${config.envVar}}` };
  const provider: Record<string, unknown> = {
    name: config.displayName ?? config.providerId,
    options,
    models,
  };
  if (config.baseUrl !== undefined) {
    assertSafeBaseUrl(config.baseUrl);
    options["baseURL"] = config.baseUrl;
    provider["npm"] = OPENAI_COMPATIBLE_NPM;
  }

  return {
    $schema: "https://opencode.ai/config.json",
    ...(config.permission ? { permission: config.permission } : {}),
    tools: {
      patch: true,
    },
    agent: {
      build: {
        tools: {
          patch: true,
        },
      },
    },
    provider: { [config.providerId]: provider },
  };
}

/**
 * Write the non-secret `opencode.json` into `configDir` and return its path. Throws if the
 * serialized bytes would somehow contain the raw key value (defense in depth: they never should,
 * since only the `{env:...}` reference is written). `forbiddenSecret` is the resolved key value.
 */
export function writeOpencodeConfig(
  configDir: string,
  config: OpencodeProviderConfig,
  forbiddenSecret?: string,
): string {
  const serialized = JSON.stringify(buildOpencodeConfig(config), null, 2);
  if (forbiddenSecret && forbiddenSecret.length > 0 && serialized.includes(forbiddenSecret)) {
    throw new Error("Refusing to write opencode.json: it unexpectedly contains the key value.");
  }
  const path = join(configDir, "opencode.json");
  writeFileSync(path, serialized, "utf8");
  return path;
}
