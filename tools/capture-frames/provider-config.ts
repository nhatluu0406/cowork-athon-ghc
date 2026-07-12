/**
 * NON-SECRET OpenCode project-config writer for the CGHC-024 capture tool (opt-in).
 *
 * OpenCode needs a provider DEFINITION to reach a user-defined OpenAI-compatible endpoint
 * (base URL + adapter + model list). That definition is NON-SECRET: the API key is written
 * ONLY as the literal `{env:NAME}` reference OpenCode resolves from the child process env at
 * launch (verified against pinned 1.17.11: the template resolves from `process.env`). The
 * resolved key value NEVER touches this file — it flows solely via the injected child env
 * (runtime `buildLaunchSpec`), so we still never write `auth.json`/`env.json` or persist a key.
 *
 * `permission: allow` is set for the fixture workspace so the `tool-call` scenario's file
 * write executes unattended (no interactive prompt in a headless capture). This is a
 * throwaway fixture workspace with no sensitive data — never the user's real workspace.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { isValidEnvName } from "@cowork-ghc/runtime";

export interface CustomProviderConfigInput {
  /** Provider id OpenCode registers (e.g. "custom-openai-compat"). */
  readonly providerId: string;
  /** Human label (non-functional). */
  readonly displayName?: string;
  /** OpenAI-compatible base URL. MUST be https (matches the SSRF https-required policy). */
  readonly baseUrl: string;
  /** Env var OpenCode reads the key from; injected into the child env by the launcher. */
  readonly envVar: string;
  /** Model ids to expose (e.g. ["deepseek-chat"]). */
  readonly models: readonly string[];
}

/** Reject obviously-unsafe base URLs before OpenCode ever dials them. */
function assertSafeBaseUrl(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid provider base URL: ${JSON.stringify(baseUrl)}`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`Provider base URL must be https, got ${JSON.stringify(url.protocol)}`);
  }
  // `URL.hostname` keeps the brackets around an IPv6 literal (e.g. "[::1]") — strip them so
  // the literal checks below see "::1".
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  // Apply numeric-range checks ONLY to real IP literals so a public hostname like
  // "10.example.com" or "fcbank.com" is not false-rejected by a prefix match (review Low-2).
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
    isIpv6 &&
    (host === "::1" ||
      /^f[cd][0-9a-f]{0,2}:/.test(host) || // fc00::/7 unique-local
      host.startsWith("fe80:")); // link-local
  const privatey = host === "localhost" || privateIpv4 || privateIpv6;
  if (privatey) {
    throw new Error(`Provider base URL host looks private/loopback: ${JSON.stringify(host)}`);
  }
  return url;
}

/**
 * Build the NON-SECRET opencode.json object. The api key is the literal `{env:NAME}`
 * template — never a resolved secret.
 */
export function buildOpencodeConfig(input: CustomProviderConfigInput): Record<string, unknown> {
  assertSafeBaseUrl(input.baseUrl);
  if (!isValidEnvName(input.envVar)) {
    throw new Error(`Invalid env var name: ${JSON.stringify(input.envVar)}`);
  }
  if (!input.providerId.trim()) throw new Error("providerId must be non-empty");
  if (input.models.length === 0) throw new Error("at least one model id is required");

  const models: Record<string, { name: string }> = {};
  for (const id of input.models) {
    if (!id.trim()) throw new Error("model id must be non-empty");
    models[id] = { name: id };
  }

  return {
    $schema: "https://opencode.ai/config.json",
    // Auto-approve tools in the throwaway fixture workspace so a headless tool-call
    // scenario can write its file without an interactive permission prompt.
    permission: { edit: "allow", bash: "allow", webfetch: "allow" },
    provider: {
      [input.providerId]: {
        npm: "@ai-sdk/openai-compatible",
        name: input.displayName ?? input.providerId,
        options: {
          baseURL: input.baseUrl,
          apiKey: `{env:${input.envVar}}`, // NON-SECRET reference; resolved from child env.
        },
        models,
      },
    },
  };
}

/**
 * Write the non-secret opencode.json into a workspace dir and return its path. Throws if the
 * serialized bytes would somehow contain a raw key value (defense in depth: they never should,
 * since only the `{env:...}` reference is written).
 */
export function writeOpencodeConfig(
  workspaceDir: string,
  input: CustomProviderConfigInput,
  forbiddenSecret?: string,
): string {
  const serialized = JSON.stringify(buildOpencodeConfig(input), null, 2);
  if (forbiddenSecret && forbiddenSecret.length > 0 && serialized.includes(forbiddenSecret)) {
    throw new Error("Refusing to write opencode.json: it unexpectedly contains the key value.");
  }
  const path = join(workspaceDir, "opencode.json");
  writeFileSync(path, serialized, "utf8");
  return path;
}
