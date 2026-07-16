/**
 * File-evidence verification hook (agent-harness-plan.md
 * `dispatch-verify-hook-retry-until-verified`).
 *
 * `retry_until_verified` only reports `completed` when a {@link VerificationHook} confirms REAL
 * evidence — never a fabricated success. This hook IS that evidence check: it reads the attempt's
 * declared {@link AttemptResult.evidencePaths} (workspace-relative paths the attempt claims to have
 * produced/mutated) and confirms EACH ONE actually exists on disk via the same snapshot-capture
 * primitive the File Work Review panel uses (`captureWorkspaceFileSnapshot`) — it never trusts an
 * attempt's own claim of success, only what is really on disk.
 *
 * Honesty invariants (never verified without real evidence):
 *  - A non-`completed` attempt is never verified.
 *  - No declared paths → cannot verify → `verified: false` (never inferred from `status` alone).
 *  - No active workspace to check against → `verified: false`.
 *  - Any declared path missing on disk (or the check throws) → `verified: false` — partial
 *    evidence is not evidence.
 */

import { captureWorkspaceFileSnapshot } from "../file-review/snapshot.js";
import type { AttemptResult, VerificationHook } from "./loop-runner.js";

/** Narrow disk-check seam (default: the real file-review snapshot capture). Injectable for tests. */
export type EvidenceCapture = (
  workspaceRoot: string,
  relativePath: string,
) => Promise<{ readonly exists: boolean }>;

export interface FileEvidenceVerificationOptions {
  /** The active workspace root, or `undefined` when none is configured. */
  readonly workspaceRoot: () => string | undefined;
  /** Injectable disk-check seam (tests avoid touching real disk). Default: real fs snapshot. */
  readonly capture?: EvidenceCapture;
}

/** Build a {@link VerificationHook} that only reports `verified: true` with real disk evidence. */
export function createFileEvidenceVerificationHook(
  options: FileEvidenceVerificationOptions,
): VerificationHook {
  const capture: EvidenceCapture = options.capture ?? captureWorkspaceFileSnapshot;

  return async (_attempt: number, result: AttemptResult) => {
    if (result.status !== "completed") return { verified: false };

    const paths = result.evidencePaths ?? [];
    if (paths.length === 0) return { verified: false };

    const root = options.workspaceRoot();
    if (root === undefined) return { verified: false };

    for (const relativePath of paths) {
      let snapshot: { readonly exists: boolean };
      try {
        snapshot = await capture(root, relativePath);
      } catch {
        // A disk check that throws is NOT evidence — honest false, never a fabricated pass.
        return { verified: false };
      }
      if (!snapshot.exists) return { verified: false };
    }

    return { verified: true, evidence: `disk evidence confirmed for: ${paths.join(", ")}` };
  };
}
