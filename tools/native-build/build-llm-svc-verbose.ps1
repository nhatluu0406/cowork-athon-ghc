# Cowork GHC - build-llm-svc-verbose.ps1 : Build with detailed output for debugging.

param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Continue"

$LLM_SVC_DIR = Join-Path $Root "app\llm-svc"
$OUT = Join-Path $LLM_SVC_DIR "target\x86_64-pc-windows-msvc\release\llm-svc.exe"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Cowork GHC - LLM Service Build (Verbose Mode)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# STEP 1: Check prerequisites
Write-Host "[STEP 1] Checking prerequisites..." -ForegroundColor Green
try {
    $cargo = Get-Command cargo -ErrorAction Stop
    Write-Host "OK: cargo found at $($cargo.Source)" -ForegroundColor Green
} catch {
    Write-Host "ERROR: cargo not found on PATH." -ForegroundColor Red
    Write-Host "Install Rust from https://rustup.rs/" -ForegroundColor Yellow
    exit 1
}

try {
    $cl = Get-Command cl.exe -ErrorAction Stop
    Write-Host "OK: cl.exe already on PATH at $($cl.Source)" -ForegroundColor Green
} catch {
    Write-Host "WARNING: cl.exe not currently on PATH, will be added by vcvars64.bat" -ForegroundColor Yellow
}
Write-Host ""

# STEP 2: Setup MSVC environment
Write-Host "[STEP 2] Setting up MSVC environment..." -ForegroundColor Green

$vcvarsPath = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
$useVcvars = $false

if (Test-Path $vcvarsPath) {
    Write-Host "Found vcvars64.bat at:" -ForegroundColor Cyan
    Write-Host "  $vcvarsPath" -ForegroundColor Cyan
    Write-Host ""

    Write-Host "Executing vcvars64.bat..." -ForegroundColor Yellow
    cmd.exe /c "`"$vcvarsPath`" x64 && set" | ForEach-Object {
        if ($_ -match "^([^=]+)=(.*)$") {
            [Environment]::SetEnvironmentVariable($matches[1], $matches[2])
        }
    }
    $useVcvars = $true
    Write-Host ""
} else {
    Write-Host "vcvars64.bat not found, using manual PATH setup..." -ForegroundColor Yellow
    $msvcPath = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64"
    $env:PATH = "$msvcPath;$env:PATH"
    Write-Host "Added to PATH: $msvcPath" -ForegroundColor Cyan
}
Write-Host ""

# STEP 3: Verify MSVC compiler
Write-Host "[STEP 3] Verifying MSVC compiler..." -ForegroundColor Green
try {
    $cl = Get-Command cl.exe -ErrorAction Stop
    Write-Host "OK: cl.exe available at $($cl.Source)" -ForegroundColor Green

    $version = & cl.exe 2>&1 | Select-Object -First 1
    Write-Host "Version: $version" -ForegroundColor Cyan
} catch {
    Write-Host "ERROR: cl.exe still not available" -ForegroundColor Red
    exit 1
}
Write-Host ""

# STEP 4: Check Rust configuration
Write-Host "[STEP 4] Checking Rust configuration..." -ForegroundColor Green
try {
    $rustVersion = & rustc --version
    Write-Host $rustVersion -ForegroundColor Cyan

    $cargoVersion = & cargo --version
    Write-Host $cargoVersion -ForegroundColor Cyan
} catch {
    Write-Host "ERROR: Could not get Rust version information" -ForegroundColor Red
}
Write-Host ""

# STEP 5: Check for protoc
Write-Host "[STEP 5] Checking for protoc..." -ForegroundColor Green
try {
    $protoc = Get-Command protoc -ErrorAction Stop
    Write-Host "OK: protoc found at $($protoc.Source)" -ForegroundColor Green
} catch {
    Write-Host "WARNING: protoc not on PATH" -ForegroundColor Yellow
    Write-Host "  protoc may be available from cargo-installed binaries" -ForegroundColor Yellow
    Write-Host "  or the build may download it automatically" -ForegroundColor Yellow
}
Write-Host ""

# STEP 6: Build llm-svc
Write-Host "[STEP 6] Building llm-svc..." -ForegroundColor Green
Write-Host "  Directory: $LLM_SVC_DIR" -ForegroundColor Cyan
Write-Host "  Target:    x86_64-pc-windows-msvc" -ForegroundColor Cyan
Write-Host "  Output:    $OUT" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $LLM_SVC_DIR)) {
    Write-Host "ERROR: Could not find directory $LLM_SVC_DIR" -ForegroundColor Red
    exit 1
}

Push-Location $LLM_SVC_DIR

Write-Host "Running: cargo build --release --bin llm-svc --target x86_64-pc-windows-msvc" -ForegroundColor Yellow
Write-Host ""

& cargo build --release --bin llm-svc --target x86_64-pc-windows-msvc

$buildExitCode = $LASTEXITCODE

Pop-Location

Write-Host ""
if ($buildExitCode -eq 0) {
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host "BUILD SUCCESSFUL" -ForegroundColor Green
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Output: $OUT" -ForegroundColor Cyan
    Write-Host ""

    if (Test-Path $OUT) {
        $fileInfo = Get-Item $OUT
        Write-Host "File size: $($fileInfo.Length) bytes" -ForegroundColor Cyan
        Write-Host "Created: $($fileInfo.CreationTime)" -ForegroundColor Cyan
    } else {
        Write-Host "WARNING: Output file not found at expected location" -ForegroundColor Yellow
    }
} else {
    Write-Host "============================================================" -ForegroundColor Red
    Write-Host "BUILD FAILED (exit code: $buildExitCode)" -ForegroundColor Red
    Write-Host "============================================================" -ForegroundColor Red
}

exit $buildExitCode
