# BFF file logging with rotation (Windows)

Running the BFF detached (hidden window, background process, etc.) normally
means its stdout/stderr are lost — a silent death leaves no evidence.
`scripts\start-bff.cmd` runs the BFF with its output captured to a log file
that can't grow forever:

- appends stdout/stderr to `data\bff.log` (`data/` is already gitignored);
- at startup, if `bff.log` exceeds 5 MB, rotates it to `bff.log.1` …
  `bff.log.3` (oldest dropped), capping total footprint around 20 MB;
- writes a timestamped `===== BFF starting =====` marker on every launch, so
  restarts are visible in the log.

> The script assumes the repo lives at `C:\evejs-web-companion` and node at
> `C:\Program Files\nodejs\node.exe` — edit the paths in the script to match
> your machine.

Use it anywhere you'd otherwise run `npm start`: a shortcut, a scheduled
task, or by hand:

```powershell
cmd /c C:\evejs-web-companion\scripts\start-bff.cmd      # runs in foreground
Get-Content C:\evejs-web-companion\data\bff.log -Tail 50 # read the log
```

Notes:

- Rotation only happens at startup; within a single long run the log can pass
  5 MB until the next restart trims it. Normal output volume is tiny (startup
  lines, warnings, errors).
- Server-side bots survive a BFF restart via the durable roster
  (`data/server-bots.json`), but each resumed bot's script restarts from its
  first step.
