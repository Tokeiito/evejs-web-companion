"""Resolve git conflict hunks in a file, one choice per hunk.

usage: resolve.py FILE show
       resolve.py FILE CHOICES   (CHOICES: string of o/t/b, one per hunk:
                                  o=ours(HEAD), t=theirs, b=ours then theirs)
Preserves the file's line endings.
"""
import sys

path, mode = sys.argv[1], sys.argv[2]
raw = open(path, "rb").read().decode("utf-8")
# Split on "\n" only: str.splitlines() also breaks on a lone "\r" and other
# separators, which once cut a conflict-marker line in two.
parts = raw.split("\n")
lines = [p + "\n" for p in parts[:-1]] + ([parts[-1]] if parts[-1] else [])

hunks = []
out_parts = []  # list of str or hunk index
i = 0
buf = []
while i < len(lines):
    ln = lines[i]
    if ln.startswith("<<<<<<< "):
        out_parts.append("".join(buf)); buf = []
        ours, theirs = [], []
        i += 1
        while not lines[i].startswith("======="):
            ours.append(lines[i]); i += 1
        i += 1
        while not lines[i].startswith(">>>>>>> "):
            theirs.append(lines[i]); i += 1
        hunks.append(("".join(ours), "".join(theirs)))
        out_parts.append(len(hunks) - 1)
    else:
        buf.append(ln)
    i += 1
out_parts.append("".join(buf))

if mode == "show":
    for n, (o, t) in enumerate(hunks):
        print(f"=== hunk {n} OURS:\n{o}--- THEIRS:\n{t}")
    sys.exit(0)

if len(mode) != len(hunks):
    sys.exit(f"{path}: {len(hunks)} hunks, got {len(mode)} choices")
res = []
for p in out_parts:
    if isinstance(p, str):
        res.append(p)
    else:
        o, t = hunks[p]
        c = mode[p]
        res.append({"o": o, "t": t, "b": o + t}[c])
open(path, "wb").write("".join(res).encode("utf-8"))
print(f"{path}: resolved {len(hunks)} hunks")
