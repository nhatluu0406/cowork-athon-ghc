@echo off
setlocal EnableExtensions
rem Cowork GHC - build-llm-svc.bat : Compile the Rust LLM service (llm-svc.exe).
rem Requires Rust / cargo on PATH. Outputs to app\llm-svc\target\release\llm-svc.exe.
rem Resolve project root from this script's own location.
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
title Cowork GHC - build-llm-svc
set "LLM_SVC_DIR=%ROOT%\app\llm-svc"
set "OUT=%LLM_SVC_DIR%\target\release\llm-svc.exe"

where cargo >nul 2>nul
if errorlevel 1 (
  echo [build-llm-svc] ERROR: cargo not found on PATH.
  echo Install Rust from https://rustup.rs/ and ensure cargo is on PATH.
  exit /b 9
)

echo [build-llm-svc] Building llm-svc (release) ...
echo   Rust source: %LLM_SVC_DIR%
echo   Output:      %OUT%
echo.

rem TDM-GCC workaround: create stub libgcc_eh.a if missing (one-time, idempotent).
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\fix-tdm-gcc-libgcc-eh.ps1"
if errorlevel 1 (
  echo [build-llm-svc] WARN: TDM-GCC libgcc_eh.a workaround failed — build may fail.
  echo   If so, install MSYS2 mingw-w64 or MSVC Build Tools instead of TDM-GCC.
)

rem Ensure protoc is available (required by tonic-build and llama-gguf build scripts).
rem If protoc is already on PATH, use it directly; otherwise download to .tools\protoc\.
where protoc >nul 2>nul
if not errorlevel 1 (
  echo [build-llm-svc] protoc found on PATH.
) else (
  echo [build-llm-svc] protoc not on PATH — ensuring local copy ...
  for /f "usebackq delims=" %%P in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\ensure-protoc.ps1" -Root "%ROOT%"`) do set "PROTOC=%%P"
  if not defined PROTOC (
    echo [build-llm-svc] ERROR: could not obtain protoc. Install protobuf-compiler or check your internet connection.
    exit /b 1
  )
  echo [build-llm-svc] PROTOC=%PROTOC%
)

cd /d "%LLM_SVC_DIR%"
cargo build --release --bin llm-svc
if errorlevel 1 (
  echo [build-llm-svc] FAILED.
  exit /b %ERRORLEVEL%
)

echo [build-llm-svc] OK: %OUT%
exit /b 0
