@echo off
setlocal EnableDelayedExpansion
title EvEJS Web Client

rem Day-to-day start. Run SetupWebClient.bat once first -- it records how you
rem chose to run the client, and this reuses that choice.
rem
rem   StartWebClient.bat          start it
rem   StartWebClient.bat stop     stop it
rem   StartWebClient.bat check    just check the connection

for %%I in ("%~dp0.") do set "WEBPOC_REPO_ROOT=%%~fI"
set "WEBPOC_START_PS1=%WEBPOC_REPO_ROOT%\tools\Setup\Start-WebClient.ps1"

if not exist "%WEBPOC_REPO_ROOT%\.env" (
  echo.
  echo   This client has not been set up yet.
  echo   Run SetupWebClient.bat first -- it only takes a moment.
  echo.
  pause
  exit /b 1
)

if not exist "%WEBPOC_START_PS1%" (
  echo.
  echo   [ERROR] Start script not found:
  echo       %WEBPOC_START_PS1%
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%WEBPOC_START_PS1%" %*
set "WEBPOC_START_EXIT=%errorlevel%"

pause
exit /b %WEBPOC_START_EXIT%
