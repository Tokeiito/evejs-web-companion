"""Resolve every conflict hunk in FILE by transforming the two sides with a
Python function, given as the body of `def f(ours, theirs, i): ...` in RULE.

usage: resolve_fn.py FILE RULEFILE
RULEFILE defines  def f(ours: str, theirs: str, i: int) -> str
Splits on "\n" only (see resolve.py) and preserves line endings.
"""
import sys

path, rule = sys.argv[1], sys.argv[2]
ns = {}
exec(open(rule, encoding="utf-8").read(), ns)
f = ns["f"]

raw = open(path, "rb").read().decode("utf-8")
crlf = "\r\n" in raw
raw = raw.replace("\r\n", "\n")
parts = raw.split("\n")
lines = [p + "\n" for p in parts[:-1]] + ([parts[-1]] if parts[-1] else [])

out, i, n = [], 0, 0
while i < len(lines):
    if lines[i].startswith("<<<<<<< "):
        ours, theirs = [], []
        i += 1
        while not lines[i].startswith("======="):
            ours.append(lines[i]); i += 1
        i += 1
        while not lines[i].startswith(">>>>>>> "):
            theirs.append(lines[i]); i += 1
        out.append(f("".join(ours), "".join(theirs), n))
        n += 1
    else:
        out.append(lines[i])
    i += 1
s = "".join(out)
if crlf:
    s = s.replace("\n", "\r\n")
open(path, "w", encoding="utf-8", newline="").write(s)
print(f"{path}: {n} hunks")
