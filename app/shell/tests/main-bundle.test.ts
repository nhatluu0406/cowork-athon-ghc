/**
 * CGHC-028 Wave C (packaging-completeness) — the Electron MAIN is delivered as ONE self-contained
 * CJS bundle that INLINES every `@cowork-ghc/*` workspace module and leaves ONLY `electron` +
 * `@napi-rs/keyring` as runtime externals.
 *
 * This asserts the SHIPPED artifact (built in-memory with esbuild `write: false`), not just the
 * source: a single CJS file, no bare `@cowork-ghc/*` require/import left to resolve at runtime, the
 * native keyring kept as a dynamic `import(...)` external, and `electron` kept as a bare require.
 * A packaged app whose root has no prod deps cannot resolve loose workspace requires, so full
 * inlining is the invariant that keeps the packaged main bootable.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

type BuildMainBundle = (opts: {
  write?: boolean;
  logLevel?: string;
}) => Promise<{ result: { outputFiles?: Array<{ text: string }> } }>;

async function bundleText(): Promise<string> {
  const mod = (await import("../scripts/main-bundle.mjs")) as { buildMainBundle: BuildMainBundle };
  const { result } = await mod.buildMainBundle({ write: false, logLevel: "silent" });
  assert.ok(result.outputFiles, "esbuild returns outputFiles when write:false");
  assert.equal(result.outputFiles.length, 1, "the main MUST bundle to a single file");
  return result.outputFiles[0]!.text;
}

test("main bundles to a single CJS file with electron kept as an external require", async () => {
  const code = await bundleText();
  assert.match(code, /require\("electron"\)/, "electron is an external CJS require");
  assert.doesNotMatch(code, /^\s*import\s/m, "the bundle is CJS, not top-level ESM import");
});

test("every @cowork-ghc/* workspace module is inlined (no bare workspace require left)", async () => {
  const code = await bundleText();
  // No unresolved workspace specifier may survive as a require/import target.
  assert.doesNotMatch(code, /require\("@cowork-ghc\//, "no bare @cowork-ghc require survives");
  assert.doesNotMatch(code, /\bimport\("@cowork-ghc\//, "no bare @cowork-ghc dynamic import survives");
  assert.doesNotMatch(code, /from ["']@cowork-ghc\//, "no bare @cowork-ghc ESM import survives");
});

test("the native keyring stays an external dynamic import (cannot be bundled)", async () => {
  const code = await bundleText();
  assert.match(code, /import\("@napi-rs\/keyring"\)/, "keyring is a runtime dynamic import external");
});

test("import.meta.url is shimmed for CJS so appRoot/renderer paths resolve at runtime", async () => {
  const code = await bundleText();
  // The banner defines a real file-URL const; `import.meta.url` must NOT be left empty under CJS.
  assert.match(code, /pathToFileURL\(__filename\)/, "import.meta.url is shimmed from __filename");
});
