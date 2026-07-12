@echo off
setlocal EnableExtensions
rem Cowork GHC - stop.bat : stop only Cowork GHC processes gracefully. Double-click safe.
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
title Cowork GHC - stop

where node >nul 2>nul
if errorlevel 1 goto :nonode

echo [Cowork GHC] Stopping...
echo Project root: %ROOT%
echo.
node "%ROOT%\tools\app\cli.mjs" stop --root "%ROOT%"
set "RC=%ERRORLEVEL%"
taskkill /F /T /IM "Cowork GHC.exe" >nul 2>nul
echo.
if "%RC%"=="0" (
  echo [Cowork GHC] stop: done
) else (
  echo [Cowork GHC] stop: some processes could not be stopped, exit code %RC%  - see .runtime\logs\stop.log
)
pause
exit /b %RC%

:nonode
echo [Cowork GHC] ERROR: Node.js not found on PATH.
echo Install Node.js LTS from https://nodejs.org and run this again.
pause
exit /b 9
