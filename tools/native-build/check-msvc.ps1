# Check for Visual Studio Build Tools and MSVC compiler
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

Write-Host "Checking for Visual Studio Build Tools and MSVC compiler..." -ForegroundColor Cyan
Write-Host ""

# Paths to check
$vsInstallations = @(
    "C:\Program Files\Microsoft Visual Studio\2022\BuildTools",
    "C:\Program Files\Microsoft Visual Studio\2022\Community",
    "C:\Program Files\Microsoft Visual Studio\2022\Professional",
    "C:\Program Files\Microsoft Visual Studio\2022\Enterprise",
    "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools",
    "C:\Program Files (x86)\Microsoft Visual Studio\2019\Community"
)

$found = $false

foreach ($vsPath in $vsInstallations) {
    if (Test-Path $vsPath) {
        $edition = Split-Path -Leaf $vsPath
        $year = if ($vsPath -like "*2022*") { "2022" } else { "2019" }
        Write-Host "✓ Found: Visual Studio $year - $edition" -ForegroundColor Green
        Write-Host "  Path: $vsPath"

        # Check for MSVC toolset
        $msvcPath = Join-Path $vsPath "VC\Tools\MSVC"
        if (Test-Path $msvcPath) {
            $versions = Get-Item "$msvcPath\*" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name
            if ($versions) {
                Write-Host "  MSVC Versions: $($versions -join ', ')"
            }
        }

        $found = $true
        Write-Host ""
    }
}

if (-not $found) {
    Write-Host "✗ No Visual Studio Build Tools found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install Visual Studio Build Tools:"
    Write-Host "  1. Download from: https://visualstudio.microsoft.com/downloads/"
    Write-Host "  2. Select 'Build Tools for Visual Studio 2022'"
    Write-Host "  3. Install with 'Desktop development with C++' workload"
    Write-Host ""
}

# Check for cl.exe on PATH
Write-Host "Checking for cl.exe on PATH..." -ForegroundColor Cyan
$clPath = where.exe cl.exe 2>$null
if ($clPath) {
    Write-Host "✓ cl.exe found on PATH" -ForegroundColor Green
    Write-Host "  Path: $clPath"
} else {
    Write-Host "✗ cl.exe NOT found on PATH" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Solution: Run the vcvars64.bat file to set up the environment:"

    foreach ($vsPath in $vsInstallations) {
        if (Test-Path $vsPath) {
            $vcvarsPath = Join-Path $vsPath "VC\Auxiliary\Build\vcvars64.bat"
            if (Test-Path $vcvarsPath) {
                Write-Host ""
                Write-Host "  $vcvarsPath"
                Write-Host ""
                Write-Host "  Command:"
                Write-Host "    cmd.exe /k `"$vcvarsPath`""
            }
        }
    }
}

Write-Host ""
Write-Host "Checking Rust toolchain..." -ForegroundColor Cyan
$rustVersion = rustc --version 2>$null
$cargoVersion = cargo --version 2>$null
if ($rustVersion) {
    Write-Host "✓ Rust: $rustVersion" -ForegroundColor Green
}
if ($cargoVersion) {
    Write-Host "✓ Cargo: $cargoVersion" -ForegroundColor Green
}

# Check for MSVC target in Rust
$targets = rustup target list 2>$null | Select-String "x86_64-pc-windows-msvc"
if ($targets) {
    if ($targets -like "*installed*") {
        Write-Host "✓ MSVC target installed in Rust" -ForegroundColor Green
    } else {
        Write-Host "✗ MSVC target NOT installed in Rust" -ForegroundColor Yellow
        Write-Host "  Run: rustup target add x86_64-pc-windows-msvc"
    }
}
