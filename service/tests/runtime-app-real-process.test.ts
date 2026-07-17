/**
 * REAL-PROCESS integration tests for the desktop-app runner (Windows only).
 *
 * Like the preview real-process suite, this spawns actual OS processes through the REAL
 * nodePreviewSpawner + REAL WorkspaceGuard confinement + REAL permission gate + REAL detector
 * (the fixture declares an `electron` devDependency so it classifies as an app; the scripts are
 * plain `node` so no electron install is needed). It verifies the no-orphan tree-kill, the
 * curated-env secret boundary, output redaction, a build exit, and a crash — against the OS, not
 * a mock. Skipped on non-Windows.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppService, type AppService } from "../src/runtime-app/app-service.js";
import { nodePreviewSpawner } from "../src/runtime-preview/preview-spawner.js";
import { createPreviewGate } from "../src/runtime-preview/preview-gate.js";
import { createInMemoryAuditSink } from "../src/permission/audit.js";
import { createNodeScheduler } from "../src/permission/timer.js";
import { createSecretScrubber } from "../src/diagnostics/secret-scrubber.js";

const WINDOWS_ONLY = process.platform !== "win32";
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function waitUntil(fn: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (fn()) return true;
    await sleep(100);
  }
  return fn();
}

interface Fixture {
  readonly root: string;
  readonly service: AppService;
  cleanup(): void;
}

function makeFixture(scripts: Record<string, string>, readinessMs: number, parentEnvExtra: Record<string, string> = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), "cghc-apprp-"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "cghc-app-fixture", private: true, devDependencies: { electron: "^30.0.0" }, scripts }),
  );
  const audit = createInMemoryAuditSink();
  const gate = createPreviewGate({ audit, scheduler: createNodeScheduler(), now: () => new Date().toISOString(), timeoutMs: 60_000 });
  const service = createAppService({
    getActiveRoot: () => root,
    gate,
    scrubber: createSecretScrubber(),
    spawner: nodePreviewSpawner(),
    parentEnv: { ...process.env, ...parentEnvExtra },
    readinessMs,
    gracefulStopMs: 3_000,
  });
  return {
    root,
    service,
    cleanup() {
      for (const name of ["server.pid", "gc.pid"]) {
        const p = join(root, name);
        if (!existsSync(p)) continue;
        const pid = Number(readFileSync(p, "utf8").trim());
        if (Number.isInteger(pid) && pid > 0) {
          try {
            process.kill(pid);
          } catch {
            /* gone */
          }
        }
      }
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        /* a surviving process would EPERM here; the assertion result is what matters */
      }
    },
  };
}

/** A long-lived "app": records its own + a grandchild PID, prints secret probes, then idles. */
const APP_MAIN = `
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const gcPidFile = path.join(__dirname, "gc.pid");
const gc = spawn(
  process.execPath,
  ["-e", "require('fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1e9);", gcPidFile],
  { stdio: "ignore" },
);
fs.writeFileSync(path.join(__dirname, "server.pid"), String(process.pid));
console.log("providerenv=" + (process.env.OPENAI_API_KEY ? "PRESENT" : "ABSENT"));
console.log("pathenv=" + (process.env.PATH || process.env.Path ? "PRESENT" : "ABSENT"));
console.log("api_key=sk-APP-SHOULDBEREDACTED-0987654321");
console.log("Authorization: Bearer APP.SHOULDBEREDACTED.TOKEN");
console.log("desktop app up");
setInterval(() => {}, 1e9);
`;

async function approveRun(fx: Fixture, script: string): Promise<void> {
  const { requestId } = await fx.service.requestLaunch({ action: "run", script });
  await fx.service.resolveLaunch(requestId, "allow");
}

test(
  "real app run: reaches running, curated env drops secrets, output redacted, stop leaves no orphan",
  { skip: WINDOWS_ONLY },
  async () => {
    const fx = makeFixture({ start: "node app.js" }, 500, {
      OPENAI_API_KEY: "sk-leak-should-not-reach-app",
    });
    writeFileSync(join(fx.root, "app.js"), APP_MAIN);
    let gcPid = 0;
    let serverPid = 0;
    try {
      const info = await fx.service.detect();
      assert.equal(info.kind, "electron", "fixture detected as an electron app");

      await approveRun(fx, "start");
      assert.ok(await waitUntil(() => fx.service.state().status === "running", 30_000), "reached running");

      assert.ok(await waitUntil(() => existsSync(join(fx.root, "gc.pid")), 10_000), "grandchild started");
      gcPid = Number(readFileSync(join(fx.root, "gc.pid"), "utf8").trim());
      serverPid = Number(readFileSync(join(fx.root, "server.pid"), "utf8").trim());
      assert.ok(isAlive(gcPid) && isAlive(serverPid), "app + grandchild alive before stop");

      const text = fx.service
        .output(0)
        .lines.map((l) => l.text)
        .join("\n");
      assert.match(text, /providerenv=ABSENT/, "provider secret dropped from the app env");
      assert.match(text, /pathenv=PRESENT/, "PATH present so the app can run node");
      assert.doesNotMatch(text, /sk-APP-SHOULDBEREDACTED-0987654321/, "api_key redacted");
      assert.doesNotMatch(text, /APP\.SHOULDBEREDACTED\.TOKEN/, "authorization redacted");
      assert.match(text, /\[REDACTED\]/, "redaction placeholder present");

      await fx.service.stop("user");
      const serverDead = await waitUntil(() => !isAlive(serverPid), 10_000);
      const gcDead = await waitUntil(() => !isAlive(gcPid), 10_000);
      assert.ok(serverDead, `app process must be terminated (pid ${serverPid})`);
      assert.ok(gcDead, `grandchild must NOT be orphaned (pid ${gcPid})`);
      assert.equal(fx.service.state().status, "stopped");
    } finally {
      await fx.service.dispose("shutdown").catch(() => undefined);
      for (const pid of [gcPid, serverPid]) {
        if (pid > 0 && isAlive(pid)) {
          try {
            process.kill(pid);
          } catch {
            /* ignore */
          }
        }
      }
      fx.cleanup();
    }
  },
);

test(
  "real app build: a build script that exits 0 ends in stopped (build ok)",
  { skip: WINDOWS_ONLY },
  async () => {
    const fx = makeFixture(
      { start: "node app.js", build: `node -e "console.log('build done')"` },
      500,
    );
    writeFileSync(join(fx.root, "app.js"), APP_MAIN);
    try {
      const { requestId } = await fx.service.requestLaunch({ action: "build", script: "build" });
      await fx.service.resolveLaunch(requestId, "allow");
      const done = await waitUntil(() => fx.service.state().status === "stopped", 30_000);
      assert.ok(done, `build should end stopped (was ${fx.service.state().status})`);
      assert.match(
        fx.service.output(0).lines.map((l) => l.text).join("\n"),
        /Build thành công/,
      );
    } finally {
      await fx.service.dispose("shutdown").catch(() => undefined);
      fx.cleanup();
    }
  },
);

test(
  "real app run: a script that exits non-zero is reported as failed",
  { skip: WINDOWS_ONLY },
  async () => {
    // High readiness so the quick crash is observed BEFORE the starting→running transition.
    const fx = makeFixture({ start: `node -e "process.exit(5)"` }, 20_000);
    try {
      await approveRun(fx, "start");
      const failed = await waitUntil(() => fx.service.state().status === "failed", 30_000);
      assert.ok(failed, `crash should end failed (was ${fx.service.state().status})`);
    } finally {
      await fx.service.dispose("shutdown").catch(() => undefined);
      fx.cleanup();
    }
  },
);
