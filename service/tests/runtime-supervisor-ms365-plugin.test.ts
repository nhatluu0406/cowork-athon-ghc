import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpencodeSupervisor } from "../src/runtime/supervisor.js";
import {
  FakeChild,
  recordingSpawner,
  toggleHealthProbe,
  fixedTimesProbe,
  fixedPortChecker,
} from "./runtime-supervisor-fakes.js";
import { OPENCODE_PIN } from "@cowork-ghc/runtime";

test("supervisor writes plugin/ms365.ts into the child configDir on start", async () => {
  const root = mkdtempSync(join(tmpdir(), "cghc-sup-plugin-"));
  const configDir = join(root, "config", "opencode");
  try {
    const { spawner } = recordingSpawner(new FakeChild(4321));
    const sup = new OpencodeSupervisor({
      root,
      resolveInjections: async () => [],
      spawner,
      healthProbe: toggleHealthProbe(OPENCODE_PIN).probe,
      processTimesProbe: fixedTimesProbe(),
      portChecker: fixedPortChecker(true),
      pollIntervalMs: 5,
    });
    await sup.start({
      binPath: "C:\\opencode\\opencode.exe",
      cwd: root,
      port: 51777,
      dataHome: join(root, "xdg", "data"),
      configDir,
      injectionRequests: [],
    });
    await sup.stop();
    assert.ok(existsSync(join(configDir, "plugin", "ms365.ts")), "plugin/ms365.ts must be written");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
