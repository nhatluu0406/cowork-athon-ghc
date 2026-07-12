/**
 * Secret redaction / no-key-at-rest negative test (CGHC-009 / ADR 0006 AC2, AC4, AC5, AC6).
 *
 * After a full store -> reference -> inject cycle, the raw key value must appear in:
 *   - NO persisted state snapshot,
 *   - NO log output,
 *   - NO written file (and specifically no `auth.json`/`env.json`).
 * Run for a STANDARD provider AND a user-defined CUSTOM provider. The env-map log-scan uses
 * the CGHC-001 value-based helpers (`envMapContainsNoSecret` / `redactedLaunchEnv`).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  builtInProviderEnv,
  customOpenAiCompatibleEnv,
  envMapContainsNoSecret,
  type ProviderEnvSpec,
} from "@cowork-ghc/runtime";
import {
  buildLaunchSpecWithCredentials,
  createCredentialService,
  createMemoryStore,
  createSecretScrubber,
  redactedLaunchEnv,
} from "../src/credential/index.js";

/** Recursively collect every file path under `dir` (empty when the dir does not exist). */
function walkFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

async function runCycle(
  providerId: string,
  spec: ProviderEnvSpec,
  secret: string,
): Promise<void> {
  const runRoot = mkdtempSync(join(tmpdir(), "cghc-cred-"));
  const dataHome = join(runRoot, "data");
  const configDir = join(runRoot, "config");
  mkdirSync(dataHome, { recursive: true });
  mkdirSync(configDir, { recursive: true });

  const logs: string[] = [];
  const service = createCredentialService({
    store: createMemoryStore(),
    log: (line) => logs.push(line),
  });

  try {
    // store -> reference
    const ref = await service.store({ providerId, secret });
    assert.ok(!JSON.stringify(ref).includes(secret));

    // reference -> inject (build a spawn-ready launch spec with the key in ENV only)
    const spawnSpec = await buildLaunchSpecWithCredentials({
      service,
      requests: [{ ref, spec }],
      launch: {
        binPath: join(runRoot, "opencode.exe"),
        cwd: runRoot,
        port: 51999,
        dataHome,
        configDir,
        baseEnv: { PATH: "/usr/bin" },
      },
    });

    // The key IS present in the in-memory child env at the injected var (proves injection).
    assert.equal(spawnSpec.env[spec.primaryEnvVar], secret);

    // AC4/AC6 — log-safe env snapshot (CGHC-001 value-based helper) leaks no key value.
    const redacted = redactedLaunchEnv(spawnSpec);
    assert.equal(redacted[spec.primaryEnvVar], "<redacted>");
    assert.ok(
      envMapContainsNoSecret(redacted, [secret]),
      "redacted env snapshot must contain no secret value",
    );

    // AC5 (a) — NO log line contains the key.
    for (const line of logs) {
      assert.ok(!line.includes(secret), `log line leaked the key: ${line}`);
    }
    assert.ok(logs.some((l) => l.startsWith("credential_stored")), "audit line expected");

    // AC5 (b) — a persisted app-state / frontend snapshot contains no key.
    const persisted = JSON.stringify({
      providerBindings: [{ providerId, ref }],
      // A real persisted view would store the redacted env for diagnostics, never the raw one.
      lastLaunchEnv: redacted,
    });
    assert.ok(!persisted.includes(secret), "persisted state leaked the key");

    // AC2 — NOTHING was written to disk: no auth.json / env.json, no file holds the key.
    assert.ok(!walkFiles(runRoot).some((f) => f.endsWith("auth.json")), "auth.json must not exist");
    assert.ok(!walkFiles(runRoot).some((f) => f.endsWith("env.json")), "env.json must not exist");
    for (const file of walkFiles(runRoot)) {
      const content = readFileSync(file, "utf8");
      assert.ok(!content.includes(secret), `file ${file} leaked the key`);
    }
  } finally {
    rmSync(runRoot, { recursive: true, force: true });
  }
}

test("no key at rest / no key in logs — STANDARD provider (openai)", async () => {
  await runCycle("openai", builtInProviderEnv("openai"), "sk-standard-DO-NOT-LEAK-abc123");
});

test("no key at rest / no key in logs — CUSTOM provider (OpenAI-compatible)", async () => {
  const spec = customOpenAiCompatibleEnv({ providerId: "my-llm", envVar: "MY_LLM_API_KEY" });
  await runCycle("my-llm", spec, "cust-secret-DO-NOT-LEAK-xyz789");
});

test("the scrubber masks a key that would otherwise reach a log line (SEC-2, value-based)", async () => {
  const service = createCredentialService({ store: createMemoryStore() });
  const secret = "sk-value-based-DO-NOT-LEAK-999";
  await service.store({ providerId: "openai", secret });
  // Even a free-form line that embeds the key is scrubbed by VALUE, not env-var name.
  const line = `debug: launching with OPENAI_API_KEY=${secret} in url ?key=${secret}`;
  const scrubbed = service.scrubber.scrub(line);
  assert.ok(!scrubbed.includes(secret));
  assert.ok(scrubbed.includes("[REDACTED]"));
});

test("one SHARED scrubber, registered at injection, covers diagnostics + execution-metadata (AC4)", async () => {
  // The composition root injects a single shared scrubber (CGHC-021). The SAME instance
  // that the credential service registers into is the one the diagnostics bundle /
  // execution-metadata record / error path scrub with — proving AC4 is wired end to end.
  const shared = createSecretScrubber();
  const service = createCredentialService({ store: createMemoryStore(), scrubber: shared });
  const secret = "sk-shared-instance-DO-NOT-LEAK-555";

  const ref = await service.store({ providerId: "openai", secret });
  // Sole register-at-injection: resolving the ref feeds the key to the shared scrubber.
  await service.resolveInjection(ref, builtInProviderEnv("openai"));

  // The exported scrubber IS the injected shared instance.
  assert.equal(service.scrubber, shared);

  // A downstream diagnostics/execution-metadata object graph is scrubbed by the shared
  // instance without any extra registration on the credential side.
  const executionMetadata = {
    env: { OPENAI_API_KEY: secret },
    note: `spawned opencode with key ${secret}`,
    nested: { trace: [`Authorization: Bearer ${secret}`] },
  };
  const deep = shared.scrubDeep(executionMetadata);
  const json = shared.scrubJson(executionMetadata);
  assert.ok(!JSON.stringify(deep).includes(secret));
  assert.ok(!json.includes(secret));
  assert.ok(json.includes("[REDACTED]"));
  assert.equal(shared.containsSecret(`leak? ${secret}`), true);
});
