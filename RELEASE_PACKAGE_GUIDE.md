# Cowork GHC Full Release Package Guide

**Date**: 2026-07-17  
**Version**: poc-v0.1  
**Target**: Windows 11 Local Desktop (Electron)

## Overview

This guide covers the complete release packaging workflow for Cowork GHC, including:
- Full vendoring setup (auto node_modules installation)
- Mockup ONNX file creation (ML model placeholder)
- TypeScript typecheck
- Renderer + Shell build
- Native module rebuild for Electron
- Windows installer (NSIS) + portable exe generation
- Packaged artifact verification

## Prerequisites

- **Windows 10+** (recommend Windows 11)
- **Node.js 22+** (`node --version`)
- **npm 10+** (`npm --version`)
- **Python 3.9+** (for native module compilation)
- **Visual Studio Build Tools** (MSVC for C++ native modules)
  - Specifically: `Desktop development with C++` workload installed
- **7-Zip or WinRAR** (optional, for inspecting packaged asar)

### Verify Prerequisites

```powershell
# Check Node.js
node --version   # should be v22.x or later

# Check npm
npm --version    # should be 10.x or later

# Check Python (needed for better-sqlite3)
python --version # should be 3.9+

# Check MSVC
where cl.exe      # C++ compiler; if not found, install Visual Studio Build Tools
```

## Quick Start: Full Release Package

### **One-Command Package**

From the repo root:

```bash
scripts\release-package-full.bat
```

This script **automatically**:
1. ✓ Verifies Node.js environment
2. ✓ Sets up full vendoring (`npm install`)
3. ✓ Creates mockup ONNX file (`resources\models\cowork-model.onnx`)
4. ✓ Runs `npm run typecheck`
5. ✓ Builds renderer + shell (`npm run build:app`)
6. ✓ Rebuilds native modules for Electron (`npm run rebuild:native:electron`)
7. ✓ Packages Windows distribution (`npm run package:win`)
8. ✓ Verifies native SQLite
9. ✓ Runs release regression tests

**Expected runtime**: ~10–20 minutes (depends on network and disk)

### **Output Artifacts**

After successful completion, packaged files are in `dist-app/`:

```
dist-app/
├── Cowork GHC-0.0.0-setup.exe        ← NSIS Installer
├── Cowork GHC-0.0.0-portable.exe     ← Portable (no install needed)
└── (other build metadata files)
```

## Step-by-Step Manual Build (for troubleshooting)

If you prefer granular control, run each stage separately:

### Stage 1: Verify Environment

```bash
node --version
npm --version
```

### Stage 2: Vendoring (Full node_modules)

```bash
npm install --production=false
```

If this fails:
- Clear cache: `npm cache clean --force`
- Delete node_modules: `rmdir /s node_modules` (Windows)
- Retry: `npm install`

### Stage 3: Create Mockup ONNX File (Optional)

```bash
# Create directory
mkdir resources\models

# Create ONNX placeholder (PowerShell)
$bytes = @(0x08, 0x01, 0x12, 0x01, 0x0A, 0x09, 0x6D, 0x6F, 0x63, 0x6B, 0x2D, 0x6D, 0x6F, 0x64, 0x6C)
[System.IO.File]::WriteAllBytes('resources\models\cowork-model.onnx', $bytes)
```

### Stage 4: TypeScript Typecheck

```bash
npm run typecheck
```

Expected: `tsc -b` exits with code 0.

### Stage 5: Build Renderer + Shell

```bash
npm run build:app
```

Expected outputs:
- `app/ui/dist/` (Vite renderer bundle)
- `app/shell/dist/main.cjs` + `app/shell/dist/preload.cjs` (esbuild bundles)

### Stage 6: Rebuild Native Modules for Electron

```bash
npm run rebuild:native:electron
```

This rebuilds `better-sqlite3` against Electron's Node ABI (not your system Node.js).

**Important**: Skip this, and the packaged app will fail with SQLite errors.

### Stage 7: Package Windows Distribution

```bash
npm run package:win
```

This runs `electron-builder --win --config app/shell/electron-builder.yml`.

- Targets: NSIS installer + portable exe
- Output: `dist-app/`
- Duration: 5–10 minutes

### Stage 8: Verify Packaged Artifact

```bash
npm run verify:native-sqlite
```

Checks that the packaged SQLite native addon loads correctly.

### Stage 9: Run Release Regression Tests

```bash
npm run verify:release
```

Runs release-specific smoke tests (file integrity, entry point, etc.).

## Configuration

### Electron Builder Config

See: `app/shell/electron-builder.yml`

Key settings:
- **App ID**: `com.coworkghc.desktop`
- **Product Name**: `Cowork GHC`
- **Output**: `dist-app/`
- **ASAR**: Enabled (unpacked: `better-sqlite3`, keyring native addons)
- **Extra Resources**: OpenCode binary, built-in skills, branding

### Environment Variables (Optional)

```bash
# Enable loopback http for dev (local LLM gateway)
set COWORK_GHC_DEV_ALLOW_LOOPBACK_HTTP=1

# Enable MS365 connector
set CGHC_MS365_ENABLED=1

# Enable remote gateway (PWA + phone pairing)
set CGHC_REMOTE_ENABLED=1

# Custom remote port (default: 8081)
set CGHC_REMOTE_PORT=8081

# Custom remote LAN bind (default: 127.0.0.1)
set CGHC_REMOTE_LAN=1
```

## Troubleshooting

