@echo off
setlocal EnableExtensions
rem Create a demo workspace with representative sample files for Workspace Companion.
for %%I in ("%~dp0..\..") do set "ROOT=%%~fI"
set "DEMO=%ROOT%\demo-workspace"
title Cowork GHC - demo-seed

where node >nul 2>nul
if errorlevel 1 (
  echo [Cowork GHC] ERROR: Node.js not found on PATH.
  exit /b 9
)

echo [Cowork GHC] demo-seed: creating %DEMO%
if not exist "%DEMO%" mkdir "%DEMO%"

node "%ROOT%\tools\demo\seed-binary.mjs" "%DEMO%"
node "%ROOT%\tools\demo\seed-office.mjs" "%DEMO%"

echo.
echo [Cowork GHC] demo-seed: DONE
echo   Workspace folder: %DEMO%
echo   Select this folder in the app workspace picker.
echo.
echo Files created:
echo   welcome.txt, notes.md, sample.png, sample.pdf, brief.docx, budget.xlsx
pause
exit /b 0
