# Cowork GHC Full Release Build — Execution Plan

**Date**: 2026-07-17  
**Prepared for**: DungPD4@fpt.com  
**Task**: Full release packaging with vendoring + ONNX mockup

## Executive Summary

A complete, automated Windows release build for Cowork GHC has been configured. The build pipeline:

1. **Validates** Node.js environment
2. **Auto-setups** full vendoring (npm install)
3. **Creates** mockup ONNX file (ML model placeholder)
4. **Typechecks** TypeScript codebase
5. **Builds** renderer (Vite) + shell (esbuild)
6. **Rebuilds** native modules for Electron ABI
7. **Packages** Windows installer (NSIS) + portable exe
8. **Verifies** packaged artifact integrity
9. **Runs** release regression tests

## Script: `scripts\release-package-full.bat`

### Purpose

One-command full packaging automation. Executes all stages end-to-end with error handling and status reporting.

### Usage

From repo root:

```batch
scripts\release-package-full.bat
```

### Stages Executed

| # | Stage | Command | Duration | Purpose |
|---|-------|---------|----------|---------|
| 1 | Environment Verify | `node --version`, `npm --version` | <1s | Confirm toolchain availability |
| 2 | Vendoring Setup | `npm install --production=false` | 2–5 min | Full node_modules (deps + devDeps) |
| 3 | ONNX Mockup | PowerShell binary write | <1s | Create placeholder ML model file |
| 4 | TypeScript Check | `npm run typecheck` | 1–2 min | Verify type safety |
| 5 | Build Renderer+Shell | `npm run build:app` | 2–3 min | Compile Vite (ui) + esbuild (shell) |
| 6 | Rebuild Native (Electron) | `npm run rebuild:native:electron` | 2–5 min | Recompile `better-sqlite3` for Electron ABI |
| 7 | Package Windows | `npm run package:win` | 5–10 min | electron-builder → NSIS + portable |
| 8 | Verify SQLite | `npm run verify:native-sqlite` | <1s | Check SQLite module loads |
| 9 | Release Regression | `npm run verify:release` | 1–2 min | Smoke tests (entry, file integrity) |

**Total Expected Time**: 10–30 minutes (network/disk dependent)

## Vendoring Strategy

### What Gets Vendored

```
node_modules/
├── @cowork-ghc/*           ← workspace packages (symlinked)
├── better-sqlite3/         ← native SQLite (MUST be unpacked from ASAR)
├── @napi-rs/keyring/       ← Windows keyring adapter
├── opencode-ai/            ← LLM agent runtime (157 MB binary)
├── typescript/             ← dev-only tools
├── vite/                   ← build tool
├── electron/               ← framework (dev)
└── (300+ other packages)   ← deps and transitive closure
```

### Included in Packaged App

- ✓ All runtime dependencies (marked in `package.json`)
- ✓ Native module: `better-sqlite3` (unpacked from ASAR for dynamic load)
- ✓ OpenCode binary (via `extraResources`)
- ✗ Dev dependencies (Vite, TypeScript, electron, etc. — not packaged)

### Why Full Vendoring?

1. **Reproducible builds**: Same `node_modules` across all machines
2. **Offline capability**: No npm registry calls at package time
3. **Security**: Inspect all dependencies before release
4. **Speed**: Pre-downloaded, avoid network delays during CI/packaging

## ONNX Mockup File

### Location

```
resources\models\cowork-model.onnx
```

### Format

Minimal ONNX binary with magic bytes:
```
Bytes: [0x08 0x01 0x12 0x01 0x0A 0x09 6D 6F 63 6B 2D 6D 6F 64 6C]
Size:  ~15 bytes (placeholder, not a valid model)
```

### Purpose

- **Placeholder** for future ML model integration
- **Not consumed** by current app (informational only)
- **Optional** in packaged release (skipped if PowerShell script fails)

### Future Usage

