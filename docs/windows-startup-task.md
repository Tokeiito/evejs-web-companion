# Running the BFF as a Windows startup task

Keeps the web companion's BFF running across reboots and terminal sessions, with
its output captured to a rotating log — instead of a `node src/server.js` that
dies when the shell that started it goes away.

Two small launchers in `scripts/`:

- `scripts/start-bff.cmd` — changes to the repo directory, rotates `data\bff.log`
  at startup when it exceeds 5 MB (keeping `bff.log.1` … `bff.log.3`, ~20 MB cap),
  then runs `node --env-file-if-exists=.env src/server.js` with stdout/stderr
  appended to `data\bff.log`. (`data/` is already gitignored.)
- `scripts/start-bff-hidden.vbs` — runs the `.cmd` with a hidden window so no
  console pops up at logon.

> Both scripts assume the repo lives at `C:\evejs-web-companion` and node at
> `C:\Program Files\nodejs\node.exe` — edit the paths in each script to match
> your machine.

## Register the scheduled task

Run once in PowerShell (as the user who will stay logged in; Docker Desktop —
and therefore the EveJS gateway — also only runs while that user is logged in,
so an at-logon trigger matches):

```powershell
$action   = New-ScheduledTaskAction -Execute "wscript.exe" -Argument '"C:\evejs-web-companion\scripts\start-bff-hidden.vbs"'
$trigger  = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName "EvEJS Web Companion BFF" -Action $action -Trigger $trigger -Settings $settings -Description "Starts the EvEJS web companion BFF at logon, hidden, logging to data\bff.log"
```

## Operating it

```powershell
Start-ScheduledTask -TaskName "EvEJS Web Companion BFF"   # start now without relogging
Get-Process node | Stop-Process -Force                     # stop the BFF
Get-Content C:\evejs-web-companion\data\bff.log -Tail 50   # read the log
```

Notes:

- The task itself exits immediately (it only launches node); the BFF keeps
  running detached. Restart = stop node, then `Start-ScheduledTask` again.
- Server-side bots survive a BFF restart via the durable roster
  (`data/server-bots.json`), but each resumed bot's script restarts from its
  first step.
- Log rotation only happens at startup; within a single long run the log can
  exceed 5 MB until the next restart trims it. Output volume is normally tiny.
