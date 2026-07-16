/**
 * @cowork-ghc/contracts — shared, shell-neutral contract types.
 *
 * The single source of shared types that both `app/ui` and a future web client
 * depend on. This barrel (`.`) is pure TypeScript: no runtime dependencies, no
 * Electron, no Node-only APIs — so any surface (renderer, web) can import it.
 *
 * Note: the separate `@cowork-ghc/contracts/boundary` entry (import-direction lint,
 * see boundary/import-direction.ts) is a Node-only DEV/lint tool — it uses
 * `node:fs`/`node:path` and is NOT meant to be imported by the UI/web bundle. The
 * "no Node-only APIs" guarantee applies to this type barrel only.
 */

export * from "./boundary-envelope.js";
export * from "./ev.js";
export * from "./ev-routes.js";
export * from "./provider.js";
export * from "./permission.js";
export * from "./workspace.js";
export * from "./text-file-types.js";
export * from "./session.js";
export * from "./refs.js";
export * from "./shell-bridge.js";
export * from "./dispatch.js";
