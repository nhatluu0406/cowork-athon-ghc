@echo off
setlocal EnableExtensions
rem Cowork GHC - clean.bat : delete generated/downloaded data ONLY. Double-click safe.
rem Preserves source, docs, .git, .claude, .agents, credentials, and user workspace.
rem See scripts\cleanup-manifest.json.
rem Automated test mode: clean.bat --yes
for %%I in ("%~dp0..\..") do set "ROOT=%%~fI"
title Cowork GHC - clean

where node >nul 2>nul
if errorlevel 1 goto nonode

if /i "%~1"=="--yes" goto run_clean

echo [Cowork GHC] clean.bat removes generated/downloaded data only.
echo Preserved: source code, docs, .git, .claude, .agents, tools, scripts,
echo            credentials, your workspace, packaged app under dist-app.
echo.
echo The following would be deleted:
echo.
node "%ROOT%\tools\app\cli.mjs" clean --root "%ROOT%"
echo.
set /p ANS=Proceed with deletion? [y/N]
if /i not "%ANS%"=="y" (
  echo Cancelled. Nothing was deleted.
  pause
  exit /b 0
)

:run_clean
echo.
node "%ROOT%\tools\app\cli.mjs" clean --root "%ROOT%" --yes
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
