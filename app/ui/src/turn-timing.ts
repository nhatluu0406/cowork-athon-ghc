/**
 * Local turn-timing diagnostics — verboseLogging only, never remote.
 */

export type TurnTimingStage =
  | "PROMPT_SENT"
  | "FIRST_TOKEN"
  | "TOOL_REQUEST"
  | "PERMISSION_SHOWN"
  | "PERMISSION_APPROVED"
  | "TOOL_FINISHED"
  | "FILE_VERIFIED"
  | "FINAL_RESPONSE";

export interface TurnTimingMark {
  readonly stage: TurnTimingStage;
  readonly atMs: number;
  readonly detail?: string;
}

export interface TurnTimingReport {
  readonly marks: readonly TurnTimingMark[];
  readonly slowest: TurnTimingStage | null;
  readonly durationsMs: Readonly<Record<string, number>>;
}

export interface TurnTimingTracker {
  mark(stage: TurnTimingStage, detail?: string): void;
  report(): TurnTimingReport;
  reset(): void;
}

export function createTurnTimingTracker(options: {
  readonly enabled: () => boolean;
  readonly now?: () => number;
  readonly log?: (line: string) => void;
}): TurnTimingTracker {
  const clock = options.now ?? (() => Date.now());
  const log = options.log ?? ((line: string) => console.info(line));
  let marks: TurnTimingMark[] = [];
  const seen = new Set<TurnTimingStage>();

  return {
    mark(stage, detail) {
      if (!options.enabled()) return;
      if (seen.has(stage) && stage !== "TOOL_REQUEST" && stage !== "TOOL_FINISHED" && stage !== "FILE_VERIFIED") {
        return;
      }
      if (stage === "FIRST_TOKEN" || stage === "PROMPT_SENT" || stage === "FINAL_RESPONSE" || stage === "PERMISSION_SHOWN" || stage === "PERMISSION_APPROVED") {
        seen.add(stage);
      }
      const entry: TurnTimingMark = {
        stage,
        atMs: clock(),
        ...(detail !== undefined ? { detail } : {}),
      };
      marks = [...marks, entry];
      log(`[turn-timing] ${stage}${detail ? ` ${detail}` : ""} @${entry.atMs}`);
    },
    report() {
      const durationsMs: Record<string, number> = {};
      let slowest: TurnTimingStage | null = null;
      let slowestMs = -1;
      for (let i = 1; i < marks.length; i += 1) {
        const prev = marks[i - 1]!;
        const curr = marks[i]!;
        const key = `${prev.stage}->${curr.stage}`;
        const delta = curr.atMs - prev.atMs;
        durationsMs[key] = delta;
        if (delta > slowestMs) {
          slowestMs = delta;
          slowest = curr.stage;
        }
      }
      const summary: TurnTimingReport = { marks, slowest, durationsMs };
      if (options.enabled() && marks.length > 0) {
        log(`[turn-timing] report ${JSON.stringify(summary)}`);
      }
      return summary;
    },
    reset() {
      marks = [];
      seen.clear();
    },
  };
}
