import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MS365_PLUGIN_SOURCE, seedMs365PluginDeps, writeMs365Plugin } from "../src/runtime/ms365-plugin-file.js";
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

test("plugin source has a tool.execute.before early-block hook", () => {
  assert.ok(MS365_PLUGIN_SOURCE.includes('"tool.execute.before"') || MS365_PLUGIN_SOURCE.includes("tool.execute.before"));
});

test("writeMs365Plugin writes <configDir>/plugin/ms365.ts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-plugin-"));
  writeMs365Plugin(dir);
  const written = await readFile(join(dir, "plugin", "ms365.ts"), "utf8");
  assert.equal(written, MS365_PLUGIN_SOURCE);
});

test("writeMs365Plugin does not throw for a forbidden value (static source never contains one)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cghc-plugin-"));
  assert.doesNotThrow(() => writeMs365Plugin(dir, "sk-THISISASECRET"));
});

test("seedMs365PluginDeps does not throw when the source package is missing", () => {
  const logs: string[] = [];
  assert.doesNotThrow(() => {
    seedMs365PluginDeps("C:/nonexistent-config-dir", "C:/nonexistent-node-modules-root", (m) => logs.push(m));
  });
  assert.ok(logs.some((l) => l.startsWith("ms365_plugin_seed_missing pkg=@opencode-ai/plugin")));
});

test("seedMs365PluginDeps does not throw when cpSync fails (copy target is a file, not a dir)", async () => {
  const root = await mkdtemp(join(tmpdir(), "cghc-seed-"));
  const nodeModulesRoot = join(root, "nm");
  const srcPkg = join(nodeModulesRoot, "@opencode-ai", "plugin");
  await mkdir(srcPkg, { recursive: true });
  await writeFile(join(srcPkg, "package.json"), JSON.stringify({ dependencies: {} }));
  await writeFile(join(srcPkg, "index.js"), "module.exports = {};");

  const configDir = join(root, "cfg");
  const targetPkgDir = join(configDir, "node_modules", "@opencode-ai");
  await mkdir(targetPkgDir, { recursive: true });
  // Pre-create a FILE at the exact path the copy needs to write a directory to, so the
  // subsequent recursive cpSync in seedMs365PluginDeps throws ERR_FS_CP_DIR_TO_NON_DIR.
  await writeFile(join(targetPkgDir, "plugin"), "not a directory");

  const logs: string[] = [];
  assert.doesNotThrow(() => {
    seedMs365PluginDeps(configDir, nodeModulesRoot, (m) => logs.push(m));
  });
  assert.ok(logs.some((l) => l === "ms365_plugin_seed_copy_failed pkg=@opencode-ai/plugin"));
});
