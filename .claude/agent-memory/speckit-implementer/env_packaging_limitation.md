---
name: env-packaging-limitation
description: npm run package:win fails in this sandbox with an electron-builder asar path-separator sanity check — pre-existing, not a regression
metadata:
  type: project
---

`npm run package:win` (`electron-builder --win --config app/shell/electron-builder.yml`) fails in
this specific sandbox with:

```
Application entry file "app\shell\dist\main.cjs" in "<...>/dist-app/win-unpacked/resources/app.asar"
does not exist. Seems like a wrong configuration.
```

**Why**: electron-builder's post-pack sanity check (`WinPackager.checkFileInPackage`) compares the
root `package.json`'s `main` field (`app\\shell\\dist\\main.cjs`, backslash form — intentional,
see `app/shell/electron-builder.yml`'s own header comment: the Windows asar reader needs it) against
the asar's actually-stored entries. When `electron-builder` runs on a non-Windows host (this sandbox
is plain Debian, not WSL — confirmed via `/proc/version`), the asar is built with `/`-separated
paths and the check's string comparison against the literal `\`-separated `main` field fails, even
though the file genuinely exists in the asar (verified with `npx asar list ... | grep main.cjs`) and
would resolve fine on a real Windows machine. This is a **build-host artifact of cross-compiling a
Windows target from Linux**, not a bug in this repo's config.

**Confirmed pre-existing**: reproduces identically on the unmodified baseline (`git stash` and
rerun) — not caused by any particular change. Confirmed 2026-07-13 while implementing ADR 0010's
stack-init/packaging work (`specs/ADR-0010-BUNDLE/`).

**How to apply**: In this sandbox, the practical verification ceiling for packaging-related changes
is `npm run build:app` (renderer + shell bundle, via esbuild) + validating `electron-builder.yml`
parses as YAML — NOT a full `npm run package:win` pass. Do not treat a `package:win` failure here as
a regression signal unless the *error itself* changes shape from the one above. Prior "`npm run
package:win` PASS" notes in `docs/product/current-status.md` were evidently recorded in a different
(Windows/WSL-backed) session environment — this sandbox cannot reproduce that. See [[m365kg-stack-architecture]].
