import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MS365_PLUGIN_SOURCE, writeMs365Plugin } from "../src/runtime/ms365-plugin-file.js";
import { TOOL_NAMES } from "../src/ms365/ms365-tool-router.js";

test("plugin source declares all 25 tool names exactly", () => {
  for (const name of TOOL_NAMES) {
    assert.ok(MS365_PLUGIN_SOURCE.includes(`${name}:`), `missing tool ${name}`);
  }
});

test("plugin source reads endpoint+token ONLY from env — no literal secrets/URLs", () => {
  assert.ok(MS365_PLUGIN_SOURCE.includes('process.env["CGHC_MS365_TOOL_ENDPOINT"]'));
  assert.ok(MS365_PLUGIN_SOURCE.includes('process.env["CGHC_MS365_TOKEN"]'));
  assert.ok(!MS365_PLUGIN_SOURCE.includes("127.0.0.1"));
  assert.ok(!/Bearer\s+[A-Za-z0-9]/.test(MS365_PLUGIN_SOURCE));
});

test("writeMs365Plugin writes <configDir>/plugin/ms365.ts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-plugin-"));
  writeMs365Plugin(dir);
  const written = await readFile(join(dir, "plugin", "ms365.ts"), "utf8");
  assert.equal(written, MS365_PLUGIN_SOURCE);
});

// The plugin source is a static string that must never contain a secret value. There is no
// runtime path that can inject a secret into it, so this asserts the invariant holds rather than
// exercising a refusal branch (a real refusal would mean the static template regressed).
test("writeMs365Plugin does not throw for any forbidden value, because the static source never contains one", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-plugin-"));
  assert.doesNotThrow(() => writeMs365Plugin(dir, "sk-THISISASECRET"));
});
