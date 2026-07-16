/**
 * Developer-only loopback-`http` override (CGHC-010 follow-up).
 *
 * This is DELIBERATELY separate from {@link import("./test-mode.js").resolveLoopbackEscape} /
 * {@link import("./test-mode.js").productionLoopbackEscape}. Those are gated by the BUILD-TIME
 * `BUILD_PROFILE` constant and HARD-ASSERT (`ReleaseGuardrailError`) when the escape flag is on
 * in a release build. `BUILD_PROFILE` is the source literal `"release"` and nothing in this
 * repo's build ever overrides it, so it is `"release"` at runtime even for a developer AND for
 * the packaged app. Routing a developer convenience flag through that path would make the app
 * REFUSE TO START the moment it is enabled — that breaks local development and the packaged
 * demo. This module never touches `BUILD_PROFILE` and never throws.
 *
 * When `COWORK_GHC_DEV_ALLOW_LOOPBACK_HTTP` is set, the composition root may pass
 * `loopbackEscape: true` into {@link import("./ssrf-policy.js").createSsrfPolicy}. The policy
 * itself (unchanged by this module) still requires EVERY resolved address to be loopback for
 * `http` to be permitted — private, link-local, cloud-metadata, and public-http targets stay
 * blocked regardless of this flag. This module only decides WHETHER that existing knob is
 * turned on; it cannot widen what the knob does.
 *
 * Pure, env-only, no I/O. The composition root is the ONLY caller — the provider router
 * (`router.ts`) intentionally never reads this field from a request body, so a renderer /
 * model-generated request can never enable it.
 */

const ENV_KEY = "COWORK_GHC_DEV_ALLOW_LOOPBACK_HTTP";

/** True when the developer loopback-http override is enabled via env. Unset/empty/`0`/`false` ⇒ false. */
export function readDevLoopbackHttpEscape(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[ENV_KEY] === "1" || env[ENV_KEY] === "true";
}

/** Non-secret WARN banner logged once when the override is active (never logs the target URL/secret). */
export const DEV_LOOPBACK_HTTP_WARNING =
  "[SSRF] DEV loopback-http override ACTIVE — plain http permitted to loopback ONLY " +
  "(127.0.0.1/::1); never use in production.";

export { ENV_KEY as DEV_LOOPBACK_HTTP_ENV_KEY };
