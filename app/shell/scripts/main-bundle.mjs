/**
 * Bundle the Electron MAIN process into a SINGLE CommonJS file (CGHC-028 Wave C, packaging-
 * completeness fix).
 *
 * The packaged app is an npm-workspace monorepo whose ROOT `package.json` has no prod deps, so
 * electron-builder's dependency collector inlines NO `node_modules` on its own. Rather than ship
 * every `@cowork-ghc/*` workspace `dist/` (and hope the loose ESM require graph resolves inside the
 * asar), this step uses esbuild (already a workspace dependency) to bundle `src/main.ts` + its ENTIRE
 * import graph — every `@cowork-ghc/*` (service / contracts / runtime) module and every pure-JS
 * dependency — into ONE self-contained CJS module at `dist/main.cjs`, the Electron entry point.
 *
 * The output extension is `.cjs` (NOT `.js`) ON PURPOSE: `app/shell/package.json` declares
 * `"type": "module"`, so a `.js` file there is loaded as ESM and the bundle's CommonJS `require`
 * throws `ReferenceError: require is not defined in ES module scope` at load — the packaged app
 * never boots. The explicit `.cjs` extension marks the bundle as CommonJS regardless of the
 * package `type`, which is exactly what Node recommends for a CJS file under a `module` package.
 *
 * EXTERNAL (left as a bare runtime `require`) ONLY:
 *   - `electron`      — provided by the Electron host, never inlined.
 *   - `@napi-rs/keyring` — a native `.node` addon that CANNOT be bundled; it is shipped unpacked
 *     from the asar (electron-builder `asarUnpack`) and `require`d from disk at runtime.
 *
 * After this runs, `grep "@cowork-ghc" dist/main.cjs` finds NOTHING (all workspace code is inlined)
 * and there are no bare workspace `require`s left to resolve at runtime.
 *
 * Importable so a test can build in-memory (`write: false`) and assert the bundle's shape.
 */

import { build } from "esbuild";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const shellRoot = resolve(here, "..");

/** Modules that MUST stay a runtime `require`: the Electron host + the native keyring addon. */
export const MAIN_EXTERNALS = ["electron", "@napi-rs/keyring"];

/**
 * esbuild resolves bare `./x.js` specifiers to disk as-is, but the TypeScript sources use NodeNext
 * `.js` specifiers that point at `.ts` files (shell src + the `@cowork-ghc/runtime` package, whose
 * `main` is `src/index.ts`). This plugin remaps a relative `./x.js` import to its `./x.ts` sibling
 * when that sibling exists, so the whole workspace graph bundles from source where needed.
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
 * Build the single-file CJS main bundle.
 * @param {{ outfile?: string, write?: boolean, logLevel?: import("esbuild").LogLevel }} [options]
 */
export async function buildMainBundle(options = {}) {
  const outfile = options.outfile ?? resolve(shellRoot, "dist", "main.cjs");
  const result = await build({
    entryPoints: [resolve(shellRoot, "src", "main.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: MAIN_EXTERNALS,
    // The bundled main runs as CJS, where `import.meta.url` is otherwise empty. Shim it to a real
    // file URL derived from the CJS `__filename` so `dirname(fileURLToPath(import.meta.url))`
    // resolves to the emitted main.cjs location (inside `app.asar` when packaged) — the
    // appRoot / renderer-dir / preload-path math depends on it.
    define: { "import.meta.url": "__coworkImportMetaUrl" },
    banner: {
      js: [
        "const __coworkImportMetaUrl = require('node:url').pathToFileURL(__filename).href;",
        "if (process.env.COWORK_GHC_STARTUP_TRACE) {",
        "  try { require('node:fs').appendFileSync(process.env.COWORK_GHC_STARTUP_TRACE, 'main_bundle_loaded\\n'); } catch {}",
        "}",
      ].join("\n"),
    },
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
  buildMainBundle({ logLevel: "info" })
    .then(({ outfile }) => {
      console.log(`main bundled -> ${outfile}`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
