@echo off
setlocal EnableExtensions
rem Cowork GHC - build-llm-svc-auto.bat : Compile Rust LLM service with automatic MSVC setup.
rem This script automatically configures the MSVC environment before building.
rem Requires: Rust/cargo on PATH, Visual Studio Build Tools 2026 installed.

for %%I in ("%~dp0..") do set "ROOT=%%~fI"
title Cowork GHC - build-llm-svc (auto setup)
set "LLM_SVC_DIR=%ROOT%\app\llm-svc"
set "OUT=%LLM_SVC_DIR%\target\x86_64-pc-windows-msvc\release\llm-svc.exe"

echo [build-llm-svc-auto] Checking prerequisites...
echo.

where cargo >nul 2>nul
if errorlevel 1 (
  echo [build-llm-svc-auto] ERROR: cargo not found on PATH.
  echo Install Rust from https://rustup.rs/ and ensure cargo is on PATH.
  exit /b 9
)

echo [build-llm-svc-auto] Setting up MSVC environment...
echo.

rem Attempt to find and run vcvars64.bat
set "VCVARS_FOUND=0"

if exist "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" (
    call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
    set "VCVARS_FOUND=1"
) else if exist "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" (
    call "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
    set "VCVARS_FOUND=1"
) else if exist "C:\Program Files\Microsoft Visual Studio\2026\BuildTools\VC\Auxiliary\Build\vcvars64.bat" (
    call "C:\Program Files\Microsoft Visual Studio\2026\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
    set "VCVARS_FOUND=1"
) else if exist "C:\Program Files (x86)\Microsoft Visual Studio\2026\BuildTools\VC\Auxiliary\Build\vcvars64.bat" (
    call "C:\Program Files (x86)\Microsoft Visual Studio\2026\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
    set "VCVARS_FOUND=1"
) else if exist "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Auxiliary\Build\vcvars64.bat" (
    call "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
    set "VCVARS_FOUND=1"
)

if "%VCVARS_FOUND%"=="0" (
    echo [build-llm-svc-auto] ERROR: Could not find vcvars64.bat
    echo.
    echo Checked locations:
    echo   - C:\Program Files\Microsoft Visual Studio\2026\BuildTools
    echo   - C:\Program Files (x86)\Microsoft Visual Studio\2026\BuildTools
    echo   - C:\Program Files\Microsoft Visual Studio\2022\BuildTools
    echo   - C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools
    echo.
    echo Please install Visual Studio Build Tools 2026 or run setup-msvc-env.bat manually.
    exit /b 9
)

echo [build-llm-svc-auto] MSVC environment configured.
echo.

where cl.exe >nul 2>nul
if errorlevel 1 (
    echo [build-llm-svc-auto] ERROR: cl.exe still not available after environment setup
    echo Attempting to set PATH manually...
    echo.

    rem Manual PATH setup for known MSVC location
    set "PATH=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64;%PATH%"

    where cl.exe >nul 2>nul
    if errorlevel 1 (
        echo [build-llm-svc-auto] FAILED: cl.exe still not available
        exit /b 9
    )
    echo [build-llm-svc-auto] cl.exe found in manual PATH
)

echo Checking for protoc...
where protoc >nul 2>nul
if errorlevel 1 (
    echo WARNING: protoc not found on PATH. Attempting to install it...
    echo.

    rem Try to install protoc via cargo
    cargo install protoc --locked 2>nul
    if errorlevel 1 (
        echo NOTE: protoc installation may have failed, but build might still work if it's cached.
    )
)

echo.
echo [build-llm-svc-auto] Building llm-svc (release) ...
echo   Rust source: %LLM_SVC_DIR%
echo   Output:      %OUT%
echo.

cd /d "%LLM_SVC_DIR%"
cargo build --release --bin llm-svc --target x86_64-pc-windows-msvc
if errorlevel 1 (
  echo [build-llm-svc-auto] FAILED.
  exit /b %ERRORLEVEL%
)

echo [build-llm-svc-auto] OK: %OUT%
exit /b 0
