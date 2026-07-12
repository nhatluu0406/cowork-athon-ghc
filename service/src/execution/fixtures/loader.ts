/**
 * Loader for captured-frame fixtures (CGHC-024). Resolves `<scenario>.ndjson` under the
 * `data/` directory next to this module, and parses it through the schema validator.
 *
 * The loader deliberately does NOT invent frames when a fixture is absent: it reports an
 * honest ABSENT status so the pin-gate (see `gate.ts`) can skip a test WITH A REASON rather
 * than green-wash a missing capture.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  parseCapturedFrameFile,
  type CapturedFrameFile,
} from "./schema.js";

/** Absolute path of the directory holding captured `.ndjson` fixtures. */
export function fixturesDataDir(): string {
  return fileURLToPath(new URL("./data/", import.meta.url));
}

/** Absolute path of a scenario's fixture file (`<name>.ndjson`). */
export function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./data/${name}.ndjson`, import.meta.url));
}

/** True when a scenario's captured fixture file exists on disk. */
export function capturedFrameFileExists(name: string): boolean {
  return existsSync(fixturePath(name));
}

/** Outcome of attempting to read a captured fixture without asserting the pin. */
export type CapturedFrameLoad =
  | { readonly present: true; readonly file: CapturedFrameFile }
  | { readonly present: false; readonly path: string };

/**
 * Read + validate a captured fixture. When the file is absent, returns an ABSENT result
 * (never throws for "not captured yet"); a PRESENT-but-malformed file throws
 * {@link import("./schema.js").CapturedFrameSchemaError} (a corrupt fixture is a real failure).
 */
export function readCapturedFrames(name: string): CapturedFrameLoad {
  const path = fixturePath(name);
  if (!existsSync(path)) return { present: false, path };
  const ndjson = readFileSync(path, "utf8");
  return { present: true, file: parseCapturedFrameFile(ndjson) };
}

/**
 * Load a captured fixture, throwing when it is absent. Prefer {@link readCapturedFrames}
 * (or the pin-gate) in tests so a not-yet-captured scenario skips honestly.
 */
export function loadCapturedFrames(name: string): CapturedFrameFile {
  const load = readCapturedFrames(name);
  if (!load.present) {
    throw new Error(
      `No captured fixture for scenario "${name}" at ${load.path}. ` +
        `Capture it with the opt-in capture tool (tools/capture-frames) after the token gate.`,
    );
  }
  return load.file;
}