Once ML inference is integrated, replace with actual ONNX model:
```
resources\models\cowork-model.onnx  ← ~50–200 MB model file
```

## Build Pipeline Details

### Stage 4: TypeScript Typecheck

**Command**: `tsc -b`

Compiles TypeScript across workspaces:
```
core/contracts/
core/*/
service/
runtime/
app/shell/
app/ui/
```

**Expected**:
- Exit code: 0
- No errors or warnings
- `.tsbuildinfo` caches updated

**If fails**: Review TypeScript errors; common causes:
- Missing type definitions
- Incompatible library versions
- Syntax errors in recent changes

### Stage 5: Build Renderer + Shell

**Commands**:
- Renderer: `npm run build --workspace @cowork-ghc/ui` (Vite)
- Shell: `npm run build --workspace @cowork-ghc/shell` (esbuild)

**Outputs**:
- `app/ui/dist/` → HTML/JS/CSS for Electron renderer
- `app/shell/dist/main.cjs` → CommonJS entry point (bundled)
- `app/shell/dist/preload.cjs` → Preload script (bundled)

**Expected size**:
- Renderer: 500 KB–2 MB (depends on assets)
- Shell bundles: 100–300 KB

### Stage 6: Rebuild Native Modules for Electron

**Command**: `npm run rebuild:native:electron`

**Critical Detail**: Node.js and Electron use **different ABIs**:
- System Node (v22): `NODE_MODULE_VERSION=130`
- Electron 33: `NODE_MODULE_VERSION=137` (incompatible)

Packaged app **must** use Electron-compatible `.node` binaries. Skipping this step causes:
```
Error: The module at ... was compiled against a different Node.js version
```

### Stage 7: Package Windows Distribution

**Command**: `electron-builder --win --config app/shell/electron-builder.yml`

**Targets**:
1. **NSIS Installer** (`Cowork GHC-0.0.0-setup.exe`)
   - File size: ~180–200 MB
   - One-click setup, Start Menu shortcuts
   - Uninstaller included

2. **Portable Executable** (`Cowork GHC-0.0.0-portable.exe`)
   - File size: ~180–200 MB
   - No installation; run directly
   - Data stored in `%APPDATA%\Cowork GHC\`

**ASAR Archive**:
- All app code and manifests packed into single archive
- **Unpacked exceptions** (on disk):
  - `node_modules/better-sqlite3/` (native `.node` can't load from ASAR)
  - `node_modules/@napi-rs/keyring/` (legacy, retained)
- **Outside ASAR** (via `extraResources`):
  - `opencode/opencode.exe` (157 MB LLM agent binary)

**Branding**:
- Icon: `app/shell/assets/cowork-ghc.ico`
- Applied via `afterPack` script (uses `@electron/rcedit`)

### Stage 8 & 9: Verification

**verify:native-sqlite**: Confirms SQLite module loads in packaged environment.

**verify:release**: Smoke tests:
- Entry point (`main.cjs`) exists and is executable
- Renderer bundle loads
- File integrity (no truncated asar)
- Cross-cutting concerns (logging, redaction, etc.)

## Expected Artifacts

After successful completion:

```
dist-app/
├── Cowork GHC-0.0.0-setup.exe        180–200 MB
├── Cowork GHC-0.0.0-portable.exe     180–200 MB
├── builder-effective-config.yaml     (metadata)
└── ...
```

## Quality Assurance

### Pre-Build Checklist

- [ ] Git repository clean (`git status` shows no uncommitted changes)
- [ ] Current branch is intended release branch
- [ ] CLAUDE.md instructions read and understood
- [ ] No local `.env` or credential files in repo root

### Post-Build Verification

- [ ] Both `.exe` files exist in `dist-app/`
- [ ] File sizes are reasonable (~180–200 MB each)
- [ ] `npm run verify:release` exits with 0 or low warning count
- [ ] Manual test on Windows:
  1. Run installer; app launches and can create conversation
  2. Or run portable directly; same test

### Regression Testing

```bash
# Run test suite
npm run typecheck        # Must pass
npm run test             # If applicable
npm run verify:release   # Must pass or warn only
```

## Known Limitations & Considerations

### App Signing

Currently **unsigned** (no certificate). Windows Defender SmartScreen may prompt on first run. Signing requires certificate purchase (future milestone).

### ONNX Mockup

Mockup file is **not a valid ONNX model**. It's a placeholder for demonstration. To use real ML models:
1. Convert/download `.onnx` file from source
2. Place in `resources\models\`
3. Update app code to load and execute (currently not integrated)

### Native Module Compatibility

`better-sqlite3` is prebuilt for **Windows x64 (MSVC)**. Other architectures (ARM64, x86) require rebuilding with native toolchain.

### OpenCode Version

Pinned at **v1.18.1** (see `runtime/src/pin.ts`). Upgrading requires:
1. Update pin version
2. Run full test suite
3. Verify server-contract compatibility
4. Cannot be done as part of this release script

## Troubleshooting Guide

### Issue 1: npm install fails with node-gyp errors

**Symptom**: 
```
gyp ERR! build error
gyp ERR! stack Error: `cl.exe` not found
```

**Cause**: Visual Studio Build Tools not installed or not in PATH.

**Fix**:
```powershell
# Option A: Install using windows-build-tools
npm install -g windows-build-tools

