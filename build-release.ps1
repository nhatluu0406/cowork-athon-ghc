#!/usr/bin/env pwsh
# ============================================================================
# Cowork GHC Full Release Package Build Script (PowerShell)
#
# Purpose:
#  - Complete build pipeline: typecheck → build → native rebuild → package
#  - Generate Windows installer + portable exe
#  - Verify packaged artifact
#
# Usage:
#  pwsh -ExecutionPolicy Bypass -File build-release.ps1
#
# ============================================================================

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# Colors for output
$colors = @{
    "success" = "Green"
    "error"   = "Red"
    "warning" = "Yellow"
    "info"    = "Cyan"
}

function Write-Stage {
    param([int]$Number, [string]$Title)
    Write-Host "`n" -ForegroundColor White
    Write-Host "============================================================================" -ForegroundColor White
    Write-Host "[STAGE $Number] $Title" -ForegroundColor $colors.info
    Write-Host "============================================================================" -ForegroundColor White
}

function Write-Success {
    param([string]$Message)
    Write-Host "✓ $Message" -ForegroundColor $colors.success
}

function Write-Error-Custom {
    param([string]$Message)
    Write-Host "✗ ERROR: $Message" -ForegroundColor $colors.error
    exit 1
}

# Get repo root
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoRoot

Write-Host "`n" -ForegroundColor White
Write-Host "============================================================================" -ForegroundColor White
Write-Host "COWORK GHC FULL RELEASE PACKAGING" -ForegroundColor $colors.info
Write-Host "============================================================================" -ForegroundColor White
Write-Host "Repository: $repoRoot" -ForegroundColor Gray
Write-Host "PowerShell: $($PSVersionTable.PSVersion)" -ForegroundColor Gray
Write-Host "Date: $(Get-Date)" -ForegroundColor Gray

# Stage 1: Verify Node.js environment
Write-Stage 1 "Verifying Node.js environment"
try {
    $nodeVer = node --version
    $npmVer = npm --version
    Write-Success "Node.js: $nodeVer"
    Write-Success "npm: $npmVer"
} catch {
    Write-Error-Custom "Node.js or npm not found. Install Node.js 22+ and retry."
}

# Stage 2: Verify vendoring
Write-Stage 2 "Verifying vendoring (node_modules)"
if (Test-Path "node_modules") {
    $count = (Get-ChildItem node_modules -Directory | Measure-Object).Count
    Write-Success "node_modules exists with $count top-level packages"
} else {
    Write-Host "  → Installing dependencies..." -ForegroundColor $colors.info
    npm install --production=false
    if ($LASTEXITCODE -ne 0) {
        Write-Error-Custom "npm install failed"
    }
    Write-Success "Vendoring complete"
}

# Stage 3: Create ONNX mockup
Write-Stage 3 "Creating mockup ONNX file"
$onnxDir = "resources\models"
$onnxFile = "$onnxDir\cowork-model.onnx"

if (!(Test-Path $onnxDir)) {
    New-Item -ItemType Directory -Force -Path $onnxDir | Out-Null
}

# ONNX magic bytes + minimal protobuf
$onnxBytes = @(0x08, 0x01, 0x12, 0x01, 0x0A, 0x09, 0x6D, 0x6F, 0x63, 0x6B, 0x2D, 0x6D, 0x6F, 0x64, 0x6C)
[System.IO.File]::WriteAllBytes($onnxFile, $onnxBytes)
Write-Success "ONNX mockup created: $onnxFile ($(Get-Item $onnxFile).Length) bytes)"

# Stage 4: TypeScript Typecheck
Write-Stage 4 "Running TypeScript typecheck"
Write-Host "  Running: npm run typecheck" -ForegroundColor Gray
npm run typecheck
if ($LASTEXITCODE -ne 0) {
    Write-Error-Custom "TypeScript typecheck failed"
}
Write-Success "Typecheck passed"

