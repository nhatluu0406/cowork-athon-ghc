@echo off
setlocal EnableExtensions
rem Cowork GHC - start.bat : start the packaged desktop app. Double-click safe.
rem Requires scripts\build.bat output at dist-app\win-unpacked\Cowork GHC.exe.
rem Does not auto-build and does not fall back to the dev Electron entry.
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
title Cowork GHC - start
set "EXE=%ROOT%\dist-app\win-unpacked\Cowork GHC.exe"

where node >nul 2>nul
if errorlevel 1 goto :nonode

if not exist "%EXE%" goto :nobuild

echo [Cowork GHC] Starting packaged app...
echo Project root: %ROOT%
echo Executable: %EXE%
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

:nobuild
echo [Cowork GHC] ERROR: packaged app not built.
echo Expected executable:
echo   %EXE%
echo.
echo Run scripts\build.bat first, then run scripts\start.bat again.
pause
exit /b 3

:nonode
echo [Cowork GHC] ERROR: Node.js not found on PATH.
echo Install Node.js LTS from https://nodejs.org, then run init.bat and build.bat.
pause
exit /b 9
