/**
 * Session management packaged verification — persistence API + optional bounded live smoke.
 *
 * Journeys A–D:
 *  A persistence — conversation store survives service relaunch (no live)
 *  B multi-session — two records, search, rename (no live)
 *  C interruption — running → interrupted on relaunch (no live)
 *  D deletion — remove metadata, workspace path untouched (no live)
 *
 * Optional live (≤1 inference): set COWORK_SESSION_LIVE=1 and .env with DeepSeek key.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const REPO = process.cwd();
const EXE = join(REPO, "dist-app", "win-unpacked", "Cowork GHC.exe");

function run(name, command) {
  process.stdout.write(`session-packaged: ${name}…\n`);
  execSync(command, { cwd: REPO, stdio: "inherit", env: process.env });
  process.stdout.write(`session-packaged: ${name} PASS\n`);
}

function journeyDeterministic() {
  run("journeys-abcd", "node --import tsx --test service/tests/conversation-relaunch.test.ts service/tests/conversation-store.test.ts");
}

try {
  journeyDeterministic();
  process.stdout.write("session-packaged: journeys A–D (deterministic) PASS\n");

  if (process.env["COWORK_SESSION_LIVE"] === "1" && existsSync(EXE)) {
    process.stdout.write("session-packaged: live packaged smoke delegated to minimal-packaged-smoke (1 connection test)\n");
    run("minimal-live", "node tools/verify/minimal-packaged-smoke.mjs");
  } else {
    process.stdout.write("session-packaged: live SKIP (set COWORK_SESSION_LIVE=1 for optional live)\n");
  }

  if (!existsSync(join(REPO, "dist-app", "win-unpacked", "Cowork GHC.exe"))) {
    process.stdout.write("session-packaged: exe layout SKIP (run npm run package:win)\n");
  }

  console.log("session-packaged: PASS");
} catch (err) {
  console.error("session-packaged: FAIL", err instanceof Error ? err.message : err);
  process.exit(1);
}
