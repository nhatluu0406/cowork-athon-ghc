/**
 * CGHC-028 Wave A1 — the SECURITY test: a planted provider key must reach ONLY the child spawn
 * env, and NEVER the written `opencode.json`, the `.runtime/` record, or any log line. We plant a
 * fake key, run a full start against a fake child, then scan every artifact for the raw value.
 * This guards the ADR 0001 / ADR 0006 SEC-1 invariant (env-only injection, no key on disk).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpencodeSupervisor } from "../src/runtime/supervisor.js";
import type { OpencodeProviderConfig } from "../src/runtime/opencode-config.js";
import {
  FakeChild,
  recordingSpawner,
  toggleHealthProbe,
  fixedTimesProbe,
  fixedPortChecker,
  fakeResolver,
} from "./runtime-supervisor-fakes.js";

const PLANTED = "sk-PLANTED-SECRET-do-not-leak-9f8e7d6c5b4a";
const ENV_VAR = "CUSTOM_API_KEY";

test("secret scan: the planted key is env-only — absent from opencode.json, .runtime, and logs", async () => {
  const root = mkdtempSync(join(tmpdir(), "cghc-sup-sec-"));
  const child = new FakeChild(9182);
  const { spawner, capture } = recordingSpawner(child);
  const logs: string[] = [];

  const providerConfig: OpencodeProviderConfig = {
    providerId: "custom-openai-compat",
    displayName: "Custom",
    envVar: ENV_VAR,
    models: ["some-model"],
    baseUrl: "https://api.example.com/v1",
  };

  const sup = new OpencodeSupervisor({
    root,
    resolveInjections: fakeResolver([{ envVar: ENV_VAR, value: PLANTED }]).resolve,
    spawner,
    healthProbe: toggleHealthProbe("v1.17.11").probe,
    processTimesProbe: fixedTimesProbe(),
    portChecker: fixedPortChecker(true),
    log: (l) => logs.push(l),
    pollIntervalMs: 5,
  });

  try {
    await sup.start({
      binPath: "C:\\opencode\\opencode.exe",
      cwd: root,
      port: 51955,
      dataHome: join(root, "xdg", "data"),
      configDir: join(root, "config", "opencode"),
      injectionRequests: [],
      providerConfig,
    });

    // 1. The key DID reach the child spawn env (env-only injection is real, not dropped).
    assert.equal(capture.env?.[ENV_VAR], PLANTED, "key injected into the child env");

    // 2. opencode.json holds ONLY the {env:NAME} reference, never the value.
    const configText = readFileSync(join(root, "config", "opencode", "opencode.json"), "utf8");
    assert.ok(!configText.includes(PLANTED), "opencode.json must not contain the key value");
    assert.ok(configText.includes(`{env:${ENV_VAR}}`), "opencode.json uses the {env:NAME} template");

    // 3. The .runtime record never carries the key.
    const recordText = readFileSync(join(root, ".runtime", "pids", "agent-runtime.json"), "utf8");
    assert.ok(!recordText.includes(PLANTED), ".runtime record must not contain the key value");

    // 4. No log line leaked the key; the env snapshot is redacted.
    const joined = logs.join("\n");
    assert.ok(!joined.includes(PLANTED), "no log line contains the key value");
    assert.ok(joined.includes("<redacted>"), "the logged env snapshot is redacted");
  } finally {
    await sup.stop();
    rmSync(root, { recursive: true, force: true });
  }
});
