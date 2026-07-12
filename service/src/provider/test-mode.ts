/**
 * SSRF test-mode loopback-escape guardrail (CGHC-010, ADR 0005 §"TEST-MODE loopback
 * allowlist escape"). The ONLY sanctioned way to relax the outbound SSRF policy, and it
 * relaxes EXACTLY one thing: explicit loopback (so a local mock endpoint can drive
 * deterministic, no-live-LLM tests). Link-local, cloud-metadata and RFC-1918 stay blocked
 * even here.
 *
 * Release safety (all four are enforced below):
 *  1. Gated by a BUILD-TIME constant ({@link BUILD_PROFILE}) AND an explicit launch flag.
 *  2. In a release build the constant is the literal `"release"`, so a bundler folds
 *     `BUILD_PROFILE !== "release"` to `false` and DEAD-CODE-ELIMINATES the escape branch.
 *  3. {@link resolveLoopbackEscape} HARD-ASSERTS: if a release build is somehow launched
 *     with the flag ON it THROWS {@link ReleaseGuardrailError} (refuse to start).
 *  4. It is a launch-config input only — never sourced from a boundary request body, so it
 *     is unreachable from the renderer / model-generated content.
 * When active it emits a WARN banner and a local audit event.
 */

/** Build profile. `release` is the production default; the constant below is `release`. */
export type BuildProfile = "release" | "development" | "test";

/**
 * BUILD-TIME constant. Production ships the literal `"release"`; a build tool (esbuild
 * `define` / tsc const-fold) can DCE every `BUILD_PROFILE !== "release"` branch. It is a
 * `const` literal type on purpose so it is never runtime-mutable.
 */
export const BUILD_PROFILE: BuildProfile = "release";

/** Local audit event emitted whenever the loopback escape is active. */
export interface SsrfTestModeAudit {
  readonly type: "ssrf_loopback_escape_active";
  readonly buildProfile: BuildProfile;
}

/** Refuse-to-start error: the escape flag is set in a release build. */
export class ReleaseGuardrailError extends Error {
  constructor() {
    super(
      "SSRF loopback test-mode flag is set in a RELEASE build — refusing to start. " +
        "This escape is dev/test only and must be dead-code-eliminated in release.",
    );
    this.name = "ReleaseGuardrailError";
  }
}

export interface LoopbackEscapeInput {
  /** The build profile (pass {@link BUILD_PROFILE}; tests may simulate `release`). */
  readonly buildProfile: BuildProfile;
  /** The explicit launch flag. NEVER sourced from a renderer/boundary request. */
  readonly launchFlag: boolean;
  /** WARN sink (log banner). */
  readonly warn?: (message: string) => void;
  /** Local audit sink. */
  readonly audit?: (event: SsrfTestModeAudit) => void;
}

/**
 * Decide whether the loopback escape is active. Enforces the release hard-assert and
 * emits WARN + audit when active. Returns `true` ONLY for a non-release build WITH the
 * launch flag on. This boolean is the single knob the SSRF policy accepts.
 */
export function resolveLoopbackEscape(input: LoopbackEscapeInput): boolean {
  // HARD ASSERT: a release build must NEVER carry the flag. Refuse to start.
  if (input.buildProfile === "release" && input.launchFlag) {
    throw new ReleaseGuardrailError();
  }
  const active = input.buildProfile !== "release" && input.launchFlag === true;
  if (active) {
    input.warn?.(
      "[SSRF] loopback test-mode escape ACTIVE — only explicit loopback is relaxed; " +
        "link-local, cloud-metadata and RFC-1918 stay blocked. Never use in production.",
    );
    input.audit?.({ type: "ssrf_loopback_escape_active", buildProfile: input.buildProfile });
  }
  return active;
}

/**
 * Production entry point: resolves the escape using the BUILD-TIME {@link BUILD_PROFILE}.
 * In a release build this folds to `false` (and throws if the flag is forced on), so the
 * production SSRF policy can never be relaxed. The composition root sources `launchFlag`
 * from launch config only.
 */
export function productionLoopbackEscape(
  launchFlag: boolean,
  hooks?: Pick<LoopbackEscapeInput, "warn" | "audit">,
): boolean {
  return resolveLoopbackEscape({ buildProfile: BUILD_PROFILE, launchFlag, ...hooks });
}
