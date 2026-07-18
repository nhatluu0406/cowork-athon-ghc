@echo off
setlocal EnableExtensions
rem Cowork GHC - set-provider-key.bat : store a provider API key in Windows Credential
rem Manager via a HIDDEN local prompt. The key is typed (no echo) at the prompt below and
rem is NEVER passed on the command line, written to a file, or put in an env var.
rem Resolve project root from this script's own location (independent of current dir).
for %%I in ("%~dp0..\..") do set "ROOT=%%~fI"
title Cowork GHC - set provider key

where node >nul 2>nul
if errorlevel 1 goto :nonode

rem Optional first argument is the provider id (default: the custom OpenAI-compatible
rem endpoint). It is a NON-secret provider identifier, never the API key.
set "PROVIDER=%~1"
if "%PROVIDER%"=="" set "PROVIDER=custom"

echo [Cowork GHC] Storing an API key for provider "%PROVIDER%".
echo You will be asked to paste/type the key at a hidden prompt (it will not be shown).
echo.
node --import tsx "%ROOT%\service\src\credential\cli.ts" set "%PROVIDER%"
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (
  echo [Cowork GHC] set-provider-key: OK
) else (
  echo [Cowork GHC] set-provider-key: FAILED with exit code %RC%
)
pause
exit /b %RC%

:nonode
echo [Cowork GHC] ERROR: Node.js not found on PATH.
echo Install Node.js LTS from https://nodejs.org and run this again.
pause
exit /b 9
