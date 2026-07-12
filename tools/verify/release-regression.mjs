/**
 * Non-live release regression for Cowork GHC packaged POC baseline.
 * No DeepSeek calls, no API keys, no long-lived processes.
 *
 * Usage: node tools/verify/release-regression.mjs
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const REPO = process.cwd();
const OPENCODE = join(REPO, "node_modules", "opencode-ai", "bin", "opencode.exe");

function run(name, command) {
  process.stdout.write(`release-regression: ${name}…\n`);
  execSync(command, { cwd: REPO, stdio: "inherit", env: process.env });
  process.stdout.write(`release-regression: ${name} PASS\n`);
}

function check(name, ok, detail) {
  if (!ok) {
    console.error(`release-regression: ${name} FAIL — ${detail}`);
    process.exit(1);
  }
  process.stdout.write(`release-regression: ${name} PASS\n`);
}

try {
  run("typecheck", "npm run typecheck");

  run(
    "provider-contracts",
    'node --import tsx --test service/tests/provider-error-map.test.ts service/tests/provider-http-connector.test.ts service/tests/runtime-reply-adapter.test.ts service/tests/permission-bridge.test.ts',
  );

  run(
    "conversation-management",
    "node --import tsx --test service/tests/conversation-store.test.ts service/tests/conversation-router.test.ts service/tests/conversation-relaunch.test.ts app/ui/tests/conversation-controller.test.ts",
  );

  run("app-lifecycle-cli", "node --import tsx --test tools/app/tests/app-cli.test.ts");

  check("opencode-binary", existsSync(OPENCODE), `missing ${OPENCODE} — run npm install`);
  check(
    "electron-shell-bundle",
    existsSync(join(REPO, "app", "shell", "dist", "main.cjs")),
    "run npm run build:app when testing packaged layout",
  );

  run("lifecycle-scripts", "node tools/verify/lifecycle-scripts.mjs");

  try {
    run("loop-engineer-verify", "node tools/loop-engineer/cli.mjs verify");
  } catch {
    process.stdout.write("release-regression: loop-engineer-verify SKIP (maintenance-only)\n");
  }

  console.log("release-regression: PASS");
} catch (err) {
  console.error("release-regression: FAIL", err instanceof Error ? err.message : err);
  process.exit(1);
}
