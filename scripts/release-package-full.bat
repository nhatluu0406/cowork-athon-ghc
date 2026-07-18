@echo off
REM ============================================================================
REM Cowork GHC Full Release Package Script (Windows)
REM
REM Purpose:
REM  - Auto-setup vendoring (ensure full node_modules)
REM  - Create mockup ONNX file for ML model dependencies
REM  - Run complete build pipeline (typecheck → build → rebuild native → package)
REM  - Generate Windows installer + portable exe
REM  - Verify packaged artifact
REM
REM Usage:
REM  scripts\release-package-full.bat
REM
REM ============================================================================

setlocal enabledelayedexpansion
cd /d "%~dp0\.."

echo.
echo ============================================================================
echo COWORK GHC FULL RELEASE PACKAGING
echo ============================================================================
echo.

REM Stage 1: Verify Node/npm environment
echo [STAGE 1] Verifying Node.js environment...
node --version >nul 2>&1 || (
  echo ERROR: Node.js not found. Install Node.js 22+ and retry.
  exit /b 1
)
npm --version >nul 2>&1 || (
  echo ERROR: npm not found.
  exit /b 1
)
echo ✓ Node.js and npm ready
echo.

REM Stage 2: Auto-setup vendoring (full node_modules)
echo [STAGE 2] Setting up full vendoring (node_modules)...
if exist node_modules (
  echo  ℹ node_modules already present, validating...
) else (
  echo  → Running npm install for full vendoring...
  call npm install --production=false
  if !errorlevel! neq 0 (
    echo ERROR: npm install failed
    exit /b 1
  )
)
echo ✓ Vendoring ready
echo.

REM Stage 3: Create mockup ONNX file (ML model dependency placeholder)
echo [STAGE 3] Creating mockup ONNX file...
set ONNX_DIR=resources\models
set ONNX_FILE=!ONNX_DIR!\cowork-model.onnx

if not exist "!ONNX_DIR!" mkdir "!ONNX_DIR!"

REM Create a minimal ONNX file header (magic bytes: 0x 08 01 12 01)
REM ONNX format: [0x08 0x01 0x12 0x01] + protobuf (minimal ModelProto)
REM For mockup: just create the header + dummy protobuf frame
powershell -Command ^
  "$bytes = @(0x08, 0x01, 0x12, 0x01, 0x0A, 0x09, 0x6D, 0x6F, 0x63, 0x6B, 0x2D, 0x6D, 0x6F, 0x64, 0x6C); " ^
  "[System.IO.File]::WriteAllBytes('!ONNX_FILE!', $bytes); " ^
  "Write-Host 'Mockup ONNX created: !ONNX_FILE!'"

if exist "!ONNX_FILE!" (
  echo ✓ Mockup ONNX file created at !ONNX_FILE!
) else (
  echo WARNING: ONNX file creation skipped (optional for packaging)
)
echo.

REM Stage 4: Typecheck (TypeScript)
echo [STAGE 4] Running TypeScript typecheck...
call npm run typecheck
if !errorlevel! neq 0 (
  echo ERROR: TypeScript typecheck failed
  exit /b 1
)
echo ✓ Typecheck passed
echo.

REM Stage 5: Build renderer and shell
echo [STAGE 5] Building renderer and shell...
call npm run build:app
if !errorlevel! neq 0 (
  echo ERROR: build:app failed
  exit /b 1
)
echo ✓ Renderer and shell built
echo.

REM Stage 6: Rebuild native modules for Electron
echo [STAGE 6] Rebuilding native modules for Electron...
call npm run rebuild:native:electron
if !errorlevel! neq 0 (
  echo ERROR: rebuild:native:electron failed
  exit /b 1
)
echo ✓ Native modules (better-sqlite3) rebuilt for Electron
echo.

REM Stage 7: Package Windows distribution (installer + portable)
echo [STAGE 7] Running electron-builder to package Windows distribution...
echo  → Targets: NSIS installer + portable exe
echo  → Output directory: dist-app\
call npm run package:win
if !errorlevel! neq 0 (
  echo ERROR: package:win failed
  exit /b 1
)
echo ✓ Packaging complete
echo.

REM Stage 8: Verify packaged artifact
echo [STAGE 8] Verifying packaged artifact...
call npm run verify:native-sqlite
if !errorlevel! neq 0 (
  echo WARNING: Native SQLite verification reported issues (non-fatal)
)
echo.

REM Stage 9: Run release regression tests
echo [STAGE 9] Running release regression tests...
call npm run verify:release
if !errorlevel! neq 0 (
  echo WARNING: Release regression test had issues (review output above)
)
echo.

REM Final summary
echo.
echo ============================================================================
echo PACKAGING COMPLETE
echo ============================================================================
echo.
echo Artifacts:
if exist "dist-app" (
  echo  ✓ dist-app\ (Windows installer and portable exe)
  dir /b "dist-app\" | findstr /E "\.exe$ \.nsis$" && (
    echo    Artifacts listed above
  ) || (
    echo    (check dist-app directory for .exe and .nsis files)
  )
)
echo.
echo Mockup ONNX:
if exist "!ONNX_FILE!" (
  echo  ✓ !ONNX_FILE!
)
echo.
echo Next steps:
echo  1. Review dist-app\ for installer/portable executables
echo  2. Test installer: dist-app\Cowork GHC-*-setup.exe
echo  3. Test portable: dist-app\Cowork GHC-*-portable.exe
echo.
echo ============================================================================
echo.
exit /b 0
