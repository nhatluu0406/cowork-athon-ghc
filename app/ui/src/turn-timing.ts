/**
 * Local turn-timing diagnostics (renderer only, never remote).
 *
 * TEMP_DEMO_TURN_PERF: enabled by default so a packaged demo can paste DevTools
 * console output without flipping Settings. After the PO confirms the bottleneck,
 * set {@link TURN_PERF_DEMO_ENABLED} to false (or delete this instrumentation).
 */

export type TurnTimingStage =
  | "SEND_START"
  | "PREPARE_DONE"
  | "OPTIMISTIC_UI"
  | "RUNTIME_READY"
  | "PROMPT_ACCEPTED"
  | "STREAM_BOUND"
  | "FIRST_TOKEN"
  | "FIRST_PAINT"
  | "TOOL_REQUEST"
  | "PERMISSION_SHOWN"
  | "PERMISSION_APPROVED"
  | "TOOL_FINISHED"
  | "FILE_VERIFIED"
  | "FINAL_RESPONSE"
  | "FINAL_UI";

export interface TurnTimingMark {
  readonly stage: TurnTimingStage;
  readonly atMs: number;
  readonly detail?: string;
}

export interface TurnTimingReport {
  readonly marks: readonly TurnTimingMark[];
  readonly durationsMs: Readonly<Record<string, number>>;
  readonly totalsMs: {
    readonly prepare: number | null;
    readonly optimisticUi: number | null;
    readonly runtimeEnsure: number | null;
    readonly promptAccept: number | null;
    /** Model / runtime wait until first SSE token event — usually the largest. */
    readonly timeToFirstToken: number | null;
    /** Gap from first token event → first bubble DOM write (UI coalesce / paint). */
    readonly firstTokenToPaint: number | null;
    readonly streamingAndTools: number | null;
    readonly finalUi: number | null;
    readonly total: number | null;
  };
  readonly suspected: "ui_paint" | "model_or_runtime" | "runtime_ensure" | "prepare" | "mixed" | "unknown";
}

export interface TurnTimingTracker {
  mark(stage: TurnTimingStage, detail?: string): void;
  report(): TurnTimingReport;
  reset(): void;
}

/**
 * TEMP latency demos used this flag. Confirmed from packaged logs that UI paint is not the
 * bottleneck (first_token_to_paint ≈ 2ms); keep instrumentation behind verboseLogging only.
 */
export const TURN_PERF_DEMO_ENABLED = false;

const ONCE_STAGES = new Set<TurnTimingStage>([
  "SEND_START",
  "PREPARE_DONE",
  "OPTIMISTIC_UI",
  "RUNTIME_READY",
  "PROMPT_ACCEPTED",
  "STREAM_BOUND",
  "FIRST_TOKEN",
  "FIRST_PAINT",
  "FINAL_RESPONSE",
  "FINAL_UI",
  "PERMISSION_SHOWN",
  "PERMISSION_APPROVED",
]);

function delta(
  marks: readonly TurnTimingMark[],
  from: TurnTimingStage,
  to: TurnTimingStage,
): number | null {
  const a = marks.find((m) => m.stage === from);
  const b = marks.find((m) => m.stage === to);
  if (a === undefined || b === undefined) return null;
  return b.atMs - a.atMs;
}

