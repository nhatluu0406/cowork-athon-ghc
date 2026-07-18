/**
 * Parse compiler / dev-server diagnostics out of the Code runtime panes' captured output so the
 * "Vấn đề" (Problems) tab shows REAL, honest problems instead of a placeholder. This is a pure,
 * side-effect-free reducer over the already-REDACTED, size-bounded output lines the service streams
 * (see runtime-preview/output-buffer) — it never touches a process, the filesystem, or a secret.
 *
 * It is deliberately CONSERVATIVE: a line becomes a problem only on a confident, explicit match (a
 * `tsc` code, an `esbuild`/Vite `[ERROR]` frame, an ESLint-style `line:col error` row, or a clear
 * `Error:` prefix). Ordinary dev-server chatter ("ready in 300 ms") never produces a false problem —
 * honesty over coverage. Results are de-duplicated and capped so a runaway error loop can't flood
 * the panel.
 */

import type { RuntimePreviewOutputLine } from "@cowork-ghc/contracts";

/** One diagnostic surfaced in the "Vấn đề" tab. `file`/`line`/`column` are present when parsed. */
export interface CodeProblem {
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
}

/** Hard cap so a pathological error loop cannot grow the panel without bound. */
const MAX_PROBLEMS = 200;

// eslint-disable-next-line no-control-regex -- stripping terminal ANSI colour codes from dev servers.
const ANSI = /\[[0-9;]*m/g;

/** `tsc`: `src/a.ts(12,5): error TS2345: msg` OR `src/a.ts:12:5 - error TS2345: msg`. */
const TS_DIAGNOSTIC =
  /^(.+?)(?:\((\d+),(\d+)\)|:(\d+):(\d+))\s*[:\-]?\s*(error|warning)\s+TS\d+:\s*(.+)$/i;

/** Generic `file:line:col: error: msg` (gcc/clang/esbuild-location/ESLint-compact style). */
const FILE_LINE_COL =
  /^\s*(.+?):(\d+):(\d+):\s*(error|warning):?\s+(.+)$/i;

/** ESLint per-file row: `  12:5   error  Message text  rule/name`. */
const ESLINT_ROW = /^\s*(\d+):(\d+)\s+(error|warning)\s{2,}(.+?)(?:\s{2,}[\w./-]+)?$/i;

/** esbuild / Vite banner: `✘ [ERROR] msg` / `X [ERROR] msg` / `[vite] Internal server error`. */
const BUNDLER_BANNER = /^(?:[✘✖x×]\s*)?\[(error|warning)\]\s*(.+)$/i;

/** A bare `Error:` / `SyntaxError:` prefix (Node crash, uncaught throw). */
const BARE_ERROR = /^\s*((?:[A-Z][a-zA-Z]*)?Error):\s*(.+)$/;

function toSeverity(token: string | undefined): "error" | "warning" {
  return (token ?? "").toLowerCase() === "warning" ? "warning" : "error";
}

/** A parsed file field only when it is a non-empty string. */
function fileField(value: string | undefined): { file: string } | Record<string, never> {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? { file: trimmed } : {};
}

function parseInt10(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

/** Parse a single already-ANSI-stripped line into a problem, or null when it is not a diagnostic. */
function parseLine(text: string): CodeProblem | null {
  const tsMatch = TS_DIAGNOSTIC.exec(text);
  if (tsMatch !== null) {
    const line = parseInt10(tsMatch[2] ?? tsMatch[4]);
    const column = parseInt10(tsMatch[3] ?? tsMatch[5]);
    return {
      severity: toSeverity(tsMatch[6]),
      message: (tsMatch[7] ?? "").trim(),
      ...fileField(tsMatch[1]),
      ...(line !== undefined ? { line } : {}),
      ...(column !== undefined ? { column } : {}),
    };
  }
  const flc = FILE_LINE_COL.exec(text);
  if (flc !== null) {
    const line = parseInt10(flc[2]);
    const column = parseInt10(flc[3]);
    return {
      severity: toSeverity(flc[4]),
      message: (flc[5] ?? "").trim(),
      ...fileField(flc[1]),
      ...(line !== undefined ? { line } : {}),
      ...(column !== undefined ? { column } : {}),
    };
  }
  const eslint = ESLINT_ROW.exec(text);
  if (eslint !== null) {
    const line = parseInt10(eslint[1]);
    const column = parseInt10(eslint[2]);
    return {
      severity: toSeverity(eslint[3]),
      message: (eslint[4] ?? "").trim(),
      ...(line !== undefined ? { line } : {}),
      ...(column !== undefined ? { column } : {}),
    };
  }
  const banner = BUNDLER_BANNER.exec(text);
  if (banner !== null) {
    return { severity: toSeverity(banner[1]), message: (banner[2] ?? "").trim() };
  }
  const bare = BARE_ERROR.exec(text);
  if (bare !== null) {
    return { severity: "error", message: `${bare[1] ?? "Error"}: ${(bare[2] ?? "").trim()}` };
  }
  return null;
}

function problemKey(p: CodeProblem): string {
  return `${p.severity}|${p.file ?? ""}|${p.line ?? ""}|${p.column ?? ""}|${p.message}`;
}

/**
 * Reduce captured output lines to a de-duplicated, capped list of problems, most-recent LAST (the
 * natural read order of a build log). `system` lines (our own status notes) are ignored.
 */
export function parseProblems(lines: readonly RuntimePreviewOutputLine[]): readonly CodeProblem[] {
  const out: CodeProblem[] = [];
  const seen = new Set<string>();
  for (const raw of lines) {
    if (raw.stream === "system") continue;
    const text = raw.text.replace(ANSI, "").replace(/\r$/, "");
    if (text.trim().length === 0) continue;
    const problem = parseLine(text);
    if (problem === null) continue;
    const key = problemKey(problem);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(problem);
    if (out.length >= MAX_PROBLEMS) break;
  }
  return out;
}

/** Short human label for a problem row, e.g. `src/a.ts:12:5`. Empty when no location was parsed. */
export function problemLocation(p: CodeProblem): string {
  if (p.file === undefined && p.line === undefined) return "";
  const loc = [p.line, p.column].filter((n) => n !== undefined).join(":");
  return [p.file, loc].filter((s) => s !== undefined && s !== "").join(":");
}
