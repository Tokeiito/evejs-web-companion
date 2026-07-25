' Runs start-bff.cmd hidden (no console window). Used by the
' "EvEJS Web Companion BFF" scheduled task (runs at logon).
' Launch + log rotation logic lives in start-bff.cmd.
Dim sh
Set sh = CreateObject("WScript.Shell")
sh.Run "cmd /c ""C:\evejs-web-companion\scripts\start-bff.cmd""", 0, False