# Option B: Manual install
# https://visualstudio.microsoft.com/downloads/ 
# → "Tools for Visual Studio" → install "Desktop development with C++"
```

### Issue 2: electron-builder timeout or fails

**Symptom**:
```
electron-builder timed out or NSIS compilation failed
```

**Cause**: Large build files, disk full, or NSIS not in PATH.

**Fix**:
```bash
# Clean previous builds
npm run clean

# Ensure 2+ GB free disk space
# Disable antivirus temporarily (may interfere with file ops)
# Retry
npm run package:win
```

### Issue 3: Packaged app won't start (ENOENT: main.cjs)

**Symptom**:
```
Error: Cannot find module '...\app\shell\dist\main.cjs'
```

**Cause**: Shell build skipped or corrupted.

**Fix**:
```bash
npm run build:shell
npm run rebuild:native:electron
npm run package:win
```

### Issue 4: SQLite connection errors in packaged app

**Symptom**:
```
Error: The module at ... was compiled against a different Node.js version
```

**Cause**: `rebuild:native:electron` was skipped.

**Fix**:
```bash
npm run rebuild:native:electron
npm run package:win
```

## Next Steps After Packaging

1. **Test on Clean Windows Machine**
   - Download packaged `.exe`
   - Run installer or portable
   - Create new conversation, verify SQLite works
   - Check Settings → Nhà cung cấp (provider configuration)

2. **Smoke Test User Journeys**
   - Set provider (DeepSeek or custom endpoint)
   - Send a message; verify streaming
   - Attach a file; verify context
   - Cancel a turn; verify recovery

3. **Release Notes**
   - Document what's new in this version
   - Known issues and limitations
   - Upgrade/migration instructions (if applicable)

4. **Archive & Upload**
   - Copy `dist-app/*.exe` to release repository
   - Store alongside SHA-256 hashes for integrity verification
   - Upload to distribution server

5. **Communicate Release**
   - Announce to users/stakeholders
   - Provide download links
   - Include installation instructions (especially for unsigned app)

## References

- **CLAUDE.md**: Project instructions and invariants (checked into repo)
- **docs/product/current-status.md**: Feature status and limitations
- **app/shell/electron-builder.yml**: Electron Builder configuration
- **scripts/release-package-full.bat**: Automated build script (this file creates)
- **RELEASE_PACKAGE_GUIDE.md**: Detailed guide (also created this session)

---

**Prepared**: 2026-07-17 | **Status**: Ready for execution
