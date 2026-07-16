@echo off
rem Setup environment for Visual Studio 2022 Build Tools
setlocal EnableExtensions

echo Setting up Visual Studio 2022 Build Tools environment...
echo.

rem Set the PATH to include cl.exe and other MSVC tools
set "MSVC_PATH=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64"
set "VS_PATH=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools"

echo Adding to PATH: %MSVC_PATH%
set "PATH=%MSVC_PATH%;%PATH%"

rem Also set other required environment variables
set "VCINSTALLDIR=%VS_PATH%\VC"
set "VCToolsVersion=14.44.35207"
set "WindowsSDKVersion="

echo VCINSTALLDIR=%VCINSTALLDIR%
echo VCToolsVersion=%VCToolsVersion%
echo.

echo Verifying cl.exe is available...
where cl.exe
if errorlevel 1 (
    echo ERROR: cl.exe not found
    exit /b 1
) else (
    echo SUCCESS: cl.exe found
    cl.exe --version
    exit /b 0
)
