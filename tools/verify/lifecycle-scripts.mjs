/**
 * Explorer-style lifecycle script checks (start.bat / clean.bat / stop.bat).
 * Uses cmd /c with quoted paths; pipes newline to satisfy trailing pause.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const REPO = process.cwd();
const SCRIPTS = join(REPO, "scripts");
const START_BAT = join(SCRIPTS, "start.bat");
const STOP_BAT = join(SCRIPTS, "stop.bat");
const CLEAN_BAT = join(SCRIPTS, "clean.bat");
const BUILD_BAT = join(SCRIPTS, "build.bat");

function cmdBat(batPath, args = "") {
  const quoted = `"${batPath}"${args ? ` ${args}` : ""}`;
  return execSync(`cmd /c "echo.| call ${quoted}"`, {
    cwd: REPO,
    encoding: "utf8",
    timeout: 120_000,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function assertIncludes(text, pattern, label) {
  if (!pattern.test(text)) {
    throw new Error(`${label}: output missing ${pattern}`);
  }
}

// Self-locates via %~dp0 (scripts live under repo/scripts).
for (const bat of [START_BAT, STOP_BAT, CLEAN_BAT, BUILD_BAT]) {
  if (!existsSync(bat)) throw new Error(`missing ${bat}`);
  const src = readFileSync(bat, "utf8");
  if (!src.includes("%~dp0")) throw new Error(`${bat} must resolve root via %~dp0`);
}

mkdirSync(join(REPO, ".runtime"), { recursive: true });

console.log("lifecycle: stop when idle");
const stopIdle = cmdBat(STOP_BAT);
assertIncludes(stopIdle, /nothing to stop|stop:/i, "stop.bat idle");

console.log("lifecycle: start.bat");
const startSrc = readFileSync(START_BAT, "utf8");
if (!/:show_window/.test(startSrc) || !/SetForegroundWindow/.test(startSrc)) {
  throw new Error("start.bat must restore and foreground the Cowork GHC window after launch");
}
const stopSrc = readFileSync(STOP_BAT, "utf8");
if (!/taskkill \/F \/T \/IM "Cowork GHC\.exe"/.test(stopSrc)) {
  throw new Error("stop.bat must clear stale Cowork GHC packaged processes");
}
const startOut = cmdBat(START_BAT);
assertIncludes(startOut, /start:\s*READY|already running/i, "start.bat");
if (/already running/i.test(startOut)) {
  console.log("lifecycle: start skipped duplicate launch (already running)");
} else {
  console.log("lifecycle: stop after start");
  cmdBat(STOP_BAT);
  const startAgain = cmdBat(START_BAT);
  assertIncludes(startAgain, /already running|start:\s*READY/i, "start.bat second launch");
  cmdBat(STOP_BAT);
}

console.log("lifecycle: clean.bat structure");
const cleanSrc = readFileSync(CLEAN_BAT, "utf8");
if (!/--yes/.test(cleanSrc) || !/:run_clean/.test(cleanSrc)) {
  throw new Error("clean.bat must support --yes and :run_clean label");
}
const cleanPreview = execSync(`cmd /c "echo.| call \"${CLEAN_BAT}\""`, {
  cwd: REPO,
  encoding: "utf8",
  timeout: 60_000,
});
if (/cannot find the batch label/i.test(cleanPreview)) {
  throw new Error("clean.bat interactive path batch-label regression");
}
assertIncludes(cleanPreview, /Proceed with deletion|would be deleted/i, "clean.bat preview");
console.log("lifecycle: clean.bat allowlist enforced via tools/app/tests/app-cli.test.ts");

console.log("lifecycle: build.bat lock preflight");
const buildSrc = readFileSync(BUILD_BAT, "utf8");
if (!/stop any running packaged app/i.test(buildSrc) || !/wait_exe_unlocked/i.test(buildSrc)) {
  throw new Error("build.bat must stop Cowork GHC and wait for the packaged exe lock before packaging");
}

console.log("lifecycle-scripts: PASS");
