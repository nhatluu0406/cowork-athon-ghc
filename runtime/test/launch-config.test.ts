import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildLaunchSpec,
  injectionFor,
  redactedEnvSnapshot,
  NonLoopbackHostError,
} from "../src/launch-config.js";
import { builtInProviderEnv } from "../src/provider-env.js";
import { envMapContainsNoSecret } from "../src/redact.js";

const SECRET = "sk-super-secret-value-123";

function baseSpec() {
  return buildLaunchSpec({
    binPath: "C:/opencode/opencode.exe",
    cwd: "C:/work/my project",
    host: "127.0.0.1",
    port: 51733,
    dataHome: "C:/runtime/run-1/xdg/data",
    configDir: "C:/runtime/run-1/config/opencode",
    providerKeys: [injectionFor(builtInProviderEnv("anthropic"), SECRET)],
    baseEnv: { PATH: "/usr/bin", HOME: "C:/home" },
  });
}

test("args are an array (no shell string) with loopback host + port", () => {
  const spec = baseSpec();
  assert.deepEqual(spec.args, ["serve", "--hostname", "127.0.0.1", "--port", "51733"]);
  assert.equal(spec.command, "C:/opencode/opencode.exe");
  assert.equal(spec.host, "127.0.0.1");
});

test("data isolation env is set (OpenCode has no --data-dir flag)", () => {
  const spec = baseSpec();
  assert.equal(spec.env["XDG_DATA_HOME"], "C:/runtime/run-1/xdg/data");
  assert.equal(spec.env["OPENCODE_CONFIG_DIR"], "C:/runtime/run-1/config/opencode");
  assert.ok(!spec.args.includes("--data-dir"), "opencode has no --data-dir flag");
});

test("provider key is injected under the confirmed env var name", () => {
  const spec = baseSpec();
  assert.equal(spec.env["ANTHROPIC_API_KEY"], SECRET);
});

test("redacted snapshot masks the secret VALUE, not just the name", () => {
  const spec = baseSpec();
  const snapshot = redactedEnvSnapshot(spec);
  assert.equal(snapshot["ANTHROPIC_API_KEY"], "<redacted>");
  assert.ok(envMapContainsNoSecret(snapshot, [SECRET]), "no secret value survives redaction");
  // Non-secret env is preserved.
  assert.equal(snapshot["PATH"], "/usr/bin");
});

test("invalid port and empty binPath are rejected", () => {
  assert.throws(() => buildLaunchSpec({ ...structuredInputs(), port: 0 }));
  assert.throws(() => buildLaunchSpec({ ...structuredInputs(), port: 70000 }));
  assert.throws(() => buildLaunchSpec({ ...structuredInputs(), binPath: "  " }));
});

test("an unsafe provider env var name is rejected", () => {
  assert.throws(() =>
    buildLaunchSpec({ ...structuredInputs(), providerKeys: [{ envVar: "bad name", value: "x" }] }),
  );
});

test("loopback host passes; a non-loopback host is rejected (loopback-only invariant)", () => {
  for (const host of ["127.0.0.1", "::1", "localhost"]) {
    assert.equal(buildLaunchSpec({ ...structuredInputs(), host }).host, host);
  }
  assert.throws(
    () => buildLaunchSpec({ ...structuredInputs(), host: "0.0.0.0" }),
    NonLoopbackHostError,
  );
  assert.throws(
    () => buildLaunchSpec({ ...structuredInputs(), host: "192.168.1.5" }),
    NonLoopbackHostError,
  );
  // Default (omitted host) stays loopback.
  assert.equal(buildLaunchSpec(structuredInputs()).host, "127.0.0.1");
});

test("env-map redaction is whole-value scoped (documents the M3 boundary)", () => {
  // Whole-value match redacts; a substring in a free-form field would NOT be caught —
  // which is why these helpers are env-map only (free-form scrubber = CGHC-021).
  const secret = "sk-abc123";
  const exact = redactedEnvSnapshot(
    buildLaunchSpec({ ...structuredInputs(), providerKeys: [{ envVar: "OPENAI_API_KEY", value: secret }] }),
  );
  assert.equal(exact["OPENAI_API_KEY"], "<redacted>");
  assert.ok(envMapContainsNoSecret(exact, [secret]));
  // A map value that merely CONTAINS the secret as a substring is intentionally NOT
  // matched by this env-map helper (proving it must not be reused on free-form text).
  assert.equal(envMapContainsNoSecret({ CMDLINE: `serve --key ${secret}` }, [secret]), true);
});

function structuredInputs() {
  return {
    binPath: "opencode",
    cwd: "C:/w",
    port: 5000,
    dataHome: "C:/d",
    configDir: "C:/c",
    baseEnv: {} as Record<string, string | undefined>,
  };
}
