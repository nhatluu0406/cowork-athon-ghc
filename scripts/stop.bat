@echo off
setlocal EnableExtensions
rem Cowork GHC - stop.bat : stop Cowork GHC processes. Double-click safe.
rem Order matters: force-kill by image first so a hung CIM/node identity check cannot
rem leave the UI running. Then prune tracked .runtime pid files via the CLI.
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
title Cowork GHC - stop

where node >nul 2>nul
if errorlevel 1 goto :nonode

echo [Cowork GHC] Stopping...
echo Project root: %ROOT%
echo.

rem Always attempt image-name tree kill first (packaged main + helper children).
rem Identity-gated PID kill alone can hang or refuse when PowerShell/CIM is slow/unavailable.
echo [Cowork GHC] Killing Cowork GHC.exe tree...
taskkill /F /T /IM "Cowork GHC.exe" >nul 2>nul

echo [Cowork GHC] Pruning tracked runtime pid records...
node "%ROOT%\tools\app\cli.mjs" stop --root "%ROOT%"
set "RC=%ERRORLEVEL%"

rem Second pass in case a late helper respawned during prune.
taskkill /F /T /IM "Cowork GHC.exe" >nul 2>nul

echo.
if "%RC%"=="0" (
  echo [Cowork GHC] stop: done
) else (
  echo [Cowork GHC] stop: CLI reported exit code %RC%  - see .runtime\logs\stop.log
  echo [Cowork GHC]        Image-name kill was still attempted; confirm Task Manager is clear.
)
pause
exit /b %RC%

:nonode
echo [Cowork GHC] ERROR: Node.js not found on PATH.
echo Install Node.js LTS from https://nodejs.org and run this again.
rem Still try to kill the packaged app without Node.
taskkill /F /T /IM "Cowork GHC.exe" >nul 2>nul
pause
exit /b 9
