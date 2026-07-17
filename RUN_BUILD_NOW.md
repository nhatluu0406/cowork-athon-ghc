# Run Full Release Build Now

## Quick Start

Open **PowerShell** (or PowerShell ISE) **as Administrator** in the repo root directory:

```powershell
pwsh -ExecutionPolicy Bypass -File build-release.ps1
```

Or if you're already in PowerShell:

```powershell
.\build-release.ps1
```

## What Happens

The script runs all 9 stages automatically:

| Stage | Task | Duration |
|-------|------|----------|
| 1 | Environment verify (Node, npm, Python) | <1s |
| 2 | Verify vendoring (node_modules) | <1s |
| 3 | Create ONNX mockup file | <1s |
| 4 | TypeScript typecheck | 1–2 min |
| 5 | Build renderer + shell | 2–3 min |
| 6 | Rebuild native modules for Electron | 2–5 min |
| 7 | Package Windows (installer + portable) | 5–10 min |
| 8 | Verify SQLite | <1s |
| 9 | Release regression tests | 1–2 min |

**Total**: 10–30 minutes (depends on system speed)

## Expected Output

```
dist-app/
├── Cowork GHC-0.0.0-setup.exe        ← NSIS Installer (180–200 MB)
├── Cowork GHC-0.0.0-portable.exe     ← Portable exe (180–200 MB)
└── (metadata files)
```

Both `.exe` files are ready to:
- **Install** (run setup.exe)
- **Run portable** (run portable.exe directly)
- **Distribute** to users

## If Build Fails

### Error: Node not found
```
✗ ERROR: Node.js or npm not found
```
→ Install Node.js 22+ from https://nodejs.org/

### Error: TypeScript check fails
→ Review the error output; fix TypeScript issues in code

### Error: Package:win fails (NSIS)
→ Ensure 2+ GB free disk space; retry build-release.ps1

### Error: Better-sqlite3 native module
→ Install Visual Studio Build Tools (Desktop C++ workload)

## Running Individual Stages (Manual)

If you want to run stages separately:

```powershell
# Stage 4: Typecheck
npm run typecheck

# Stage 5: Build
npm run build:app

# Stage 6: Rebuild native
npm run rebuild:native:electron

# Stage 7: Package
npm run package:win

# Stage 8: Verify
npm run verify:native-sqlite

# Stage 9: Regression
npm run verify:release
```

## Test Packaged App

After build completes:

### Test Installer
```powershell
.\dist-app\Cowork GHC-0.0.0-setup.exe
```
- Click through installer
- App launches → create conversation → check SQLite works

### Test Portable
```powershell
.\dist-app\Cowork GHC-0.0.0-portable.exe
```
- App launches directly (no install)
- State stored in %APPDATA%\Cowork GHC\

---

**Ready to build?** Run:

```powershell
pwsh -ExecutionPolicy Bypass -File build-release.ps1
```
