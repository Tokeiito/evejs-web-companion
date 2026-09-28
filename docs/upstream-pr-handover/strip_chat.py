"""Remove the chat / hunt pieces upstream no longer has from the editor and
codec files. Idempotent; prints what it changed.

Since PR 14 the generic `text` arg kind (a fleet name) is BACK upstream-side,
so text / text-input / MAX_TEXT_ARG_LEN are no longer stripped.

usage: strip_chat.py FILE...
"""
import re
import sys

EXACT_LINES = [
    '  | "chat-channel-select"',
    '  chatChannel: "chat-channel-select",',
    '  chatChannel: "Channel",',
    '  channel: "Channel",',
    '  message: "Message",',
    '  message: "write the message…",',
    '  only: "Only this pilot",',
    '  "hunt-player": { maxJumps: { min: 1, max: 30 } },',
    '  "players-in-system-above": "Other pilots in system",',
    '  "players-in-system-above": "another pilot comes into this system",',
]

BLOCKS = [
    # codec: the chat-channel argument branch
    ('  if (expected === "chatChannel") {', '    return { kind: "chatChannel", channel: channel as ChatChannelArg };\n  }\n'),
]

for path in sys.argv[1:]:
    s = open(path, encoding="utf-8", newline="").read()
    crlf = s.count("\r\n") > s.count("\n") / 2
    s = s.replace("\r\n", "\n")
    before = s
    lines = s.split("\n")
    out = []
    for ln in lines:
        if ln in EXACT_LINES:
            continue
        if ln.endswith(";") and ln[:-1] in EXACT_LINES and ln.lstrip().startswith("|"):
            # The union's LAST member: drop it and end the union one line up.
            if out and out[-1].lstrip().startswith("|") and not out[-1].endswith(";"):
                out[-1] = out[-1] + ";"
            continue
        out.append(ln)
    s = "\n".join(out)
    for start, end in BLOCKS:
        while start in s:
            a = s.index(start)
            b = s.index(end, a) + len(end)
            s = s[:a] + s[b:]
    s = s.replace('import { BOARD_SLOT_KEY, DEFAULT_HUNT_MAX_JUMPS, DEFAULT_HUNT_RANGE_AU } from "../bots/botScript.ts";',
                  'import { BOARD_SLOT_KEY } from "../bots/botScript.ts";')
    if s != before:
        if crlf:
            s = s.replace("\n", "\r\n")
        open(path, "w", encoding="utf-8", newline="").write(s)
        print("stripped", path)
