@echo off
setlocal EnableExtensions
rem Cowork GHC - build-llm-svc-verbose.bat : Build with detailed output for debugging.

for %%I in ("%~dp0..\..") do set "ROOT=%%~fI"
title Cowork GHC - build-llm-svc (verbose)
set "LLM_SVC_DIR=%ROOT%\app\llm-svc"
set "OUT=%LLM_SVC_DIR%\target\x86_64-pc-windows-msvc\release\llm-svc.exe"

echo ============================================================
echo Cowork GHC - LLM Service Build (Verbose Mode)
echo ============================================================
echo.

echo [STEP 1] Checking prerequisites...
where cargo >nul 2>nul
if errorlevel 1 (
  echo ERROR: cargo not found on PATH.
  exit /b 9
)
echo OK: cargo found
where cl.exe >nul 2>nul
if errorlevel 1 (
  echo WARNING: cl.exe not currently on PATH, will be added by vcvars64.bat
) else (
  echo OK: cl.exe already on PATH
)
echo.

echo [STEP 2] Setting up MSVC environment...
if exist "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" (
    echo Found vcvars64.bat at:
    echo   C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat
    echo.
    call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" x64
) else (
    echo vcvars64.bat not found, using manual PATH setup...
    set "PATH=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64;%PATH%"
)
echo.

echo [STEP 3] Verifying MSVC compiler...
where cl.exe >nul 2>nul
if errorlevel 1 (
    echo ERROR: cl.exe still not available
    exit /b 9
)
echo OK: cl.exe available
cl.exe --version
echo.

echo [STEP 4] Checking Rust configuration...
rustc --version
cargo --version
echo.

echo [STEP 5] Checking for protoc...
where protoc >nul 2>nul
if errorlevel 1 (
    echo WARNING: protoc not on PATH
    echo   protoc may be available from cargo-installed binaries
    echo   or the build may download it automatically
) else (
    echo OK: protoc found
)
echo.

echo [STEP 6] Building llm-svc...
echo   Directory: %LLM_SVC_DIR%
echo   Target:    x86_64-pc-windows-msvc
echo   Output:    %OUT%
echo.

cd /d "%LLM_SVC_DIR%"
if errorlevel 1 (
    echo ERROR: Could not change to %LLM_SVC_DIR%
    exit /b 1
)

echo Running: cargo build --release --bin llm-svc --target x86_64-pc-windows-msvc
echo.

cargo build --release --bin llm-svc --target x86_64-pc-windows-msvc

if errorlevel 1 (
  echo.
  echo ============================================================
  echo BUILD FAILED
  echo ============================================================
  exit /b %ERRORLEVEL%
)

echo.
echo ============================================================
echo BUILD SUCCESSFUL
echo ============================================================
echo.
echo Output: %OUT%
echo.

if exist "%OUT%" (
    echo File size:
    dir "%OUT%"
) else (
    echo WARNING: Output file not found at expected location
)

exit /b 0
