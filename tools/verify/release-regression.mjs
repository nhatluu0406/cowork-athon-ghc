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
    "node --import tsx --test service/tests/conversation-store.test.ts service/tests/conversation-router.test.ts service/tests/conversation-relaunch.test.ts service/tests/conversation-multi-turn.test.ts service/tests/conversation-skill-provenance.test.ts service/tests/message-role-ev-mapper.test.ts service/tests/workspace-attachment-read.test.ts service/tests/attachment-secret-policy.test.ts service/tests/provider-readiness.test.ts service/tests/skill-catalog.test.ts app/ui/tests/conversation-controller.test.ts app/ui/tests/transcript-context.test.ts app/ui/tests/assistant-output.test.ts app/ui/tests/runtime-turn-planner.test.ts app/ui/tests/attachment-context.test.ts app/ui/tests/attachment-pending.test.ts app/ui/tests/dispatch-plan.test.ts app/ui/tests/skill-dispatch.test.ts app/ui/tests/skills-panel.test.ts app/ui/tests/surface-registry.test.ts app/ui/tests/attachment-secret-policy.test.ts app/ui/tests/provider-readiness.test.ts app/ui/tests/modal-focus.test.ts",
  );

  run(
    "activity-presentation",
    "node --import tsx --test app/ui/tests/activity-model.test.ts app/ui/tests/session-finalization.test.ts service/tests/workspace-file-preview.test.ts service/tests/file-review.test.ts service/tests/file-review-router.test.ts service/tests/text-part-mapper.test.ts service/tests/conversation-store.test.ts service/tests/workspace-resolve-relative.test.ts service/tests/e2e-mock-llm.test.ts",
  );

  run("mock-llm-gateway", "node --test tools/verify/mock-llm-gateway.test.mjs");

  run("app-lifecycle-cli", "node --import tsx --test tools/app/tests/app-cli.test.ts");

  run("packaged-launch-env", "node --test tools/verify/packaged-launch-env.test.mjs");

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
