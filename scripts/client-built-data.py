"""Read one of the retail client's built data files with the client's own loader.

Much of the client's static data is "cFSD": a binary file (res:/staticdata/
<name>.fsdbinary) laid out by a schema that is compiled into a loader module
beside the client's executable (bin64/<name>Loader.pyd). Only that loader knows
the layout. This runs the loader inside the client's own python27.dll, walks
what it returns, and prints it as one JSON document.

    python scripts/client-built-data.py <client bin64 folder> <loader module> <data file>

    <loader module>  the loader's module name, "missionsLoader"
    <data file>      the .fsdbinary on disk (under the client's ResFiles)

What is printed: a cfsd dict as an object (its keys as strings), a cfsd list or
vector as an array, a cfsd object as an object of the attributes it has (an
optional attribute it does not have is left out), and numbers, strings, true,
false and null as themselves.

Nothing of the client is copied into this repository: its loader and its data
are read where they are, when this is run. Run it with a 64-bit Python 3 on
Windows. See scripts/py27-oracle.py for how the second Python is loaded.
"""

import ctypes
import os
import re
import sys
import tempfile

# Python 2.7 source, run inside the client's interpreter. Only its builtin modules are there: no json and no
# codecs, so the JSON is written by hand.
WALKER = r'''
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
    if depth > 40:
        raise RuntimeError('The data is nested deeper than this walks.')
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
            return 'null'
        return repr(value)
    if isinstance(value, basestring):
        return text(value)
    if hasattr(value, 'iteritems'):
        return '{' + ','.join([text(str(key)) + ':' + walk(item, depth + 1) for key, item in value.iteritems()]) + '}'
    if isinstance(value, (list, tuple)) or hasattr(value, '__iter__') or hasattr(value, '__getitem__') and hasattr(value, '__len__'):
        return '[' + ','.join([walk(item, depth + 1) for item in value]) + ']'
    parts = []
    for name in dir(value):
        if name.startswith('_'):
            continue
        try:
            item = getattr(value, name)
        except AttributeError:
            continue
        if callable(item):
            continue
        parts.append(text(name) + ':' + walk(item, depth + 1))
    return '{' + ','.join(parts) + '}'
'''

# The run itself. BIN, LOADER, DATA and OUT are put in front of it. The only place modules are looked for is the
# client's own folder: the host Python's library must never be imported into this interpreter by accident.
LOAD = r'''
import sys
sys.path[:] = [BIN]
loader = __import__(LOADER)
__out = open(OUT, 'wb')
__out.write(walk(loader.load(DATA), 0))
__out.close()
'''


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    dll_dir, loader, data_file = sys.argv[1], sys.argv[2], sys.argv[3]
    if not re.match(r"^[A-Za-z0-9_]+Loader$", loader):
        sys.exit("The loader module's name is not one: %r" % loader)
    if not os.path.isfile(os.path.join(dll_dir, loader + ".pyd")):
        sys.exit("The client has no %s.pyd in %s." % (loader, dll_dir))
    if not os.path.isfile(data_file):
        sys.exit("There is no data file at %s." % data_file)

    os.add_dll_directory(dll_dir)
    py27 = ctypes.CDLL(os.path.join(dll_dir, "python27.dll"))
    for flag in ("Py_NoSiteFlag", "Py_IgnoreEnvironmentFlag", "Py_DontWriteBytecodeFlag"):
        ctypes.c_int.in_dll(py27, flag).value = 1
    py27.Py_InitializeEx(0)

    handle, out_path = tempfile.mkstemp(suffix=".json")
    os.close(handle)
    try:
        names = "BIN = %r\nLOADER = %r\nDATA = %r\nOUT = %r\n" % (
            dll_dir.replace("\\", "/"),
            loader,
            data_file.replace("\\", "/"),
            out_path.replace("\\", "/"),
        )
        status = py27.PyRun_SimpleString((names + WALKER + LOAD).encode("latin1"))
        if status != 0:
            sys.exit("The loader raised inside Python 2.7 (its traceback went to stderr).")
        with open(out_path, "rb") as result:
            sys.stdout.buffer.write(result.read())
    finally:
        os.remove(out_path)


if __name__ == "__main__":
    main()
