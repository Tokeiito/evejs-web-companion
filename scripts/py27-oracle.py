"""Ask the retail client's own Python 2.7 a question.

The EVE client is Python 2.7 (Stackless, 64-bit Windows). Some of what it puts on
the wire is decided by that interpreter rather than by any script we can read:
the order a dict iterates in, what hash() returns, how a float prints. This runs
a snippet inside the client's own python27.dll and prints what it wrote, so those
answers come from the real thing.

    python scripts/py27-oracle.py <client bin64 folder> <snippet.py>

The snippet is Python 2.7 source. It gets one name, `out`, a function that takes
a string; whatever it passes to `out` is printed here, one line per call.

Only builtin modules are available (marshal, binascii, sys, ...): the client's
standard library lives inside its own archive and is not loaded. Run it with a
64-bit Python 3 on Windows. It loads a second Python into this process, which is
fine for a short snippet and nothing more.
"""

import ctypes
import os
import sys
import tempfile


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    dll_dir, snippet_path = sys.argv[1], sys.argv[2]
    with open(snippet_path, "r", encoding="latin1") as handle:
        snippet = handle.read()

    os.add_dll_directory(dll_dir)
    py27 = ctypes.CDLL(os.path.join(dll_dir, "python27.dll"))
    for flag in ("Py_NoSiteFlag", "Py_IgnoreEnvironmentFlag", "Py_DontWriteBytecodeFlag"):
        ctypes.c_int.in_dll(py27, flag).value = 1
    py27.Py_InitializeEx(0)

    handle, out_path = tempfile.mkstemp(suffix=".txt")
    os.close(handle)
    prelude = (
        "__f = open(%r, 'wb')\n"
        "def out(text):\n"
        "    __f.write(text + '\\n')\n"
    ) % out_path.replace("\\", "/")
    status = py27.PyRun_SimpleString((prelude + snippet + "\n__f.close()\n").encode("latin1"))
    with open(out_path, "r", encoding="latin1") as result:
        sys.stdout.write(result.read())
    os.remove(out_path)
    if status != 0:
        sys.exit("The snippet raised inside Python 2.7 (its traceback went to stderr).")


if __name__ == "__main__":
    main()
