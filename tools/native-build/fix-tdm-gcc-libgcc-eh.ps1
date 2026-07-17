# fix-tdm-gcc-libgcc-eh.ps1
# TDM-GCC 10.x does not ship libgcc_eh.a (exception-handling is folded into
# libgcc.a using SJLJ). Rust's x86_64-pc-windows-gnu stdlib links -lgcc_eh,
# so the build fails with "cannot find -lgcc_eh".
#
# Fix: compile a minimal stub and archive it as libgcc_eh.a next to libgcc.a.
# This is a one-time operation; the file persists across builds.
#
# Called by scripts\build-llm-svc.bat before cargo build.

$ErrorActionPreference = "Stop"

$gcc = Get-Command "x86_64-w64-mingw32-gcc" -ErrorAction SilentlyContinue
if (-not $gcc) {
    # Not using x86_64-pc-windows-gnu toolchain — nothing to do.
    exit 0
}

# -print-libgcc-file-name returns the full path to libgcc.a for this target.
$libgccPath = & $gcc.Source "-print-libgcc-file-name" 2>$null
if (-not $libgccPath -or -not (Test-Path $libgccPath)) {
    Write-Warning "[fix-tdm-gcc] Could not locate libgcc.a; skipping workaround."
    exit 0
}

$libDir = Split-Path $libgccPath -Parent
$ehLib  = Join-Path $libDir "libgcc_eh.a"

if (Test-Path $ehLib) {
    Write-Host "[fix-tdm-gcc] libgcc_eh.a already present: $ehLib"
    exit 0
}

Write-Host "[fix-tdm-gcc] TDM-GCC detected — libgcc_eh.a missing."
Write-Host "[fix-tdm-gcc] Creating stub at: $ehLib"

$tmpC = Join-Path $env:TEMP "gcc_eh_stub.c"
$tmpO = Join-Path $env:TEMP "gcc_eh_stub.o"

# Minimal stub that satisfies the linker reference without redefining anything.
[IO.File]::WriteAllText($tmpC, "/* TDM-GCC libgcc_eh stub — empty placeholder */`n")

try {
    & $gcc.Source "-c" $tmpC "-o" $tmpO 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "gcc -c failed with exit $LASTEXITCODE"
    }

    # TDM-GCC uses plain ar.exe in its bin dir; mingw-w64 uses x86_64-w64-mingw32-ar.exe.
    # Try both, then fall back to ar on PATH.
    $gccBin = Split-Path $gcc.Source -Parent
    $arCandidates = @(
        (Join-Path $gccBin "ar.exe"),
        ($gcc.Source -replace "gcc\.exe$", "ar.exe"),
        (Get-Command "ar" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source)
    )
    $arPath = $arCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if (-not $arPath) {
        throw "ar not found — tried: $($arCandidates -join ', ')"
    }

    & $arPath "rcs" $ehLib $tmpO
    if ($LASTEXITCODE -ne 0) {
        throw "ar rcs failed with exit $LASTEXITCODE"
    }

    Write-Host "[fix-tdm-gcc] OK: stub libgcc_eh.a created."
} finally {
    Remove-Item $tmpC, $tmpO -Force -ErrorAction SilentlyContinue
}
