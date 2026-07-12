import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  captureIdentity,
  identityMatches,
  parseIdentityRecord,
} from "../src/process-identity.js";
import { OPENCODE_PIN } from "../src/pin.js";
import { buildLaunchSpec, injectionFor } from "../src/launch-config.js";
import { builtInProviderEnv } from "../src/provider-env.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const STUB = join(HERE, "fixtures", "env-probe-child.mjs");
const SECRET = "sk-ant-do-not-persist-me";

// --- deterministic capture / parse -----------------------------------------

test("captureIdentity produces the frozen identity tuple with the pin as runtimeVersion", () => {
  const start = new Date("2026-07-11T10:00:00.000Z");
  const id = captureIdentity({
    pid: 4242,
    startTime: start,
    exePath: "C:/opencode/opencode.exe",
    port: 51999,
    host: "127.0.0.1",
  });
  assert.deepEqual({ ...id }, {
    pid: 4242,
    startTime: "2026-07-11T10:00:00.000Z",
    exePath: "C:/opencode/opencode.exe",
    port: 51999,
    host: "127.0.0.1",
    runtimeVersion: OPENCODE_PIN,
  });
  assert.ok(Object.isFrozen(id));
});

test("parseIdentityRecord round-trips and rejects malformed records", () => {
  const record = {
    pid: 10,
    startTime: "2026-07-11T10:00:00.000Z",
    exePath: "/x/opencode",
    port: 5000,
    host: "127.0.0.1",
    runtimeVersion: OPENCODE_PIN,
  };
  assert.deepEqual({ ...parseIdentityRecord(record) }, record);
  assert.throws(() => parseIdentityRecord({ ...record, pid: "nope" }));
  assert.throws(() => parseIdentityRecord({ ...record, host: "" }));
  assert.throws(() => parseIdentityRecord(null));
});

test("identityMatches rejects a reused PID (start-time/exePath differ)", () => {
  const captured = captureIdentity({
    pid: 100, startTime: "2026-07-11T10:00:00.000Z", exePath: "/x", port: 5000, host: "h",
  });
  assert.equal(identityMatches(captured, { pid: 100, startTime: "2026-07-11T10:00:00.000Z", exePath: "/x" }), true);
  assert.equal(identityMatches(captured, { pid: 100, startTime: "2026-07-11T11:11:11.000Z", exePath: "/x" }), false);
  assert.equal(identityMatches(captured, { pid: 100, startTime: "2026-07-11T10:00:00.000Z", exePath: "/other" }), false);
});

// --- real stub-child spawn: env injection + data isolation + no auth.json ---

test("spawned child receives injected provider key + isolation env, and no auth.json is written", async () => {
  const run = await mkdtemp(join(tmpdir(), "cghc-runtime-"));
  const dataHome = join(run, "xdg", "data");
  const configDir = join(run, "config", "opencode");
  try {
    const spec = buildLaunchSpec({
      binPath: process.execPath,
      cwd: run,
      port: 51888,
      dataHome,
      configDir,
      providerKeys: [injectionFor(builtInProviderEnv("anthropic"), SECRET)],
    });

    const startedAt = new Date();
    const child = spawn(process.execPath, [STUB], { cwd: spec.cwd, env: spec.env, stdio: ["ignore", "pipe", "pipe"] });

    const identity = captureIdentity({
      pid: child.pid ?? -1,
      startTime: startedAt,
      exePath: spec.command,
      port: spec.port,
      host: spec.host,
    });
    assert.ok(identity.pid > 0, "captured a real pid");
    assert.equal(identity.runtimeVersion, OPENCODE_PIN);

    const stdout = await new Promise<string>((resolve, reject) => {
      let out = "";
      child.stdout.on("data", (chunk) => { out += chunk.toString(); });
      child.stderr.on("data", (chunk) => { out += chunk.toString(); });
      child.once("error", reject);
      child.once("close", () => resolve(out));
    });

    const childEnv = JSON.parse(stdout) as Record<string, string>;
    // Data isolation reached the real child.
    assert.equal(childEnv["XDG_DATA_HOME"], dataHome);
    assert.equal(childEnv["OPENCODE_CONFIG_DIR"], configDir);
    // Provider key injected under the confirmed env var name.
    assert.equal(childEnv["ANTHROPIC_API_KEY"], SECRET);

    // No auth.json / env.json persisted anywhere in the run dirs (SEC-1).
    assert.ok(!existsSync(join(configDir, "auth.json")), "auth.json must not be written");
    assert.ok(!existsSync(join(configDir, "env.json")), "env.json must not be written");
    const dataEntries = existsSync(dataHome) ? await readdir(dataHome) : [];
    assert.ok(!dataEntries.includes("auth.json"), "no auth.json under XDG data");
  } finally {
    await rm(run, { recursive: true, force: true });
  }
});
