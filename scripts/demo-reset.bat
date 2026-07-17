@echo off
setlocal EnableExtensions
rem Reset demo-safe local state without deleting source code or Windows keyring credentials.
rem Clears: runtime temp, packaged app user profile under %APPDATA%\Cowork GHC (if present).
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
title Cowork GHC - demo-reset

echo [Cowork GHC] demo-reset: stopping tracked processes...
node "%ROOT%\tools\app\cli.mjs" stop --root "%ROOT%"
echo.

echo [Cowork GHC] demo-reset: clearing runtime temp (.runtime/pids, logs, temp, state)...
node "%ROOT%\tools\app\cli.mjs" clean --root "%ROOT%" --yes
echo.

set "PROFILE=%APPDATA%\Cowork GHC"
if exist "%PROFILE%" (
  echo [Cowork GHC] demo-reset: removing packaged profile data at:
  echo   %PROFILE%
  echo Credentials in Windows keyring are NOT removed.
  rmdir /s /q "%PROFILE%" 2>nul
) else (
  echo [Cowork GHC] demo-reset: no packaged profile folder found (skip).
)

echo.
echo [Cowork GHC] demo-reset: DONE — relaunch with scripts\start.bat for a clean demo.
pause
exit /b 0
