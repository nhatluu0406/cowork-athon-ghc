@echo off
rem Setup MSVC environment for Build Tools 2026
setlocal EnableExtensions

echo Searching for Visual Studio Build Tools 2026...
echo.

rem Check common installation paths for VS 2026
set "VS2026_PATH="

if exist "C:\Program Files\Microsoft Visual Studio\2026\BuildTools" (
    set "VS2026_PATH=C:\Program Files\Microsoft Visual Studio\2026\BuildTools"
    echo Found: %VS2026_PATH%
) else if exist "C:\Program Files (x86)\Microsoft Visual Studio\2026\BuildTools" (
    set "VS2026_PATH=C:\Program Files (x86)\Microsoft Visual Studio\2026\BuildTools"
    echo Found: %VS2026_PATH%
) else (
    echo ERROR: Could not find Visual Studio 2026 Build Tools installation
    echo.
    echo Checked:
    echo   - C:\Program Files\Microsoft Visual Studio\2026\BuildTools
    echo   - C:\Program Files (x86)\Microsoft Visual Studio\2026\BuildTools
    echo.
    echo Please verify your installation path and try again.
    exit /b 1
)

echo.
echo Setting up MSVC environment...
echo.

rem Run vcvars64.bat to set up the environment
set "VCVARS=%VS2026_PATH%\VC\Auxiliary\Build\vcvars64.bat"

if not exist "%VCVARS%" (
    echo ERROR: Could not find vcvars64.bat at:
    echo   %VCVARS%
    exit /b 1
)

echo Running: %VCVARS%
call "%VCVARS%"

if errorlevel 1 (
    echo.
    echo ERROR: Failed to set up MSVC environment
    exit /b %ERRORLEVEL%
)

echo.
echo MSVC environment configured successfully!
echo.
echo Verifying cl.exe is available...
where cl.exe
if errorlevel 1 (
    echo WARNING: cl.exe still not found
    exit /b 1
) else (
    echo SUCCESS: cl.exe is now available
    echo.
    echo You can now run the build script:
    echo   .\scripts\build-llm-svc.bat
)

exit /b 0
