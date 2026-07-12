/**
 * The execution-metadata record (ADR 0006 SEC-2 / AC4): a snapshot of how the OpenCode
 * child was launched — command, args, cwd, and the child env. This is one of the two
 * mandated scrubber coverage targets (the diagnostics bundle is the other): a provider
 * key injected into the child env could otherwise surface here verbatim.
 *
 * `scrubExecutionMetadata` runs EVERY string field through the value-based scrubber, so a
 * secret is redacted whether it appears as a whole env value, inside `command`/`args`, or
 * embedded in `cwd`. Env entries are additionally flagged `redacted: true` when their
 * value carried a secret, so the record stays honest about what was removed.
 */

import type { SecretScrubber } from "./secret-scrubber.js";

/** A single child-process environment entry as captured for diagnostics. */
export interface ExecutionEnvEntry {
  readonly name: string;
  readonly value: string;
  /** True when this entry's value was replaced by the scrubber. */
  readonly redacted: boolean;
}

/** How the runtime child was (or would be) launched. Secret-free ONLY after scrubbing. */
export interface ExecutionMetadata {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: readonly ExecutionEnvEntry[];
  readonly pid?: number;
  readonly startedAt?: string;
  readonly exitCode?: number | null;
  /** Redacted tail of child stdout/stderr, if captured. */
  readonly lastStdout?: string;
  readonly lastStderr?: string;
}

function scrubEnvEntry(entry: ExecutionEnvEntry, scrubber: SecretScrubber): ExecutionEnvEntry {
  const scrubbedValue = scrubber.scrub(entry.value);
  return {
    name: scrubber.scrub(entry.name),
    value: scrubbedValue,
    redacted: entry.redacted || scrubbedValue !== entry.value,
  };
}

/**
 * Return a redacted copy of `record` with every string field scrubbed by VALUE. The
 * input is never mutated. Optional fields are only carried through when present, so the
 * result satisfies `exactOptionalPropertyTypes`.
 */
export function scrubExecutionMetadata(
  record: ExecutionMetadata,
  scrubber: SecretScrubber,
): ExecutionMetadata {
  const base = {
    command: scrubber.scrub(record.command),
    args: record.args.map((arg) => scrubber.scrub(arg)),
    cwd: scrubber.scrub(record.cwd),
    env: record.env.map((entry) => scrubEnvEntry(entry, scrubber)),
  };
  return {
    ...base,
    ...(record.pid !== undefined ? { pid: record.pid } : {}),
    ...(record.startedAt !== undefined ? { startedAt: scrubber.scrub(record.startedAt) } : {}),
    ...(record.exitCode !== undefined ? { exitCode: record.exitCode } : {}),
    ...(record.lastStdout !== undefined ? { lastStdout: scrubber.scrub(record.lastStdout) } : {}),
    ...(record.lastStderr !== undefined ? { lastStderr: scrubber.scrub(record.lastStderr) } : {}),
  };
}

/** Serialize the execution-metadata record to scrubbed JSON (defense-in-depth export). */
export function exportExecutionMetadataJson(
  record: ExecutionMetadata,
  scrubber: SecretScrubber,
  space = 2,
): string {
  return scrubber.scrubJson(scrubExecutionMetadata(record, scrubber), space);
}
