@echo off
setlocal EnableExtensions
rem Cowork GHC - init.bat : prepare the local environment. Idempotent. Double-click safe.
rem Resolve project root from this script's own location (independent of current dir).
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
title Cowork GHC - init

where node >nul 2>nul
if errorlevel 1 goto :nonode

echo [Cowork GHC] Initializing local environment...
echo Project root: %ROOT%
echo.
node "%ROOT%\tools\app\cli.mjs" init --root "%ROOT%"
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (
  echo [Cowork GHC] init: OK
) else (
  echo [Cowork GHC] init: FAILED with exit code %RC%  - see .runtime\logs\init.log
)
pause
exit /b %RC%

:nonode
echo [Cowork GHC] ERROR: Node.js not found on PATH.
echo Install Node.js LTS from https://nodejs.org and run this again.
pause
exit /b 9
