@echo off
setlocal EnableExtensions
rem Cowork GHC - clean.bat : delete generated/downloaded data ONLY. Double-click safe.
rem Preserves source, docs, .git, .agent-workflow, .claude, .loop-engineer state/evidence,
rem the reference source, credentials, and your workspace. See scripts\cleanup-manifest.json.
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
title Cowork GHC - clean

where node >nul 2>nul
if errorlevel 1 goto :nonode

set "CONFIRM="
if /i "%~1"=="--yes" set "CONFIRM=--yes"
if defined CONFIRM goto :do_clean

echo [Cowork GHC] clean.bat removes generated/downloaded data only.
echo Preserved: source code, docs, .git, .agent-workflow, .claude,
echo            .loop-engineer state/evidence, reference source, credentials, your workspace.
echo.
echo The following would be deleted:
echo.
node "%ROOT%\tools\app\cli.mjs" clean --root "%ROOT%"
echo.
set /p ANS=Proceed with deletion? [y/N]
if /i "%ANS%"=="y" set "CONFIRM=--yes"
if not defined CONFIRM (
  echo Cancelled. Nothing was deleted.
  pause
  exit /b 0
)

:do_clean
echo.
node "%ROOT%\tools\app\cli.mjs" clean --root "%ROOT%" %CONFIRM%
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (
  echo [Cowork GHC] clean: done
) else (
  echo [Cowork GHC] clean: finished with exit code %RC%  - see .runtime\logs\clean.log
)
pause
exit /b %RC%

:nonode
echo [Cowork GHC] ERROR: Node.js not found on PATH.
echo Install Node.js LTS from https://nodejs.org and run this again.
pause
exit /b 9
