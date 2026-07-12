@echo off
setlocal EnableExtensions
rem Cowork GHC - start.bat : start Cowork GHC and its local services. Double-click safe.
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
title Cowork GHC - start

where node >nul 2>nul
if errorlevel 1 goto :nonode

echo [Cowork GHC] Starting...
echo Project root: %ROOT%
echo.
node "%ROOT%\tools\app\cli.mjs" start --root "%ROOT%"
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (
  echo [Cowork GHC] start: READY
) else if "%RC%"=="3" (
  echo [Cowork GHC] start: NOT INITIALIZED - run init.bat first.
) else (
  echo [Cowork GHC] start: FAILED with exit code %RC%  - see .runtime\logs\start.log
)
pause
exit /b %RC%

:nonode
echo [Cowork GHC] ERROR: Node.js not found on PATH.
echo Install Node.js LTS from https://nodejs.org, then run init.bat, then start.bat.
pause
exit /b 9
