@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.12+ is required. Install Node.js with npm, then try again.
  if not "%PROGRESS_CITY_NO_PAUSE%"=="1" pause
  exit /b 2
)
node "%~dp0scripts\launcher\cli.mjs" prepare %*
set "result=%errorlevel%"
if not "%result%"=="0" if not "%PROGRESS_CITY_NO_PAUSE%"=="1" pause
exit /b %result%
