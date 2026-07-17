@echo off
setlocal EnableExtensions
rem Cowork GHC - build-llm-svc-simple.bat : Simple build without external dependencies.

for %%I in ("%~dp0..") do set "ROOT=%%~fI"
title Cowork GHC - build-llm-svc (simple)
set "LLM_SVC_DIR=%ROOT%\app\llm-svc"
set "OUT=%LLM_SVC_DIR%\target\x86_64-pc-windows-msvc\release\llm-svc.exe"

echo [build-llm-svc-simple] Checking prerequisites...
echo.

where cargo >nul 2>nul
if errorlevel 1 (
  echo [build-llm-svc-simple] ERROR: cargo not found on PATH.
  echo Install Rust from https://rustup.rs/
  exit /b 9
)

echo [build-llm-svc-simple] Setting up MSVC environment...

rem Try vcvars64.bat first (most reliable method)
if exist "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" (
    echo Calling vcvars64.bat...
    call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" x64
    goto :build
)

if exist "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" (
    echo Calling vcvars64.bat...
    call "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" x64
    goto :build
)

echo vcvars64.bat not found, using manual PATH setup...
set "PATH=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64;%PATH%"

:build
where cl.exe >nul 2>nul
if errorlevel 1 (
    echo ERROR: cl.exe not available
    exit /b 9
)

echo.
echo [build-llm-svc-simple] Building llm-svc (release) ...
echo   Rust source: %LLM_SVC_DIR%
echo   Output:      %OUT%
echo.

cd /d "%LLM_SVC_DIR%"
cargo build --release --bin llm-svc --target x86_64-pc-windows-msvc

if errorlevel 1 (
  echo.
  echo [build-llm-svc-simple] FAILED.
  exit /b %ERRORLEVEL%
)

echo.
echo [build-llm-svc-simple] SUCCESS: %OUT%
exit /b 0
