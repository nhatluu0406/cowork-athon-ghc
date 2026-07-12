/**
 * Activity presentation packaged verification — deterministic EV + file preview tests.
 */

import { execSync } from "node:child_process";

function run(name, command) {
  process.stdout.write(`activity-packaged: ${name}…\n`);
  execSync(command, { cwd: process.cwd(), stdio: "inherit" });
  process.stdout.write(`activity-packaged: ${name} PASS\n`);
}

try {
  run(
    "deterministic",
    "node --import tsx --test app/ui/tests/activity-model.test.ts service/tests/workspace-file-preview.test.ts service/tests/execution-sse-mapper.test.ts",
  );
  process.stdout.write("activity-packaged: journeys A–D (deterministic) PASS\n");
  process.stdout.write("activity-packaged: live SKIP (use fixture workspace + ≤3 live requests manually)\n");
  console.log("activity-packaged: PASS");
} catch (err) {
  console.error("activity-packaged: FAIL", err instanceof Error ? err.message : err);
  process.exit(1);
}
