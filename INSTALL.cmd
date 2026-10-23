@echo off
setlocal
set "NODE_OPTIONS="
title GrindZone Setup
cd /d "%~dp0"
echo GrindZone setup is starting...
if not exist "%~dp0runtime\node.exe" goto missing
if not exist "%~dp0SIGNED-RELEASE.json" goto wrongpackage
"%~dp0runtime\node.exe" "%~dp0updates\install.mjs" --open --desktop
if errorlevel 1 goto failed
exit /b 0
:missing
echo The bundled runtime is missing. Extract ALL files from the complete setup ZIP first.
goto failed
:wrongpackage
echo This is not the complete signed setup package. Use GrindZone-Setup-Windows-x64.zip.
:failed
echo.
echo Setup or startup failed. The error is shown above. Do not delete your journal.
pause
exit /b 1
