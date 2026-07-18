@echo off
setlocal EnableExtensions
rem Cowork GHC - build.bat : typecheck + package the Windows desktop app. Double-click safe.
rem Resolve project root from this script's own location (independent of current dir).
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
title Cowork GHC - build
set "EXE=%ROOT%\dist-app\win-unpacked\coworkghc.exe"
set "STAGE=Precheck"

where node >nul 2>nul
if errorlevel 1 goto :nonode

where npm >nul 2>nul
if errorlevel 1 goto :nonpm

if not exist "%ROOT%\package.json" goto :nopkg

if not exist "%ROOT%\node_modules\" (
  echo [Cowork GHC] ERROR: dependencies are not installed.
  echo Run scripts\init.bat first, then run scripts\build.bat again.
  pause
  exit /b 2
)

echo [Cowork GHC] Building packaged Windows app...
echo Project root: %ROOT%
echo.

cd /d "%ROOT%"

set "STAGE=stop-running-app"
echo [Cowork GHC] Stage: stop any running packaged app
node "%ROOT%\tools\app\cli.mjs" stop --root "%ROOT%" >nul 2>nul
taskkill /F /T /IM "coworkghc.exe" >nul 2>nul
call :wait_exe_unlocked
if errorlevel 1 goto :locked
echo [Cowork GHC] Stage: packaged app is stopped
echo.

set "STAGE=typecheck"
echo [Cowork GHC] Stage: npm run typecheck
call npm run typecheck
if errorlevel 1 goto :failed

set "STAGE=package:win"
echo.
echo [Cowork GHC] Stage: npm run package:win
call npm run package:win
if errorlevel 1 goto :failed

if not exist "%EXE%" goto :noexe

echo.
echo [Cowork GHC] build: OK
echo Packaged executable:
echo   %EXE%
echo.
echo To run the app, double-click or run:
echo   scripts\start.bat
echo.
pause
exit /b 0

:failed
echo.
echo [Cowork GHC] build: FAILED at stage %STAGE% (exit code %ERRORLEVEL%)
pause
exit /b %ERRORLEVEL%

:locked
echo.
echo [Cowork GHC] build: FAILED - packaged executable is still locked:
echo   %EXE%
echo Close Cowork GHC windows and retry scripts\build.bat.
pause
exit /b 7

:noexe
echo.
echo [Cowork GHC] build: FAILED - packaged executable was not created:
echo   %EXE%
pause
exit /b 6

:nopkg
echo [Cowork GHC] ERROR: package.json not found at:
echo   %ROOT%\package.json
pause
exit /b 6

:nonpm
echo [Cowork GHC] ERROR: npm not found on PATH.
echo Install Node.js LTS from https://nodejs.org and run scripts\init.bat first.
pause
exit /b 2

:nonode
echo [Cowork GHC] ERROR: Node.js not found on PATH.
echo Install Node.js LTS from https://nodejs.org and run scripts\init.bat first.
pause
exit /b 9

:wait_exe_unlocked
if not exist "%EXE%" exit /b 0
for /L %%A in (1,1,20) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = $env:EXE; try { $fs = [System.IO.File]::Open($p, 'Open', 'ReadWrite', 'None'); $fs.Close(); exit 0 } catch { exit 1 }" >nul 2>nul
  if not errorlevel 1 exit /b 0
  timeout /t 1 /nobreak >nul
)
exit /b 1
