@echo off
setlocal EnableDelayedExpansion
title EvEJS Web Client - Setup

rem One entry point for setting up the browser client. Safe to run again at any
rem time: every step checks what is already done before doing anything.
rem
rem Deliberately a PowerShell script rather than a Node script, matching
rem SetupEveJS.bat in the server repo: someone running everything in Docker does
rem not need Node.js installed, and this has to run before anything is set up.

for %%I in ("%~dp0.") do set "WEBPOC_REPO_ROOT=%%~fI"
set "WEBPOC_SETUP_PS1=%WEBPOC_REPO_ROOT%\tools\Setup\Setup-WebClient.ps1"

if not exist "%WEBPOC_SETUP_PS1%" (
  echo.
  echo   [ERROR] Setup script not found:
  echo       %WEBPOC_SETUP_PS1%
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%WEBPOC_SETUP_PS1%" %*
set "WEBPOC_SETUP_EXIT=%errorlevel%"

if not "%WEBPOC_SETUP_EXIT%"=="0" (
  echo.
  echo   Setup did not finish. Nothing was left half-configured --
  echo   run SetupWebClient.bat again after fixing the problem above.
  echo.
)

pause
exit /b %WEBPOC_SETUP_EXIT%
