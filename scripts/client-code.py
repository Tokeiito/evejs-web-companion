"""Take one module's compiled code out of the retail client, to run it in the client's own Python.

The decompiled client source is usually right and sometimes wrong: a block can
come out at the wrong depth, and then the code reads differently from what it
does. When what a function does matters and its source looks odd, run the real
thing. This writes one module's code object, as the client compiled it, to a
file; a snippet for scripts/py27-oracle.py can then load it and call a function
from it with stand-ins for whatever the function reaches for.

    python scripts/client-code.py <client tq folder>/code.ccp <module path ending> <out file>

    python scripts/client-code.py "D:/EVE/tq/code.ccp" ui/station/agents/agentUtil.pyj scratch/agentUtil.marshal

The client's code archive is a zip of .pyj entries, each a zlib-compressed
Python 2.7 .pyc. The out file is the .pyc without its 8-byte header: what
marshal.loads reads. Write it OUTSIDE this repository: it is the client's code.

In the snippet (Python 2.7, builtin modules only):

    import marshal
    module = marshal.loads(open('<out file>', 'rb').read())
    code = [c for c in module.co_consts if getattr(c, 'co_name', None) == 'TheFunction'][0]
    function = type(lambda: 0)(code, {'appConst': stand_in, 'GetByLabel': stand_in, ...})
    print(function(arguments))

The names the function needs are in code.co_names. First used on 2026-10-08 for
agentUtil.GetMissionExpirationAndStateText (web/src/bridge/journalWords.ts).
"""

import sys
import zipfile
import zlib


def main():
    if len(sys.argv) != 4:
        print(__doc__)
        return 2
    archive, ending, out = sys.argv[1], sys.argv[2], sys.argv[3]
    with zipfile.ZipFile(archive) as code:
        names = [name for name in code.namelist() if name.replace("\\", "/").endswith(ending)]
        if len(names) != 1:
            print("expected one entry ending %s, found %d: %r" % (ending, len(names), names[:5]))
            return 1
        compiled = zlib.decompress(code.read(names[0]))
    with open(out, "wb") as handle:
        handle.write(compiled[8:])
    print("%s: %d bytes of marshalled code (magic %s)" % (names[0], len(compiled) - 8, compiled[:4].hex()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
