"""Read named values out of one module of the retail client's own code, by running it.

Some of what the retail client knows is neither asked of the server nor kept in
its data files: it is written into its code as constants. What a packaged ship
of each group takes up is one such table (inventorycommon/const.py). This takes
one module's compiled code out of the client's code archive, runs it inside the
client's own python27.dll, and prints the values asked for as one JSON object.

    python scripts/client-constants.py <client bin64 folder> <client code.ccp> <module path ending> <name> [<name> ...]

    python scripts/client-constants.py "D:/EVE/tq/bin64" "D:/EVE/tq/code.ccp" inventorycommon/const.pyj typePlasticWrap

The module must be one that imports nothing: only Python's builtin modules are
there to import, and a module that reaches for another fails here. A dict is
printed as an object (its keys as strings), a list, tuple or set as an array,
and numbers, strings, true, false and null as themselves. Anything else is an
error, not a guess.

Nothing of the client is copied into this repository: its code is read where it
is, when this is run, and the copy made for the run is in the system's temporary
folder and removed after. Run it with a 64-bit Python 3 on Windows. See
scripts/py27-oracle.py for how the second Python is loaded, and
scripts/client-code.py for the archive.
"""

import ctypes
import os
import re
import sys
import tempfile
import zipfile
import zlib

# Python 2.7 source, run inside the client's interpreter. Only its builtin modules are there: no json and no
# codecs, so the JSON is written by hand. CODE, NAMES and OUT are put in front of it.
RUN = r'''
import marshal
import sys
sys.path[:] = []

def text(value):
    if isinstance(value, str):
        try:
            value = unicode(value, 'utf-8')
        except Exception:
            value = unicode(value, 'latin-1')
    parts = ['"']
    for char in value:
        number = ord(char)
        if number == 34:
            parts.append('\\"')
        elif number == 92:
            parts.append('\\\\')
        elif 32 <= number < 127:
            parts.append(chr(number))
        else:
            parts.append('\\u%04x' % number)
    parts.append('"')
    return ''.join(parts)

def walk(value, depth):
    if depth > 20:
        raise RuntimeError('The value is nested deeper than this walks.')
    if value is None:
        return 'null'
    if value is True:
        return 'true'
    if value is False:
        return 'false'
    if isinstance(value, (int, long)):
        return str(value)
    if isinstance(value, float):
        if value != value or value in (float('inf'), float('-inf')):
            raise RuntimeError('A number that JSON cannot carry.')
        return repr(value)
    if isinstance(value, basestring):
        return text(value)
    if isinstance(value, dict):
        return '{' + ','.join([text(str(key)) + ':' + walk(item, depth + 1) for key, item in value.iteritems()]) + '}'
    if isinstance(value, (list, tuple, set, frozenset)):
        return '[' + ','.join([walk(item, depth + 1) for item in value]) + ']'
    raise RuntimeError('A value this does not print: %r' % type(value))

__module = marshal.loads(open(CODE, 'rb').read())
__names = {'__name__': '__client_constants__'}
exec __module in __names
__missing = [name for name in NAMES if name not in __names]
if __missing:
    raise RuntimeError('The module has no %s.' % ', '.join(__missing))
__out = open(OUT, 'wb')
__out.write('{' + ','.join([text(name) + ':' + walk(__names[name], 0) for name in NAMES]) + '}')
__out.close()
'''


def main():
    if len(sys.argv) < 5:
        sys.exit(__doc__)
    dll_dir, archive, ending, names = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:]
    if not ending.endswith(".pyj"):
        sys.exit("The module's path must end in .pyj: %r" % ending)
    for name in names:
        if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", name):
            sys.exit("Not a name: %r" % name)
    if not os.path.isfile(archive):
        sys.exit("There is no code archive at %s." % archive)

    with zipfile.ZipFile(archive) as code:
        entries = [entry for entry in code.namelist() if entry.replace("\\", "/").endswith("/" + ending) or entry.replace("\\", "/") == ending]
        if len(entries) != 1:
            sys.exit("Expected one entry ending %s in the client's code, found %d." % (ending, len(entries)))
        compiled = zlib.decompress(code.read(entries[0]))

    os.add_dll_directory(dll_dir)
    py27 = ctypes.CDLL(os.path.join(dll_dir, "python27.dll"))
    for flag in ("Py_NoSiteFlag", "Py_IgnoreEnvironmentFlag", "Py_DontWriteBytecodeFlag"):
        ctypes.c_int.in_dll(py27, flag).value = 1
    py27.Py_InitializeEx(0)

    code_handle, code_path = tempfile.mkstemp(suffix=".marshal")
    out_handle, out_path = tempfile.mkstemp(suffix=".json")
    os.close(out_handle)
    try:
        # The .pyc without its 8-byte header: what marshal.loads reads.
        with os.fdopen(code_handle, "wb") as handle:
            handle.write(compiled[8:])
        given = "CODE = %r\nNAMES = %r\nOUT = %r\n" % (code_path.replace("\\", "/"), list(names), out_path.replace("\\", "/"))
        status = py27.PyRun_SimpleString((given + RUN).encode("latin1"))
        if status != 0:
            sys.exit("The module raised inside Python 2.7 (its traceback went to stderr).")
        with open(out_path, "rb") as result:
            sys.stdout.buffer.write(result.read())
    finally:
        for leftover in (code_path, out_path):
            try:
                os.remove(leftover)
            except OSError:
                pass


if __name__ == "__main__":
    main()
