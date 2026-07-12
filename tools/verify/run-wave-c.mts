/**
 * CGHC-028 Wave C orchestrator. Runs the three verification legs (NO-live first, then the two
 * BOUNDED live legs), aggregates a machine report, scans it for secrets, and writes
 * tools/verify/wave-c-report.json. Enforces the ≤3-successful-request live budget globally.
 *
 * Run: node --import tsx tools/verify/run-wave-c.mts
 *
 * This is a SERVICE-LAYER / dev live proof of the LLM critical path. It is NOT the packaged-
 * installer smoke test — the report labels this explicitly and never claims a packaged PASS.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runLeg1 } from "./leg1-live-critical-path.mts";
import { runLeg2 } from "./leg2-provider-error.mts";
import { runLeg3 } from "./leg3-template-resume.mts";
import { ROOT, budget, assertArtifactClean, safeJson, type LegResult } from "./harness-lib.mts";

async function main(): Promise<number> {
  const startedAt = new Date().toISOString();
  const legs: LegResult[] = [];

  // NO-live first (deterministic, fast), then the live legs that consume the budget.
  legs.push(await runLeg3());
  const leg1 = await runLeg1();
  legs.push(leg1.result);
  legs.push(await runLeg2());

  const report = {
    task: "CGHC-028",
    wave: "C",
    kind: "service-layer + bounded live verification (NOT a packaged-installer smoke)",
    generatedAt: startedAt,
    finishedAt: new Date().toISOString(),
    budget: {
      maxSuccesses: budget.maxSuccesses,
      successfulRequestsUsed: budget.successes,
      retriesUsed: budget.retries,
      withinBudget: budget.successes <= budget.maxSuccesses,
    },
    secretScan: legs.every((l) => l.secretScan === "CLEAN") ? "CLEAN" : "LEAK",
    overall: overallOf(legs),
    disclaimer:
      "Dev/service-layer live proof of the real LLM path (real opencode.exe + real provider behind it). " +
      "This is legitimate evidence for the LLM path but is NOT the packaged-installer smoke test; " +
      "no packaged-build PASS is claimed here.",
    legs,
  };

  const serialized = safeJson(report);
  const outPath = join(ROOT, "tools", "verify", "wave-c-report.json");
  assertArtifactClean("wave-c-report.json", serialized); // refuse to write if any secret is present
  writeFileSync(outPath, serialized, "utf8");

  // Secret-free console summary.
  process.stdout.write("\n=== CGHC-028 Wave C summary ===\n");
  for (const l of legs) {
    process.stdout.write(`[${l.status}] ${l.leg}: ${l.title}\n`);
    for (const p of l.proven) process.stdout.write(`   + ${p}\n`);
    for (const n of l.notes) process.stdout.write(`   . ${n}\n`);
    if (l.error) process.stdout.write(`   ! error: ${l.error}\n`);
  }
  process.stdout.write(
    `\nsuccessful_live_requests=${budget.successes}/${budget.maxSuccesses} retries=${budget.retries} ` +
      `secret_scan=${report.secretScan} overall=${report.overall}\n`,
  );
  process.stdout.write(`report=${outPath}\n`);

  // Exit non-zero only on an outright FAIL or a secret leak (BLOCKED/PARTIAL are honest outcomes).
  const hardFail = legs.some((l) => l.status === "FAIL") || report.secretScan === "LEAK";
  return hardFail ? 1 : 0;
}

function overallOf(legs: LegResult[]): string {
  if (legs.some((l) => l.status === "FAIL")) return "FAIL";
  if (legs.some((l) => l.status === "BLOCKED")) return "PARTIAL_OR_BLOCKED";
  if (legs.some((l) => l.status === "PARTIAL")) return "PARTIAL";
  return "PASS";
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`wave-c harness crashed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
