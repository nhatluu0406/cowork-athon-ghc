/**
 * CGHC-028 Wave B2b — the APP lifecycle CLI (init/start/stop/clean/status), driven entirely
 * through injected seams so NO real npm build, NO real Electron spawn, NO real OpenCode child,
 * and NO real taskkill run in this path. Proves the honest exit-code contract + that clean reuses
 * the manifest allowlist (deletes only allowlisted paths; refuses an unsafe/parent entry).
 *
 * The CLI modules are neutral ESM (`.mjs`); this TS test imports them and runs under tsx.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
import * as commands from "../commands.mjs";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import cli from "../cli.mjs";

const { cmdInit, cmdStart, cmdStop, cmdClean, cmdStatus, EXIT } = commands as any;

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "cowork-app-cli-"));
  return root;
}
function cleanup(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

test("init is idempotent: fake deps return OK on first AND repeat run", () => {
  const root = tempRoot();
  try {
    let installs = 0;
    let builds = 0;
    const deps = {
      toolPresent: () => true,
      install: () => { installs += 1; },
      build: () => { builds += 1; },
      binExists: () => true,
    };
    assert.equal(cmdInit(root, deps), EXIT.OK);
    assert.equal(cmdInit(root, deps), EXIT.OK, "re-running init is a clean no-op success");
    assert.equal(installs, 2);
    assert.equal(builds, 2);
  } finally {
    cleanup(root);
  }
});

test("init reports MISSING_TOOLCHAIN when npm is absent (no build attempted)", () => {
  const root = tempRoot();
  try {
    let builds = 0;
    const code = cmdInit(root, {
      toolPresent: () => false,
      install: () => {},
      build: () => { builds += 1; },
      binExists: () => true,
    });
    assert.equal(code, EXIT.MISSING_TOOLCHAIN);
    assert.equal(builds, 0);
  } finally {
    cleanup(root);
  }
});

test("init reports MISSING_BINARY when the pinned OpenCode binary is absent", () => {
  const root = tempRoot();
  try {
    const code = cmdInit(root, {
      toolPresent: () => true,
      install: () => {},
      build: () => {},
      binExists: () => false,
    });
    assert.equal(code, EXIT.MISSING_BINARY);
  } finally {
    cleanup(root);
  }
});

test("start launches the injected fake electron ONCE and records the PID", () => {
  const root = tempRoot();
  try {
    mkdirSync(join(root, ".runtime"), { recursive: true });
    let spawnCalls = 0;
    let recordedPid: number | null = null;
    const code = cmdStart(root, {
      exists: (p: string) => p.endsWith("main.cjs"), // packaged absent, dev main present
      electronPath: "C:/fake/electron.exe",
      spawn: () => { spawnCalls += 1; return { pid: 4242, unref: () => {} }; },
      recordPid: (_root: string, pid: number) => { recordedPid = pid; },
    });
    assert.equal(code, EXIT.OK);
    assert.equal(spawnCalls, 1, "exactly one launch");
    assert.equal(recordedPid, 4242, "the launched PID is tracked under .runtime");
  } finally {
    cleanup(root);
  }
});

test("start refuses when not initialized (run init first)", () => {
  const root = tempRoot();
  try {
    const code = cmdStart(root, { spawn: () => ({ pid: 1 }), recordPid: () => {} });
    assert.equal(code, EXIT.NOT_INITIALIZED);
  } finally {
    cleanup(root);
  }
});

test("start refuses when the app is not built (no main.cjs, no packaged exe)", () => {
  const root = tempRoot();
  try {
    mkdirSync(join(root, ".runtime"), { recursive: true });
    let spawnCalls = 0;
    const code = cmdStart(root, {
      exists: () => false,
      spawn: () => { spawnCalls += 1; return { pid: 1 }; },
      recordPid: () => {},
    });
    assert.equal(code, EXIT.NOT_INITIALIZED);
    assert.equal(spawnCalls, 0, "never spawns when nothing is built");
  } finally {
    cleanup(root);
  }
});

test("stop with nothing running is a valid 0", () => {
  const root = tempRoot();
  try {
    const code = cmdStop(root, { stopAll: () => ({ mode: "empty", killed: [], pruned: [], failed: [], unverifiable: [] }) });
    assert.equal(code, EXIT.OK);
  } finally {
    cleanup(root);
  }
});

test("stop returns OK after a tracked process is killed, non-zero when one fails", () => {
  const root = tempRoot();
  try {
    const ok = cmdStop(root, {
      stopAll: () => ({ mode: "verified", killed: [{ record: { role: "app-shell", pid: 9 } }], pruned: [], failed: [], unverifiable: [] }),
    });
    assert.equal(ok, EXIT.OK);
    const bad = cmdStop(root, {
      stopAll: () => ({ mode: "verified", killed: [], pruned: [], failed: [{ record: { role: "app-shell", pid: 9 }, reason: "still alive" }], unverifiable: [] }),
    });
    assert.equal(bad, EXIT.STOP_FAILED);
  } finally {
    cleanup(root);
  }
});

test("clean deletes ONLY allowlisted paths and skips a preserve-overlapping entry", () => {
  const root = tempRoot();
  try {
    const removed: string[] = [];
    const manifest = {
      categories: { generated: ["dist", "node_modules", "docs"], preserve: ["docs", ".git"] },
      cleanable_categories: ["generated"],
    };
    const code = cmdClean(root, true, {
      isRunning: () => false,
      loadManifest: () => manifest,
      existsAbs: () => true, // root-certainty markers "present"
      existsRel: () => true,
      rm: (abs: string) => { removed.push(abs); },
    });
    assert.equal(code, EXIT.OK);
    assert.ok(removed.some((p) => p.endsWith("dist")));
    assert.ok(removed.some((p) => p.endsWith("node_modules")));
    assert.ok(!removed.some((p) => p.endsWith("docs")), "a preserve-overlapping entry is never deleted");
  } finally {
    cleanup(root);
  }
});

test("clean REFUSES a manifest with a parent-traversal entry (nothing deleted)", () => {
  const root = tempRoot();
  try {
    let rmCalls = 0;
    const code = cmdClean(root, true, {
      isRunning: () => false,
      loadManifest: () => ({ categories: { generated: ["../outside"], preserve: [] }, cleanable_categories: ["generated"] }),
      existsAbs: () => true,
      existsRel: () => true,
      rm: () => { rmCalls += 1; },
    });
    assert.notEqual(code, EXIT.OK, "an unsafe manifest entry is refused with a non-zero code");
    assert.equal(rmCalls, 0, "nothing is deleted when the manifest is unsafe");
  } finally {
    cleanup(root);
  }
});

test("status is honest and returns 0 (reports tracked count)", () => {
  const root = tempRoot();
  try {
    const empty = cmdStatus(root, { liveRecords: () => [] });
    assert.equal(empty, EXIT.OK);
    const busy = cmdStatus(root, { liveRecords: () => [{ role: "app-shell", pid: 5 }] });
    assert.equal(busy, EXIT.OK);
  } finally {
    cleanup(root);
  }
});

test("the CLI dispatch returns 1 for an unknown command", () => {
  assert.equal((cli as any).main(["frobnicate"]), 1);
});
