"""Read named values out of one module of the retail client's own code, by running it.

Some of what the retail client knows is neither asked of the server nor kept in
its data files: it is written into its code as constants. What a packaged ship
of each group takes up is one such table (inventorycommon/const.py). This takes
one module's compiled code out of the client's code archive, runs it inside the
client's own python27.dll, and prints the values asked for as one JSON object.

    python scripts/client-constants.py <client bin64 folder> <client code.ccp> <module path ending>
        [--with <dotted.name>=<module path ending> ...] [--stub <dotted.name> ...] <name> [<name> ...]

    python scripts/client-constants.py "D:/EVE/tq/bin64" "D:/EVE/tq/code.ccp" inventorycommon/const.pyj typePlasticWrap

Only Python's builtin modules are there to import, so a module that imports
another of the client's must be given it:

    --with dogma.const=dogma/const.pyj   that module, run first and importable under that name (give them in
                                         the order they need each other)
    --stub evetypes                      a name the module imports and does not use while it is being run: an
                                         empty stand-in, whose every attribute is None

A name may be dotted, to reach through something the module imported:
dogma.const.attributeCapacity. A dict is printed as an object (its keys as
strings), a list, tuple or set as an array, and numbers, strings, true, false
and null as themselves. Anything else is an error, not a guess.

Nothing of the client is copied into this repository: its code is read where it
is, when this is run, and the copies made for the run are in the system's
temporary folder and removed after. Run it with a 64-bit Python 3 on Windows.
See scripts/py27-oracle.py for how the second Python is loaded, and
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
# codecs, so the JSON is written by hand. CODE, WITH, STUBS, NAMES and OUT are put in front of it.
RUN = r'''
import imp
import marshal
import sys
sys.path[:] = []

class Stub(object):
    def __getattr__(self, name):
        return None

def install(name, module):
    sys.modules[name] = module
    parent, _, child = name.rpartition('.')
    if parent:
        if parent not in sys.modules:
            install(parent, imp.new_module(parent))
        setattr(sys.modules[parent], child, module)

def run(path, names):
    exec marshal.loads(open(path, 'rb').read()) in names

def reach(names, dotted):
    parts = dotted.split('.')
    if parts[0] not in names:
        raise RuntimeError('The module has no %s.' % dotted)
    value = names[parts[0]]
    for part in parts[1:]:
        if isinstance(value, Stub) or not hasattr(value, part):
            raise RuntimeError('The module has no %s.' % dotted)
        value = getattr(value, part)
    return value

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

for __name in STUBS:
    install(__name, Stub())
for __name, __path in WITH:
    __given = imp.new_module(__name)
    install(__name, __given)
    run(__path, __given.__dict__)
__names = {'__name__': '__client_constants__'}
run(CODE, __names)
__out = open(OUT, 'wb')
__out.write('{' + ','.join([text(name) + ':' + walk(reach(__names, name), 0) for name in NAMES]) + '}')
__out.close()
'''

DOTTED = r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$"


def compiled_module(code, ending):
    """One module's .pyc out of the archive, without its 8-byte header: what marshal.loads reads."""
    if not ending.endswith(".pyj"):
        sys.exit("A module's path must end in .pyj: %r" % ending)
    entries = [entry for entry in code.namelist() if entry.replace("\\", "/").endswith("/" + ending) or entry.replace("\\", "/") == ending]
    if len(entries) != 1:
        sys.exit("Expected one entry ending %s in the client's code, found %d." % (ending, len(entries)))
    return zlib.decompress(code.read(entries[0]))[8:]


def main():
    arguments = sys.argv[1:]
    if len(arguments) < 4:
        sys.exit(__doc__)
    dll_dir, archive, ending = arguments[:3]
    given, stubs, names = [], [], []
    rest = arguments[3:]
    while rest:
        word = rest.pop(0)
        if word in ("--with", "--stub"):
            if not rest:
                sys.exit("%s wants a value." % word)
            value = rest.pop(0)
            if word == "--stub":
                stubs.append(value)
            else:
                name, _, path = value.partition("=")
                given.append((name, path))
        else:
            names.append(word)
    if not names:
        sys.exit(__doc__)
    for name in names + stubs + [name for name, _ in given]:
        if not re.match(DOTTED, name):
            sys.exit("Not a name: %r" % name)
    if not os.path.isfile(archive):
        sys.exit("There is no code archive at %s." % archive)

    with zipfile.ZipFile(archive) as code:
        compiled = compiled_module(code, ending)
        compiled_given = [(name, compiled_module(code, path)) for name, path in given]

    os.add_dll_directory(dll_dir)
    py27 = ctypes.CDLL(os.path.join(dll_dir, "python27.dll"))
    for flag in ("Py_NoSiteFlag", "Py_IgnoreEnvironmentFlag", "Py_DontWriteBytecodeFlag"):
        ctypes.c_int.in_dll(py27, flag).value = 1
    py27.Py_InitializeEx(0)

    written = []

    def kept(content, suffix):
        handle, path = tempfile.mkstemp(suffix=suffix)
        written.append(path)
        with os.fdopen(handle, "wb") as out:
            out.write(content)
        return path.replace("\\", "/")

    try:
        out_path = kept(b"", ".json")
        said = "CODE = %r\nWITH = %r\nSTUBS = %r\nNAMES = %r\nOUT = %r\n" % (
            kept(compiled, ".marshal"),
            [(name, kept(content, ".marshal")) for name, content in compiled_given],
            list(stubs),
            list(names),
            out_path,
        )
        status = py27.PyRun_SimpleString((said + RUN).encode("latin1"))
        if status != 0:
            sys.exit("The module raised inside Python 2.7 (its traceback went to stderr).")
        with open(out_path, "rb") as result:
            sys.stdout.buffer.write(result.read())
    finally:
        for leftover in written:
            try:
                os.remove(leftover)
            except OSError:
                pass


if __name__ == "__main__":
    main()