export function buildTurnTimingReport(marks: readonly TurnTimingMark[]): TurnTimingReport {
  const durationsMs: Record<string, number> = {};
  for (let i = 1; i < marks.length; i += 1) {
    const prev = marks[i - 1]!;
    const curr = marks[i]!;
    durationsMs[`${prev.stage}->${curr.stage}`] = curr.atMs - prev.atMs;
  }

  const totalsMs = {
    prepare: delta(marks, "SEND_START", "PREPARE_DONE"),
    optimisticUi: delta(marks, "PREPARE_DONE", "OPTIMISTIC_UI"),
    runtimeEnsure: delta(marks, "OPTIMISTIC_UI", "RUNTIME_READY"),
    promptAccept: delta(marks, "RUNTIME_READY", "PROMPT_ACCEPTED"),
    /** Prefer session-ready → first token; PROMPT_ACCEPTED can resolve after tokens (long POST). */
    timeToFirstToken:
      delta(marks, "RUNTIME_READY", "FIRST_TOKEN") ??
      delta(marks, "PROMPT_ACCEPTED", "FIRST_TOKEN"),
    firstTokenToPaint: delta(marks, "FIRST_TOKEN", "FIRST_PAINT"),
    streamingAndTools: delta(marks, "FIRST_PAINT", "FINAL_RESPONSE"),
    finalUi: delta(marks, "FINAL_RESPONSE", "FINAL_UI"),
    total: delta(marks, "SEND_START", "FINAL_UI") ?? delta(marks, "SEND_START", "FINAL_RESPONSE"),
  };

  const candidates: Array<{ kind: TurnTimingReport["suspected"]; ms: number }> = [];
  if (totalsMs.firstTokenToPaint !== null && totalsMs.firstTokenToPaint >= 80) {
    candidates.push({ kind: "ui_paint", ms: totalsMs.firstTokenToPaint });
  }
  if (totalsMs.timeToFirstToken !== null) {
    candidates.push({ kind: "model_or_runtime", ms: totalsMs.timeToFirstToken });
  }
  if (totalsMs.runtimeEnsure !== null) {
    candidates.push({ kind: "runtime_ensure", ms: totalsMs.runtimeEnsure });
  }
  if (totalsMs.prepare !== null) {
    candidates.push({ kind: "prepare", ms: totalsMs.prepare });
  }

  let suspected: TurnTimingReport["suspected"] = "unknown";
  if (candidates.length > 0) {
    candidates.sort((a, b) => b.ms - a.ms);
    const top = candidates[0]!;
    const second = candidates[1];
    suspected =
      second !== undefined && second.ms > top.ms * 0.7 && second.kind !== top.kind
        ? "mixed"
        : top.kind;
  }

  return { marks, durationsMs, totalsMs, suspected };
}

export function formatTurnPerfSummary(report: TurnTimingReport): string {
  const t = report.totalsMs;
  const line = (label: string, ms: number | null, note: string): string =>
    `  ${label.padEnd(22)} ${ms === null ? "—".padStart(6) : `${String(ms).padStart(5)}ms`}  ${note}`;
  return [
    "[turn-perf] SUMMARY (paste this block)",
    line("prepare", t.prepare, "attachments/skills/dispatch  [app]"),
    line("optimistic_ui", t.optimisticUi, "append bubbles + renderState  [UI]"),
    line("runtime_ensure", t.runtimeEnsure, "create/reuse OpenCode session  [service]"),
    line("prompt_accept", t.promptAccept, "POST /message accepted  [network]"),
    line("time_to_first_token", t.timeToFirstToken, "wait until SSE token  [MODEL★]"),
    line("first_token_to_paint", t.firstTokenToPaint, "token event → bubble DOM  [UI★]"),
    line("streaming_tools", t.streamingAndTools, "rest of turn until terminal  [mixed]"),
    line("final_ui", t.finalUi, "persist + full renderState  [UI]"),
    line("TOTAL", t.total, `suspected=${report.suspected}`),
  ].join("\n");
}

export function createTurnTimingTracker(options: {
  readonly enabled: () => boolean;
  readonly now?: () => number;
  readonly log?: (line: string) => void;
}): TurnTimingTracker {
  const clock = options.now ?? (() => performance.now());
  const log = options.log ?? ((line: string) => console.info(line));
  let marks: TurnTimingMark[] = [];
  const seen = new Set<TurnTimingStage>();

  return {
    mark(stage, detail) {
      // Always record so SUMMARY stays complete even if logging is toggled mid-turn.
      if (ONCE_STAGES.has(stage) && seen.has(stage)) return;
      if (ONCE_STAGES.has(stage)) seen.add(stage);
      const entry: TurnTimingMark = {
        stage,
        atMs: Math.round(clock()),
        ...(detail !== undefined ? { detail } : {}),
      };
      marks = [...marks, entry];
      if (!options.enabled()) return;
      const origin = marks[0]?.atMs ?? entry.atMs;
      log(
        `[turn-perf] +${String(entry.atMs - origin).padStart(5)}ms  ${stage}` +
          (detail ? `  ${detail}` : ""),
      );
    },
    report() {
      const summary = buildTurnTimingReport(marks);
      if (options.enabled() && marks.length > 0) {
        log(formatTurnPerfSummary(summary));
        log(`[turn-perf] raw ${JSON.stringify(summary)}`);
      }
      return summary;
    },
    reset() {
      marks = [];
      seen.clear();
    },
  };
}
