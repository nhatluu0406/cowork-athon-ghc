/**
 * CGHC-028 Wave B1 — the sandboxed preload is delivered as ONE valid CJS bundle that
 * exposes EXACTLY the narrow bridge and leaks no raw ipc (the CGHC-025 packaging gate).
 *
 * The bundle is built in-memory (esbuild `write: false`) from the real config, then executed
 * in a fake CommonJS context with a fake `electron` module — so we assert the SHIPPED artifact
 * (not just the source): single file, CJS (`require("electron")`, no ESM `import`), and an
 * `exposeInMainWorld` call carrying exactly `getBootstrap` + workspace pickers + `connectLive` + `setWindowTheme`
 * with no `ipcRenderer`/generic passthrough.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { COWORK_SHELL_BRIDGE_KEY } from "@cowork-ghc/contracts";

type BuildPreloadBundle = (opts: {
  write?: boolean;
  logLevel?: string;
}) => Promise<{ result: { outputFiles?: Array<{ text: string }> } }>;

async function loadBuilder(): Promise<BuildPreloadBundle> {
  const mod = (await import("../scripts/preload-bundle.mjs")) as {
    buildPreloadBundle: BuildPreloadBundle;
  };
  return mod.buildPreloadBundle;
}

async function bundleText(): Promise<string> {
  const buildPreloadBundle = await loadBuilder();
  const { result } = await buildPreloadBundle({ write: false, logLevel: "silent" });
  assert.ok(result.outputFiles, "esbuild returns outputFiles when write:false");
  assert.equal(result.outputFiles.length, 1, "the preload MUST bundle to a single file");
  return result.outputFiles[0]!.text;
}

/** Execute the CJS bundle with a fake `electron`, capturing the exposeInMainWorld call. */
function runBundle(code: string): Array<{ key: string; api: Record<string, unknown> }> {
  const calls: Array<{ key: string; api: Record<string, unknown> }> = [];
  const fakeElectron = {
    contextBridge: {
      exposeInMainWorld: (key: string, api: Record<string, unknown>) => calls.push({ key, api }),
    },
    ipcRenderer: { invoke: async () => undefined },
  };
  const fakeRequire = (id: string): unknown => {
    if (id === "electron") return fakeElectron;
    throw new Error(`bundle must not require anything but electron; saw "${id}"`);
  };
  const module = { exports: {} as Record<string, unknown> };
  // eslint-disable-next-line no-new-func
  const fn = new Function("module", "exports", "require", code);
  fn(module, module.exports, fakeRequire);
  return calls;
}

test("the preload bundles to a single valid CJS file (electron external, no ESM import)", async () => {
  const code = await bundleText();
  assert.match(code, /require\("electron"\)/, "electron is an external CJS require");
  assert.doesNotMatch(code, /^\s*import\s/m, "the bundle is CJS, not ESM");
});

test("running the bundle exposes EXACTLY the narrow bridge under the contract key", async () => {
  const calls = runBundle(await bundleText());

  assert.equal(calls.length, 1, "exposeInMainWorld is called exactly once");
  const [call] = calls;
  assert.ok(call);
  assert.equal(call.key, COWORK_SHELL_BRIDGE_KEY);
  assert.deepEqual(Object.keys(call.api).sort(), ["connectLive", "getBootstrap", "pickWorkspaceFile", "pickWorkspaceFolder", "setWindowTheme"]);
});

test("the bundled bridge leaks no raw ipcRenderer or generic passthrough", async () => {
  const calls = runBundle(await bundleText());
  const api = calls[0]!.api;

  for (const forbidden of ["ipcRenderer", "invoke", "send", "sendSync", "on", "postMessage"]) {
    assert.equal(forbidden in api, false, `bundle bridge must not expose "${forbidden}"`);
  }
  for (const value of Object.values(api)) {
    assert.equal(typeof value, "function", "every exposed member is a capability function");
  }
});
