/**
 * Bundle the sandboxed preload into a SINGLE CommonJS file (CGHC-028 Wave B1, GATE from
 * CGHC-025 packaging review).
 *
 * With `sandbox: true` the preload runs in a restricted context that CANNOT ESM-import a
 * separate module tree at runtime — it must be delivered as ONE file. This step uses esbuild
 * (already a workspace dependency) to bundle `src/preload.ts` + its imports (`ipc/bridge.ts`,
 * `ipc/channels.ts`, and the used `@cowork-ghc/contracts` value) into a single CJS module at
 * `dist/preload.cjs`, which `create-window.ts` points `webPreferences.preload` at. The `.cjs`
 * extension (not `.js`) marks it CommonJS under the shell's `"type": "module"` package, matching
 * the main bundle — a sandboxed preload is loaded as CommonJS and must not be parsed as ESM.
 *
 * `electron` stays EXTERNAL (a bare `require("electron")`): the sandboxed preload host
 * provides `contextBridge` + `ipcRenderer` at runtime; they are never inlined. The bundle
 * exposes exactly the `CoworkShellBridge` surface and leaks no raw `ipcRenderer`.
 *
 * Importable so a test can build the bundle in-memory (`write: false`) and assert its shape.
 */

import { build } from "esbuild";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const shellRoot = resolve(here, "..");

/**
 * esbuild resolves bare `./x.js` specifiers to disk as-is, but the TypeScript source uses
 * NodeNext `.js` specifiers that point at `.ts` files. This plugin remaps a relative
 * `./x.js` import to its `./x.ts` sibling when that sibling exists.
 */
const jsToTsResolver = {
  name: "js-to-ts",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^\.\.?\// }, (args) => {
      if (args.importer === "" || !args.path.endsWith(".js")) return undefined;
      const tsPath = resolve(args.resolveDir, args.path.replace(/\.js$/, ".ts"));
      return existsSync(tsPath) ? { path: tsPath } : undefined;
    });
  },
};

/**
 * Build the single-file CJS preload bundle.
 * @param {{ outfile?: string, write?: boolean, logLevel?: import("esbuild").LogLevel }} [options]
 */
export async function buildPreloadBundle(options = {}) {
  const outfile = options.outfile ?? resolve(shellRoot, "dist", "preload.cjs");
  const result = await build({
    entryPoints: [resolve(shellRoot, "src", "preload.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["electron"],
    sourcemap: false,
    legalComments: "none",
    logLevel: options.logLevel ?? "silent",
    plugins: [jsToTsResolver],
    ...(options.write === false ? { write: false } : {}),
  });
  return { outfile, result };
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  buildPreloadBundle({ logLevel: "info" })
    .then(({ outfile }) => {
      console.log(`preload bundled -> ${outfile}`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
