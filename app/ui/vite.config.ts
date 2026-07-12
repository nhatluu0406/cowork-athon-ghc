import { defineConfig } from "vite";

/**
 * Renderer build config. `base: "./"` produces relative asset URLs so the built
 * `index.html` loads correctly from `file://` inside Electron. Output goes to `dist/`,
 * which the shell loads at `app/ui/dist/index.html`. Workspace TS deps
 * (`@cowork-ghc/contracts`) are transpiled by Vite/esbuild automatically.
 *
 * `sourcemap: false` for the production build (CGHC-028 Wave B2b): the packaged app ships no
 * renderer sourcemaps (no source leak, smaller bundle). The electron-builder `files` glob also
 * excludes map files (glob patterns omitted from this comment to avoid the block-comment
 * terminator sequence) as belt-and-braces.
 */
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
  },
});
