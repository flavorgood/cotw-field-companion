@echo off
setlocal
cd /d "%~dp0"
if exist "%~dp0runtime\node.exe" (
  "%~dp0runtime\node.exe" "%~dp0launcher.mjs" --open
  pause
  exit /b
)
where node.exe >nul 2>nul
if errorlevel 1 (
  echo This GrindZone folder does not include its runtime.
  echo Use the complete Windows download and extract the whole folder before opening START.cmd.
  pause
  exit /b 1
)
node launcher.mjs --open
pause
