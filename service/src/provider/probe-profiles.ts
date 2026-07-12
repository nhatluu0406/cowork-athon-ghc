/**
 * Per-provider probe endpoint + auth-header DATA (CGHC-011, PR3/PR10). Provider-neutral:
 * adding a provider is a new row here, never a new code branch in the connector (PR1).
 *
 * The probe is a bounded GET against a lightweight, auth-gated endpoint (a `models`/key
 * listing) — enough to distinguish a good credential (2xx) from a rejected one (401/403)
 * without generating a completion. NOT live-tested (PR10): the concrete vendor paths are
 * plausible but unverified against a live key; no request is made in the default suite.
 *
 * Secret discipline: {@link authHeadersFor} is the only function that embeds the key, and
 * only into an Authorization-style header value — never a URL, log, or error. Google uses
 * the `x-goog-api-key` header (NOT a `?key=` query param) so the key never enters a URL.
 */

import type { ConnectTarget } from "./ssrf-policy.js";
import { CUSTOM_OPENAI_COMPAT_ID, isCustomEndpoint } from "./descriptors.js";
import type { ProviderId } from "@cowork-ghc/contracts";

/** How a built-in provider is probed: a fixed https endpoint + a keyed header builder. */
interface BuiltInProbe {
  readonly url: string;
  readonly auth: (key: string) => Record<string, string>;
}

/** Bearer-token header (OpenAI, OpenRouter, and OpenAI-compatible custom endpoints). */
const bearer = (key: string): Record<string, string> => ({ authorization: `Bearer ${key}` });

const BUILTIN_PROBES: Readonly<Record<string, BuiltInProbe>> = Object.freeze({
  anthropic: {
    url: "https://api.anthropic.com/v1/models",
    auth: (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" }),
  },
  openai: { url: "https://api.openai.com/v1/models", auth: bearer },
  openrouter: { url: "https://openrouter.ai/api/v1/auth/key", auth: bearer },
  google: {
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    auth: (key) => ({ "x-goog-api-key": key }),
  },
});

/** Derive the custom endpoint's probe URL from the validated base_url (same host → same pin). */
function customModelsUrl(target: ConnectTarget): string {
  const url = new URL(target.url.href);
  const base = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  url.pathname = `${base}/models`;
  url.search = "";
  url.hash = "";
  return url.href;
}

/** Chat-completions URL for model validation on OpenAI-compatible endpoints. */
export function chatCompletionUrl(target: ConnectTarget): string {
  const url = new URL(target.url.href);
  const base = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  url.pathname = `${base}/chat/completions`;
  url.search = "";
  url.hash = "";
  return url.href;
}

/** Minimal bounded body that exercises the configured model id (one token max). */
export function minimalChatCompletionBody(modelId: string): string {
  return JSON.stringify({
    model: modelId,
    messages: [{ role: "user", content: "ping" }],
    max_tokens: 1,
    stream: false,
  });
}

/**
 * The probe URL for a provider (NO secret). Built-ins use a fixed vendor endpoint; the
 * custom OpenAI-compatible endpoint derives it from its SSRF-validated `base_url` target.
 */
export function probeUrlFor(id: ProviderId, target: ConnectTarget | null): string {
  if (isCustomEndpoint(id)) {
    if (target === null) {
      throw new Error(`Custom endpoint ${CUSTOM_OPENAI_COMPAT_ID} requires a validated connect target.`);
    }
    return customModelsUrl(target);
  }
  const probe = BUILTIN_PROBES[id];
  if (probe === undefined) throw new Error(`No probe profile for provider id: ${JSON.stringify(id)}`);
  return probe.url;
}

/** The auth header(s) carrying the key (the ONLY place the secret is embedded). */
export function authHeadersFor(id: ProviderId, key: string): Record<string, string> {
  if (isCustomEndpoint(id)) return bearer(key);
  const probe = BUILTIN_PROBES[id];
  if (probe === undefined) throw new Error(`No probe profile for provider id: ${JSON.stringify(id)}`);
  return probe.auth(key);
}
