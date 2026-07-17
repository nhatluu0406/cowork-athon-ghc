/**
 * Bounded, redacted output buffer for the preview runner.
 *
 * Every captured stdout/stderr line is (1) value-scrubbed against registered secrets, then
 * (2) pattern-scrubbed for common secret shapes (Authorization headers, api_key/token/password
 * assignments, URL userinfo + secret query params), then (3) length-capped, and stored in a
 * fixed-size ring so runaway output can never exhaust memory. `seq` is monotonic across the
 * whole run so the renderer can request only lines newer than what it has seen.
 */

import type { RuntimePreviewOutputLine } from "@cowork-ghc/contracts";
import type { SecretScrubber } from "../diagnostics/secret-scrubber.js";

/** Max characters kept per line (longer lines are truncated with an ellipsis marker). */
export const MAX_LINE_CHARS = 2_000;
/** Max lines retained; older lines are dropped (ring). */
export const MAX_LINES = 2_000;

const PLACEHOLDER = "[REDACTED]";

/** Heuristic secret patterns applied on top of the value-based scrubber. */
const PATTERNS: readonly { readonly re: RegExp; readonly replace: string }[] = [
  // Authorization: Bearer <token>  /  authorization=<token>
  { re: /(\bauthorization\b\s*[:=]\s*)(?:bearer\s+)?[^\s'"]+/gi, replace: `$1${PLACEHOLDER}` },
  // api_key / apikey / access_token / secret / token / password / pwd  =  <value>
  {
    re: /(\b(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret|secret|token|password|passwd|pwd)\b\s*[:=]\s*)(['"]?)[^\s'"]+/gi,
    replace: `$1${PLACEHOLDER}`,
  },
  // URL userinfo (any scheme): scheme://user:pass@host → scheme://[REDACTED]@host
  { re: /(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi, replace: `$1${PLACEHOLDER}@` },
  // secret-bearing query params: ?token=...  &api_key=...
  {
    re: /([?&](?:api[_-]?key|access[_-]?token|token|key|secret|password)=)[^&\s'"]+/gi,
    replace: `$1${PLACEHOLDER}`,
  },
];

/** Apply the value scrubber then the heuristic patterns to a single line. */
export function redactLine(scrubber: SecretScrubber, text: string): string {
  let out = scrubber.scrub(text);
  for (const { re, replace } of PATTERNS) out = out.replace(re, replace);
  return out;
}

export interface OutputBuffer {
  /** Append a raw (unredacted) chunk on a stream; splits into lines, redacts, and stores. */
  append(stream: "stdout" | "stderr" | "system", chunk: string, at: string): void;
  /** All retained lines with `seq > afterSeq`. */
  since(afterSeq: number): readonly RuntimePreviewOutputLine[];
  /** Total lines ever produced (monotonic; includes dropped ones). */
  totalSeq(): number;
  /** True if the ring has dropped older lines. */
  hasDropped(): boolean;
  /** Drop everything (new run). */
  clear(): void;
}

export function createOutputBuffer(scrubber: SecretScrubber): OutputBuffer {
  let lines: RuntimePreviewOutputLine[] = [];
  let seq = 0;
  let dropped = false;
  /** Carry an unterminated partial line per stream until its newline arrives. */
  const partial: Record<string, string> = { stdout: "", stderr: "", system: "" };

  function push(stream: "stdout" | "stderr" | "system", rawLine: string, at: string): void {
    seq += 1;
    let text = redactLine(scrubber, rawLine);
    if (text.length > MAX_LINE_CHARS) text = `${text.slice(0, MAX_LINE_CHARS)}…`;
    lines.push({ seq, stream, text, at });
    if (lines.length > MAX_LINES) {
      lines = lines.slice(lines.length - MAX_LINES);
      dropped = true;
    }
  }

  return {
    append(stream, chunk, at) {
      const combined = partial[stream] + chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const parts = combined.split("\n");
      partial[stream] = parts.pop() ?? "";
      for (const line of parts) push(stream, line, at);
      // Guard a single enormous partial line with no newline (bounded memory).
      if (partial[stream].length > MAX_LINE_CHARS * 4) {
        push(stream, partial[stream], at);
        partial[stream] = "";
      }
    },
    since(afterSeq) {
      return lines.filter((l) => l.seq > afterSeq);
    },
    totalSeq() {
      return seq;
    },
    hasDropped() {
      return dropped;
    },
    clear() {
      lines = [];
      seq = 0;
      dropped = false;
      partial["stdout"] = "";
      partial["stderr"] = "";
      partial["system"] = "";
    },
  };
}
