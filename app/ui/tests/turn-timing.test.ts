import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildTurnTimingReport,
  formatTurnPerfSummary,
  type TurnTimingMark,
} from "../src/turn-timing.js";

test("buildTurnTimingReport flags model wait over tiny UI paint", () => {
  const marks: TurnTimingMark[] = [
    { stage: "SEND_START", atMs: 0 },
    { stage: "PREPARE_DONE", atMs: 20 },
    { stage: "OPTIMISTIC_UI", atMs: 35 },
    { stage: "RUNTIME_READY", atMs: 200 },
    { stage: "PROMPT_ACCEPTED", atMs: 250 },
    { stage: "FIRST_TOKEN", atMs: 2250 },
    { stage: "FIRST_PAINT", atMs: 2265 },
    { stage: "FINAL_RESPONSE", atMs: 4000 },
    { stage: "FINAL_UI", atMs: 4050 },
  ];
  const report = buildTurnTimingReport(marks);
  assert.equal(report.totalsMs.timeToFirstToken, 2050);
  assert.equal(report.totalsMs.firstTokenToPaint, 15);
  assert.equal(report.suspected, "model_or_runtime");
  assert.match(formatTurnPerfSummary(report), /time_to_first_token/);
});

test("buildTurnTimingReport suspects UI when paint lag dominates", () => {
  const marks: TurnTimingMark[] = [
    { stage: "SEND_START", atMs: 0 },
    { stage: "PREPARE_DONE", atMs: 10 },
    { stage: "OPTIMISTIC_UI", atMs: 20 },
    { stage: "RUNTIME_READY", atMs: 40 },
    { stage: "PROMPT_ACCEPTED", atMs: 60 },
    { stage: "FIRST_TOKEN", atMs: 160 },
    { stage: "FIRST_PAINT", atMs: 460 },
    { stage: "FINAL_RESPONSE", atMs: 500 },
    { stage: "FINAL_UI", atMs: 520 },
  ];
  const report = buildTurnTimingReport(marks);
  assert.equal(report.totalsMs.firstTokenToPaint, 300);
  assert.equal(report.suspected, "ui_paint");
});
