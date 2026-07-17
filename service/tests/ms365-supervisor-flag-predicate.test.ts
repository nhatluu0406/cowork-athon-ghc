/**
 * Final-review fix (Fix 2): the supervisor's MS365 enablement check must use the SAME
 * `isMs365Enabled` predicate (exact "1"/"true" match) as the rest of the codebase, not an
 * ad-hoc `spec.baseEnv?.["CGHC_MS365_ENABLED"] !== undefined` presence check — the old check
 * would treat `CGHC_MS365_ENABLED: "0"` as ON (present, so "enabled"), which is wrong.
 *
 * No real OpenCode binary/socket/PowerShell is touched (fakes from runtime-supervisor-fakes.ts).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpencodeSupervisor, type SupervisorStartSpec } from "../src/runtime/supervisor.js";
import {
  FakeChild,
  recordingSpawner,
  toggleHealthProbe,
  fixedTimesProbe,
  fixedPortChecker,
  fakeResolver,
} from "./runtime-supervisor-fakes.js";

const BIN = "C:\\opencode\\opencode.exe";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "cghc-sup-flag-"));
}

function makeSpec(root: string, port: number, baseEnv: Record<string, string | undefined>): SupervisorStartSpec {
  return {
    binPath: BIN,
    cwd: root,
    port,
    dataHome: join(root, "xdg", "data"),
    configDir: join(root, "config", "opencode"),
    injectionRequests: [],
    baseEnv,
  };
}

async function runStart(root: string, port: number, baseEnv: Record<string, string | undefined>) {
  const child = new FakeChild(4321);
  const { spawner } = recordingSpawner(child);
  const sup = new OpencodeSupervisor({
    root,
    resolveInjections: fakeResolver([]).resolve,
    spawner,
    healthProbe: toggleHealthProbe("v1.17.11").probe,
    processTimesProbe: fixedTimesProbe(),
    portChecker: fixedPortChecker(true),
    pollIntervalMs: 5,
  });
  await sup.start(makeSpec(root, port, baseEnv));
  await sup.stop();
}

test("CGHC_MS365_ENABLED: '0' in baseEnv does NOT write the plugin file (present-but-off is OFF)", async () => {
  const root = tempRoot();
  try {
    await runStart(root, 51970, { CGHC_MS365_ENABLED: "0" });
    assert.ok(
      !existsSync(join(root, "config", "opencode", "plugin", "ms365.ts")),
      "plugin file must NOT be written when the flag value is '0'",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CGHC_MS365_ENABLED: '1' in baseEnv DOES write the plugin file", async () => {
  const root = tempRoot();
  try {
    await runStart(root, 51971, { CGHC_MS365_ENABLED: "1" });
    assert.ok(
      existsSync(join(root, "config", "opencode", "plugin", "ms365.ts")),
      "plugin file must be written when the flag value is '1'",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
