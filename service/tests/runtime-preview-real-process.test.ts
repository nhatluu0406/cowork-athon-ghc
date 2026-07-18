/**
 * REAL-PROCESS integration tests for the preview runner (Windows only).
 *
 * The rest of the suite drives a {@link FakePreviewChild}: fast and deterministic, but a fake's
 * graceful `kill()` synchronously fires `exit`, which quietly assumes killing the direct child
 * reaps the whole tree. On real Windows that is FALSE — `child.kill()` terminates only the direct
 * child (`cmd.exe`); `npm → node → grandchild` survive as orphans unless a whole-tree `taskkill /T`
 * runs. These tests spawn actual OS processes through the REAL {@link nodePreviewSpawner} + the
 * REAL {@link createWorkspaceGuard} confinement + the REAL permission gate, so the no-orphan
 * guarantee, the curated-env boundary and output redaction are verified against the OS, not a mock.
 *
 * Deterministic: no live LLM, no network beyond loopback, fixtures written to an OS temp dir and
 * removed afterwards. Skipped on non-Windows (the product is Windows-only and `taskkill` is
 * Windows-specific).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPreviewService, type PreviewService } from "../src/runtime-preview/preview-service.js";
import { nodePreviewSpawner } from "../src/runtime-preview/preview-spawner.js";
import { createPreviewGate } from "../src/runtime-preview/preview-gate.js";
import { createInMemoryAuditSink } from "../src/permission/audit.js";
import { createNodeScheduler } from "../src/permission/timer.js";
import { createSecretScrubber } from "../src/diagnostics/secret-scrubber.js";

const WINDOWS_ONLY = process.platform !== "win32";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** True while a PID exists (signal 0 probes without killing; ESRCH ⇒ gone). */
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
  readonly service: PreviewService;
  cleanup(): void;
}

/**
 * Build a real preview service pointed at a fresh temp workspace whose `dev` script runs the given
 * node source. `parentEnvExtra` seeds fake secrets in the PARENT env to prove they are dropped.
 */
function makeRealFixture(devSource: string, parentEnvExtra: Record<string, string> = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), "cghc-realproc-"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "cghc-fixture", private: true, scripts: { dev: "node server.js" } }),
  );
  writeFileSync(join(root, "server.js"), devSource);

  const audit = createInMemoryAuditSink();
  const gate = createPreviewGate({
    audit,
    scheduler: createNodeScheduler(),
    now: () => new Date().toISOString(),
    timeoutMs: 60_000,
  });
  const service = createPreviewService({
    getActiveRoot: () => root,
    gate,
    scrubber: createSecretScrubber(),
    spawner: nodePreviewSpawner(),
    // Real WorkspaceGuard confinement, real port allocation/probe, real detector.
    parentEnv: { ...process.env, ...parentEnvExtra },
    startupTimeoutMs: 30_000,
    gracefulStopMs: 3_000,
  });

  return {
    root,
    service,
    cleanup() {
      // Best-effort orphan sweep even if the assertion failed: kill any pids the fixture recorded.
      for (const name of ["server.pid", "gc.pid"]) {
        const p = join(root, name);
        if (!existsSync(p)) continue;
        const pid = Number(readFileSync(p, "utf8").trim());
        if (Number.isInteger(pid) && pid > 0) {
          try {
            process.kill(pid);
          } catch {
            /* already gone */
          }
        }
      }
      // rmSync must never throw: a leftover EPERM (dir held by a surviving process) would MASK the
      // real assertion result. Best-effort only.
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        /* leave the temp dir for the OS to reap; the assertion result is what matters */
      }
    },
  };
}

/** A dev server that records its own + a grandchild's PID, prints secret probes, then a URL. */
const TREE_SERVER = `
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

// A grandchild (node → node) so we can prove whole-TREE termination, not just the direct child.
const gcPidFile = path.join(__dirname, "gc.pid");
const gc = spawn(
  process.execPath,
  ["-e", "require('fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1e9);", gcPidFile],
  { stdio: "ignore" },
);

fs.writeFileSync(path.join(__dirname, "server.pid"), String(process.pid));

const port = Number(process.env.PORT) || 0;
const server = http.createServer((_req, res) => res.end("ok"));
server.listen(port, "127.0.0.1", () => {
  // Secret boundary probes. NOTE: labels deliberately avoid the redaction keywords
  // (secret/token/key/...) so the probe line itself is not masked by the output scrubber.
  console.log("providerenv=" + (process.env.OPENAI_API_KEY ? "PRESENT" : "ABSENT"));
  console.log("vaultenv=" + (process.env.COWORK_VAULT_SECRET ? "PRESENT" : "ABSENT"));
  console.log("pathenv=" + (process.env.PATH || process.env.Path ? "PRESENT" : "ABSENT"));
  console.log("browserenv=" + process.env.BROWSER);
  // Output-redaction probes (must never appear verbatim in the buffer):
  console.log("token=sk-SHOULDBEREDACTED1234567890");
  console.log("Authorization: Bearer AAAA.SHOULDBEREDACTED.BBBB");
  // Port announcement the runner detects:
  console.log("  Local:   http://localhost:" + server.address().port + "/");
});
`;