### Issue: "npm install" fails with node-gyp errors

**Cause**: Missing Visual Studio Build Tools or Python.

**Solution**:
```bash
# Install globally (one-time)
npm install -g windows-build-tools

# Or install Visual Studio Build Tools manually
# https://visualstudio.microsoft.com/downloads/ → "Tools for Visual Studio"
```

### Issue: "better-sqlite3" native module fails during package

**Cause**: Missing `npm run rebuild:native:electron` step.

**Solution**:
```bash
npm run rebuild:native:electron
npm run package:win
```

### Issue: electron-builder timeout or disk space

**Cause**: Large artifacts or slow disk.

**Solution**:
```bash
# Clean previous builds
npm run clean

# Ensure ~2 GB free disk space
# Retry packaging
npm run package:win
```

### Issue: "NSIS installer creation failed"

**Cause**: Invalid paths or corrupted asar.

**Solution**:
```bash
# Clean and rebuild
npm run clean
npm run build:app
npm run rebuild:native:electron
npm run package:win
```

## Testing the Packaged App

### Install from NSIS Installer

```bash
# Run installer
dist-app\Cowork GHC-0.0.0-setup.exe
```

Installer prompts:
1. Installation directory (default: `%ProgramFiles%\Cowork GHC`)
2. Start menu folder
3. Installation type

After installation, app is available in Start Menu and desktop shortcut.

### Run Portable Executable

```bash
# No installation needed
dist-app\Cowork GHC-0.0.0-portable.exe
```

App launches directly; all state stored in `%APPDATA%\Cowork GHC\` (Windows Credential Manager + SQLite).

## Verification Checklist

After packaging:

- [ ] No TypeScript errors (`npm run typecheck` passes)
- [ ] Build outputs exist (`app/ui/dist/`, `app/shell/dist/main.cjs`)
- [ ] Native modules rebuilt for Electron
- [ ] `dist-app/` contains `.exe` files
- [ ] Installer file size ~180–200 MB (includes OpenCode binary)
- [ ] Portable exe file size ~180–200 MB
- [ ] `npm run verify:release` completes (warnings are okay, errors are not)
- [ ] Manual test: launch packaged app, create conversation, verify SQLite persistence

## Git & Branches

### Current Branch

```bash
git status
git branch -v
git log -1 --oneline
```

### Release Branch Naming

Use semantic versioning:
```
release/v0.1.0     ← stable release
hotfix/v0.1.1      ← patch fix
```

### Before Commit

```bash
npm run typecheck   # Must pass
npm run test        # If applicable
scripts\verify-fast.bat  # Pre-commit checks
```

**Do not commit**:
- `.env` files
- API keys or tokens
- `dist-app/` (packaged artifacts)
- `node_modules/` (excluded via `.gitignore`)
- Build outputs (`app/*/dist/`, `.tsbuildinfo`)

## Architecture Notes

### Vendoring Strategy

- **Full vendoring**: `npm install --production=false` includes dev dependencies
- **Reasoning**: Reproducible builds; no external registry required at package time
- **Node modules**: Hoisted at repo root; workspaces reference via `node_modules` symlinks

### ONNX Mockup File

- **Purpose**: Placeholder for future ML model loading (not yet consumed)
- **Location**: `resources\models\cowork-model.onnx`
- **Format**: Minimal ONNX binary (magic bytes only; not a valid model)
- **Optional**: Can be skipped; not required for app to run

### Native Module (better-sqlite3)

- **Purpose**: Local SQLite database for vault, settings, conversations, MCP config
- **Reason for rebuild**: Node.js ABI ≠ Electron ABI
  - System Node.js: `NODE_MODULE_VERSION=130` (v22.x)
  - Electron 33: `NODE_MODULE_VERSION=137`
- **Unpacked from ASAR**: `.node` binary cannot load from inside ASAR archive

### ASAR Archive

- **Enabled**: All app code, manifests, and native modules are packed
- **Unpacked exceptions**:
  - `better-sqlite3/` (native `.node` addon)
  - `@napi-rs/keyring/` (Windows keyring adapter, deprecated but retained)
  - OpenCode binary (shipped via `extraResources` outside ASAR)

## Security & Signing

### Code Signing (Not Available)

- **Current**: Unsigned (no certificate)
- **electron-builder**: Skips signing cleanly when `forceCodeSigning: false`
- **User experience**: Windows Defender SmartScreen may prompt on first run

### Future (Post-Release)

- Acquire code-signing certificate (Sectigo, DigiCert)
- Enable `signAndEditExecutable: true` in `electron-builder.yml`

## Release Checklist

Before shipping:

- [ ] `git status --short` is clean
- [ ] All tests pass (`npm run typecheck`, `npm run test`)
- [ ] Release notes written (CHANGELOG.md or docs/releases/)
- [ ] Packaged artifact verified (installer + portable work)
- [ ] Manual smoke test on clean Windows machine
- [ ] Version bumped in `package.json` (if applicable)
- [ ] Git tag created (`git tag v0.1.0`)
- [ ] Artifacts uploaded to release repository

## References

- **Electron Builder**: https://www.electron.build/
- **NSIS**: https://nsis.sourceforge.io/
- **better-sqlite3**: https://github.com/WiseLibs/better-sqlite3
- **ONNX Format**: https://onnx.ai/
- **Windows Code Signing**: https://docs.microsoft.com/windows/desktop/seccrypto/

---

**Last updated**: 2026-07-17  
**Next review**: After release milestone
