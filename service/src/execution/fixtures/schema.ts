/**
 * Captured-frame fixture format for CGHC-024 (PR10 captured-frame test harness).
 *
 * A fixture is an NDJSON file of RAW OpenCode `/event` frames recorded from a REAL live
 * OpenCode run (`opencode serve` behind the pinned binary). The first line is a
 * {@link CapturedMeta} header (scenario name + the OpenCode pin the frames were captured
 * against); every subsequent line is a {@link CapturedFrame} wrapping one untrusted raw
 * `{ type, properties }` envelope EXACTLY as it came off the socket.
 *
 * HONESTY: this file defines the FORMAT + validation only. It ships NO fabricated frames.
 * Real fixtures are produced by the opt-in capture tool AFTER the product-owner token gate
 * (see `tools/capture-frames/`), then replayed through the SAME `createEvMapper` + reducer
 * the live path uses — so a green replay proves the real runtime contract, not a fiction.
 */

import { isRawOpencodeEvent, type RawOpencodeEvent } from "../opencode-events.js";

/** Discriminant for the header (first NDJSON line). */
export const CAPTURE_META_KIND = "capture-meta" as const;
/** Discriminant for a recorded frame line. */
export const CAPTURE_FRAME_KIND = "frame" as const;

/** The header record: what scenario this is and which pin it was captured against. */
export interface CapturedMeta {
  readonly kind: typeof CAPTURE_META_KIND;
  /** Scenario name; MUST match a `REQUIRED_CAPTURE_SCENARIOS` entry. */
  readonly scenario: string;
  /** The `OPENCODE_PIN` value the frames were captured against (ties fixtures to the pin). */
  readonly opencodePin: string;
  /** ISO-8601 capture timestamp. */
  readonly capturedAt: string;
  /** The real session id the frames belong to (the mapper binds to it on replay). */
  readonly sessionId: string;
  /** The prompt that drove the run (kept for reproducibility; MUST be secret-free). */
  readonly prompt: string;
  /** Version the live runtime `/global/health` reported (optional provenance). */
  readonly runtimeVersionReported?: string;
  /** Provider id the run used (provider-neutral provenance; optional). */
  readonly providerId?: string;
}

/** One recorded raw OpenCode SSE frame, wrapped for provenance. */
export interface CapturedFrame {
  readonly kind: typeof CAPTURE_FRAME_KIND;
  /** The untrusted raw `{ type, properties }` envelope, verbatim off the wire. */
  readonly raw: RawOpencodeEvent;
  /** ISO-8601 time the frame was recorded (optional). */
  readonly recordedAt?: string;
}

/** A fully-parsed, validated fixture file. */
export interface CapturedFrameFile {
  readonly meta: CapturedMeta;
  readonly frames: readonly CapturedFrame[];
}

/** Raised when a fixture file is present but does not satisfy the schema. */
export class CapturedFrameSchemaError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(`Captured-frame fixture is malformed at line ${line}: ${message}`);
    this.name = "CapturedFrameSchemaError";
    this.line = line;
  }
}

function asRec(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function requireString(rec: Record<string, unknown>, key: string, line: number): string {
  const value = rec[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new CapturedFrameSchemaError(`missing/invalid string field "${key}"`, line);
  }
  return value;
}

function parseMeta(rec: Record<string, unknown>, line: number): CapturedMeta {
  if (rec["kind"] !== CAPTURE_META_KIND) {
    throw new CapturedFrameSchemaError(`first line must be a "${CAPTURE_META_KIND}" header`, line);
  }
  const runtimeVersionReported = rec["runtimeVersionReported"];
  const providerId = rec["providerId"];
  return {
    kind: CAPTURE_META_KIND,
    scenario: requireString(rec, "scenario", line),
    opencodePin: requireString(rec, "opencodePin", line),
    capturedAt: requireString(rec, "capturedAt", line),
    sessionId: requireString(rec, "sessionId", line),
    prompt: requireString(rec, "prompt", line),
    ...(typeof runtimeVersionReported === "string" ? { runtimeVersionReported } : {}),
    ...(typeof providerId === "string" ? { providerId } : {}),
  };
}

function parseFrame(rec: Record<string, unknown>, line: number): CapturedFrame {
  if (rec["kind"] !== CAPTURE_FRAME_KIND) {
    throw new CapturedFrameSchemaError(`expected a "${CAPTURE_FRAME_KIND}" record`, line);
  }
  if (!isRawOpencodeEvent(rec["raw"])) {
    throw new CapturedFrameSchemaError("frame.raw is not a { type, properties } envelope", line);
  }
  const recordedAt = rec["recordedAt"];
  return {
    kind: CAPTURE_FRAME_KIND,
    raw: rec["raw"],
    ...(typeof recordedAt === "string" ? { recordedAt } : {}),
  };
}

/**
 * Parse + validate NDJSON fixture text into a {@link CapturedFrameFile}. Throws
 * {@link CapturedFrameSchemaError} on any malformed line — a corrupt fixture is a hard,
 * honest failure, never a silently-accepted fiction.
 */
export function parseCapturedFrameFile(ndjson: string): CapturedFrameFile {
  const lines = ndjson.split(/\r?\n/).map((l) => l.trim());
  const rows: { rec: Record<string, unknown>; line: number }[] = [];
  lines.forEach((text, index) => {
    if (text.length === 0) return;
    const lineNo = index + 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new CapturedFrameSchemaError("line is not valid JSON", lineNo);
    }
    rows.push({ rec: asRec(parsed), line: lineNo });
  });
  const head = rows[0];
  if (head === undefined) {
    throw new CapturedFrameSchemaError("fixture is empty (needs a header + frames)", 1);
  }
  const meta = parseMeta(head.rec, head.line);
  const frames = rows.slice(1).map((row) => parseFrame(row.rec, row.line));
  return { meta, frames };
}

/** Serialize a {@link CapturedFrameFile} back to NDJSON (used by the capture tool). */
export function serializeCapturedFrameFile(file: CapturedFrameFile): string {
  const lines = [JSON.stringify(file.meta), ...file.frames.map((f) => JSON.stringify(f))];
  return lines.join("\n") + "\n";
}
