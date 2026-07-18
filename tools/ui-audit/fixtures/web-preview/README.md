# Web Preview audit fixture

A tiny, deterministic, **zero-dependency** Node web project used ONLY by the packaged UI audit
(`npm run audit:ui`) and the focused runtime-preview tests to exercise the Code **Web Preview**
live-run against a real project — real target detection, real permission gate, a real spawned
process, real loopback HTTP, real captured output, and a real parsed problem.

This is **test tooling, not a product feature.** It is never bundled into the packaged app
(electron-builder packages `dist-app/`, not `tools/`). No lockfile and no `node_modules` — the
scripts run only Node built-ins, so they work offline with no install.

## Scripts (detected as dev-server targets)

- `dev` → `node server.mjs` — binds the runner-injected loopback `PORT`, serves a page carrying the
  marker `COWORK-GHC-PREVIEW-FIXTURE-LIVE`, and prints a Vite-style `Local:` URL so the runner
  reaches `running`. Terminating the process closes the port.
- `serve` → `node build-fail.mjs` — the **deliberate error mode**: prints one `tsc`-style diagnostic
  (`src/app.tsx(12,7): error TS2322: …`) to stderr and exits non-zero, so the runner reports `failed`
  and the "Vấn đề" (Problems) tab shows one real parsed problem.

The audit copies this folder into an **isolated throwaway workspace** under `.runtime/ui-audit/…`;
it never runs from the repo working tree and never mutates user data.