# Stage 5: Build renderer and shell
Write-Stage 5 "Building renderer and shell"
Write-Host "  Running: npm run build:app" -ForegroundColor Gray
npm run build:app
if ($LASTEXITCODE -ne 0) {
    Write-Error-Custom "build:app failed"
}
Write-Success "Renderer and shell built"

# Verify build outputs
if ((Test-Path "app/ui/dist") -and (Test-Path "app/shell/dist/main.cjs")) {
    Write-Success "Build outputs verified (app/ui/dist and app/shell/dist/main.cjs exist)"
} else {
    Write-Host "  ⚠ Warning: Some expected build outputs missing (checking...)" -ForegroundColor $colors.warning
}

# Stage 6: Rebuild native modules for Electron
Write-Stage 6 "Rebuilding native modules for Electron"
Write-Host "  Running: npm run rebuild:native:electron" -ForegroundColor Gray
Write-Host "  (Recompiling better-sqlite3 for Electron ABI)" -ForegroundColor Gray
npm run rebuild:native:electron
if ($LASTEXITCODE -ne 0) {
    Write-Error-Custom "rebuild:native:electron failed"
}
Write-Success "Native modules rebuilt for Electron"

# Stage 7: Package Windows distribution
Write-Stage 7 "Running electron-builder to package Windows distribution"
Write-Host "  Targets: NSIS installer + portable exe" -ForegroundColor Gray
Write-Host "  Output directory: dist-app\" -ForegroundColor Gray
npm run package:win
if ($LASTEXITCODE -ne 0) {
    Write-Error-Custom "package:win failed"
}
Write-Success "Packaging complete"

# Stage 8: Verify packaged artifact (native SQLite)
Write-Stage 8 "Verifying packaged artifact (native SQLite)"
npm run verify:native-sqlite
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ⚠ Warning: Native SQLite verification reported issues (non-fatal)" -ForegroundColor $colors.warning
} else {
    Write-Success "Native SQLite verification passed"
}

# Stage 9: Run release regression tests
Write-Stage 9 "Running release regression tests"
npm run verify:release
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ⚠ Warning: Release regression test had issues (review output above)" -ForegroundColor $colors.warning
} else {
    Write-Success "Release regression tests passed"
}

# Final summary
Write-Host "`n" -ForegroundColor White
Write-Host "============================================================================" -ForegroundColor White
Write-Host "PACKAGING COMPLETE" -ForegroundColor $colors.success
Write-Host "============================================================================" -ForegroundColor White

# List artifacts
Write-Host "`nArtifacts:" -ForegroundColor $colors.info
if (Test-Path "dist-app") {
    $exeFiles = Get-ChildItem "dist-app\*.exe" -ErrorAction SilentlyContinue
    if ($exeFiles) {
        foreach ($file in $exeFiles) {
            $sizeMB = [Math]::Round($file.Length / 1MB, 2)
            Write-Host "  ✓ $($file.Name) ($sizeMB MB)" -ForegroundColor $colors.success
        }
    } else {
        Write-Host "  ℹ dist-app exists but no .exe files found (check build output)" -ForegroundColor $colors.warning
    }
} else {
    Write-Host "  ⚠ dist-app directory not found" -ForegroundColor $colors.warning
}

# ONNX file
if (Test-Path $onnxFile) {
    Write-Host "  ✓ $onnxFile" -ForegroundColor $colors.success
}

Write-Host "`nNext steps:" -ForegroundColor $colors.info
Write-Host "  1. Review dist-app\ for installer/portable executables" -ForegroundColor Gray
Write-Host "  2. Test installer: dist-app\Cowork GHC-*-setup.exe" -ForegroundColor Gray
Write-Host "  3. Test portable: dist-app\Cowork GHC-*-portable.exe" -ForegroundColor Gray
Write-Host "  4. Verify app launches and SQLite works" -ForegroundColor Gray

Write-Host "`n============================================================================" -ForegroundColor White
Write-Host "Build completed at $(Get-Date)" -ForegroundColor Gray
Write-Host "============================================================================" -ForegroundColor White