test(
  "real dev-server: reaches running, curated env drops secrets, output redacted",
  { skip: WINDOWS_ONLY },
  async () => {
    const fx = makeRealFixture(TREE_SERVER, {
      OPENAI_API_KEY: "sk-leak-should-not-reach-child",
      COWORK_VAULT_SECRET: "vault-leak-should-not-reach-child",
    });
    try {
      const info = await fx.service.detect();
      assert.equal(info.kind, "dev-server", "fixture detected as a dev-server project");

      const { requestId } = await fx.service.requestLaunch({ kind: "dev-server", script: "dev" });
      await fx.service.resolveLaunch(requestId, "allow");

      const running = await waitUntil(() => fx.service.state().status === "running", 30_000);
      assert.ok(running, `dev server should reach running (was ${fx.service.state().status})`);
      const url = fx.service.state().url ?? "";
      assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/, "detected a loopback URL");

      const text = fx.service
        .output(0)
        .lines.map((l) => l.text)
        .join("\n");

      // Curated env boundary: no provider/vault secret, but PATH + steering vars present.
      assert.match(text, /providerenv=ABSENT/, "OPENAI_API_KEY did not leak into the child env");
      assert.match(text, /vaultenv=ABSENT/, "vault secret did not leak into the child env");
      assert.match(text, /pathenv=PRESENT/, "PATH is present so the child can resolve node/npm");
      assert.match(text, /browserenv=none/, "BROWSER=none steering var applied");

      // Output redaction: the shaped secrets are masked; the raw values never appear.
      assert.doesNotMatch(text, /sk-SHOULDBEREDACTED1234567890/, "token value redacted");
      assert.doesNotMatch(text, /AAAA\.SHOULDBEREDACTED\.BBBB/, "authorization value redacted");
      assert.match(text, /\[REDACTED\]/, "redaction placeholder present");

      await fx.service.stop("user");
      assert.equal(fx.service.state().status, "stopped");
    } finally {
      await fx.service.dispose("shutdown").catch(() => undefined);
      fx.cleanup();
    }
  },
);

test(
  "real dev-server: stop terminates the whole process tree — no orphaned grandchild",
  { skip: WINDOWS_ONLY },
  async () => {
    const fx = makeRealFixture(TREE_SERVER);
    let gcPid = 0;
    let serverPid = 0;
    try {
      const { requestId } = await fx.service.requestLaunch({ kind: "dev-server", script: "dev" });
      await fx.service.resolveLaunch(requestId, "allow");
      assert.ok(await waitUntil(() => fx.service.state().status === "running", 30_000), "reached running");

      // The grandchild wrote its PID; confirm the whole tree is actually alive before we stop.
      assert.ok(await waitUntil(() => existsSync(join(fx.root, "gc.pid")), 10_000), "grandchild started");
      gcPid = Number(readFileSync(join(fx.root, "gc.pid"), "utf8").trim());
      serverPid = Number(readFileSync(join(fx.root, "server.pid"), "utf8").trim());
      assert.ok(isAlive(gcPid), "grandchild alive before stop");
      assert.ok(isAlive(serverPid), "server node alive before stop");

      await fx.service.stop("user");

      // The crux: after stop, NOTHING in the tree may survive (Windows taskkill /T /F).
      const gcDead = await waitUntil(() => !isAlive(gcPid), 10_000);
      const serverDead = await waitUntil(() => !isAlive(serverPid), 10_000);
      assert.ok(serverDead, `server node must be terminated (pid ${serverPid})`);
      assert.ok(gcDead, `grandchild must NOT be orphaned (pid ${gcPid})`);
    } finally {
      await fx.service.dispose("shutdown").catch(() => undefined);
      // Extra safety net: reap anything the assertions may have left behind.
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
  "real dev-server: a script that exits non-zero before serving is reported as failed",
  { skip: WINDOWS_ONLY },
  async () => {
    const fx = makeRealFixture(`process.stderr.write("boom\\n"); process.exit(7);`);
    try {
      const { requestId } = await fx.service.requestLaunch({ kind: "dev-server", script: "dev" });
      await fx.service.resolveLaunch(requestId, "allow");
      const failed = await waitUntil(() => fx.service.state().status === "failed", 30_000);
      assert.ok(failed, `crashing script should end in failed (was ${fx.service.state().status})`);
      assert.equal(fx.service.state().url, null, "no URL for a failed launch");
    } finally {
      await fx.service.dispose("shutdown").catch(() => undefined);
      fx.cleanup();
    }
  },
);
