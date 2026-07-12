/**
 * Packaged-verifier-only loopback mock LLM allowlist (not a production feature).
 *
 * When `COWORK_GHC_E2E_MOCK_LLM_BASE_URL` is set to an explicit `http://127.0.0.1:PORT/...` URL,
 * the service may configure OpenCode and outbound probes against EXACTLY that URL. No other
 * loopback/private host is relaxed.
 */

const ENV_KEY = "COWORK_GHC_E2E_MOCK_LLM_BASE_URL";

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/u, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

/** Read the verifier mock LLM base URL when set and loopback-only. */
export function readE2eMockLlmBaseUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const raw = env[ENV_KEY]?.trim();
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:") return undefined;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host !== "127.0.0.1") return undefined;
  return normalizeBaseUrl(url.href);
}

/** True when `candidateUrl` is exactly the configured verifier mock base URL. */
export function isE2eMockLlmUrl(
  candidateUrl: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const allowed = readE2eMockLlmBaseUrl(env);
  if (allowed === undefined) return false;
  try {
    return normalizeBaseUrl(candidateUrl) === allowed;
  } catch {
    return false;
  }
}

/** Assert loopback hostname before deterministic packaged mode starts. */
export function assertLoopbackMockBaseUrl(baseUrl: string): void {
  const url = new URL(baseUrl);
  if (url.hostname !== "127.0.0.1") {
    throw new Error(`Deterministic verifier requires loopback mock base URL; got ${url.hostname}`);
  }
}

export { ENV_KEY as E2E_MOCK_LLM_ENV_KEY };
