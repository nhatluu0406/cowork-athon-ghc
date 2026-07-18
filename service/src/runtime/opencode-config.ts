/**
 * Production OpenCode project-config writer for the supervisor.
 *
 * The generated config is intentionally non-secret. Credentials are injected into the child
 * environment and referenced here only through `{env:NAME}`. The permission policy is duplicated
 * at the project and primary-agent levels because OpenCode agent-specific configuration can
 * override project defaults. Cowork GHC must never depend on implicit defaults for file writes.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { OPENAI_COMPATIBLE_NPM, isValidEnvName } from "@cowork-ghc/runtime";
import { isE2eMockLlmUrl } from "../provider/e2e-mock-llm.js";
import { TOOL_NAMES as MS365_TOOL_NAMES } from "../ms365/ms365-tool-router.js";
import { DOCX_TOOL_NAME } from "../documents/docx-tool-router.js";
import { isGatewayProxyUrl } from "../gateway/gateway-proxy-url.js";

/** Non-secret provider definition for the child's `opencode.json`. */
export interface OpencodeProviderConfig {
  readonly providerId: string;
  readonly displayName?: string;
  readonly envVar: string;
  readonly models: readonly string[];
  readonly baseUrl?: string;
  readonly permission?: Readonly<Record<string, string>>;
}

/**
 * Optional native-Skills launch inputs (OpenCode `skills.paths` + per-skill
 * `permission.skill` map). Both are non-secret: absolute filesystem roots and product
 * Skill ids only — never file content or a credential.
 *
 * OpenCode 1.18.1 requires `skills: { paths: [...] }`. A bare string array is rejected by
 * the child (POST /session → HTTP 400) even when `/global/health` stays healthy.
 */
export interface OpencodeSkillsConfig {
  /** Absolute Skill-root directories OpenCode scans for `SKILL.md` files. */
  readonly skillsPaths?: readonly string[];
  /**
   * Enabled Skill ids (from `service/src/skills/catalog.ts`, the ONE product Skill
   * source). When provided (even as an empty array), replaces the blanket
   * `"skill": "allow"` policy with an explicit per-id allowlist (`"*": "deny"` + one
   * `"allow"` entry per id) so OpenCode can only invoke a Skill Cowork GHC has enabled.
   * An empty array denies every skill (honest: nothing is enabled yet).
   */
  readonly skillAllow?: readonly string[];
}

/**
 * Live-session policy. `edit` is explicit because OpenCode gates write/edit/apply_patch through
 * that single permission key. `doom_loop` is allowed so a headless `serve` process cannot stall on
 * an internal recovery prompt that Cowork does not present as a product permission.
 * `question` is denied: OpenCode's interactive question tool blocks the turn until a structured
 * reply arrives on a channel Cowork does not own yet (no product Question UI). Leaving it
 * `allow` stalls `POST /session/.../message` → HTTP client timeout → product 503 on later turns.
 * Clarifications stay in normal chat until a Question surface ships (see known-limitations.md).
 */
export const LIVE_SESSION_PERMISSION_POLICY: Readonly<Record<string, string>> = Object.freeze({
  "*": "ask",
  read: "allow",
  list: "allow",
  glob: "allow",
  grep: "allow",
  skill: "allow",
  question: "deny",
  todowrite: "allow",
  edit: "ask",
  bash: "deny",
  task: "deny",
  external_directory: "deny",
  doom_loop: "allow",
  webfetch: "deny",
  websearch: "deny",
});

function assertSafeBaseUrl(baseUrl: string): void {
  if (isE2eMockLlmUrl(baseUrl)) return;
  if (isGatewayProxyUrl(baseUrl)) return;
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

function buildProvider(config: OpencodeProviderConfig): Record<string, unknown> {
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
  return { [config.providerId]: provider };
}

/**
 * Build the `permission.skill` value: the blanket string unless {@link
 * OpencodeSkillsConfig.skillAllow} is provided, in which case it becomes an explicit
 * per-id allowlist object (deny-by-default) so OpenCode can only run an enabled Skill.
 */
function buildSkillPermission(skillAllow: readonly string[] | undefined): string | Record<string, string> {
  if (skillAllow === undefined) return "allow";
  const allow: Record<string, string> = { "*": "deny" };
  for (const id of skillAllow) {
    const trimmed = id.trim();
    if (trimmed.length === 0) continue;
    allow[trimmed] = "allow";
  }
  return allow;
}

/** Build the non-secret project config. A provider block is optional for built-in providers. */
export function buildOpencodeConfig(
  config?: OpencodeProviderConfig,
  skills?: OpencodeSkillsConfig,
): Record<string, unknown> {
  const permission: Record<string, unknown> = {
    ...LIVE_SESSION_PERMISSION_POLICY,
    ...(config?.permission ?? {}),
  };
  if (skills?.skillAllow !== undefined) {
    permission["skill"] = buildSkillPermission(skills.skillAllow);
  }
  // MS365 tools are OpenCode plugin tools whose REAL gate is the MS365 bridge (every call routes
  // through /v1/ms365/tool-call and requires a permission card). Mark them "allow" here so
  // OpenCode's "*":"ask" wildcard does not double-prompt on top of the bridge gate. MS365 mounts
  // unconditionally on main (the CGHC_MS365_ENABLED gate was removed), so this is unconditional.
  for (const name of MS365_TOOL_NAMES) {
    permission[name] = "allow";
  }
  // The create_docx tool is an OpenCode plugin tool whose REAL gate is the docx bridge (every call
  // routes through /v1/documents/create-docx and requires a file_create permission card). Mark it
  // "allow" here so OpenCode's "*":"ask" wildcard does not double-prompt on top of the bridge gate.
  permission[DOCX_TOOL_NAME] = "allow";

  return {
    $schema: "https://opencode.ai/config.json",
    permission,
    // OpenCode permits agent-specific overrides. Repeat the policy for the primary build agent so
    // a legacy/default agent config cannot silently auto-approve a write.
    agent: {
      build: {
        permission,
      },
    },
    // OpenCode 1.18 `skills.paths`: absolute roots only, and only when non-empty (an
    // empty/absent list leaves the key out entirely so OpenCode's own defaults do not apply).
    ...(skills?.skillsPaths !== undefined && skills.skillsPaths.length > 0
      ? { skills: { paths: [...skills.skillsPaths] } }
      : {}),
    ...(config !== undefined ? { provider: buildProvider(config) } : {}),
  };
}

/** Write `opencode.json`; the resolved key value is forbidden from the serialized bytes. */
export function writeOpencodeConfig(
  configDir: string,
  config?: OpencodeProviderConfig,
  forbiddenSecret?: string,
  skills?: OpencodeSkillsConfig,
): string {
  const serialized = JSON.stringify(buildOpencodeConfig(config, skills), null, 2);
  if (forbiddenSecret && forbiddenSecret.length > 0 && serialized.includes(forbiddenSecret)) {
    throw new Error("Refusing to write opencode.json: it unexpectedly contains the key value.");
  }
  const path = join(configDir, "opencode.json");
  writeFileSync(path, serialized, "utf8");
  return path;
}
