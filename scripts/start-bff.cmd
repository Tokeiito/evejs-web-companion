@echo off
rem Starts the EvEJS web companion BFF, logging to data\bff.log.
rem Rotates the log at startup when it exceeds 5 MB (keeps bff.log.1..3).
rem See docs/bff-log-rotation.md. Edit the paths below to match your machine.
cd /d C:\evejs-web-companion

set size=0
if exist data\bff.log for %%A in (data\bff.log) do set size=%%~zA
if %size% GTR 5242880 (
  if exist data\bff.log.3 del data\bff.log.3
  if exist data\bff.log.2 ren data\bff.log.2 bff.log.3
  if exist data\bff.log.1 ren data\bff.log.1 bff.log.2
  ren data\bff.log bff.log.1
)

echo. >> data\bff.log
echo ===== [%date% %time%] BFF starting ===== >> data\bff.log
"C:\Program Files\nodejs\node.exe" --env-file-if-exists=.env src/server.js >> data\bff.log 2>&1
