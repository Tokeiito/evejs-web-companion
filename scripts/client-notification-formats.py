"""Read how the retail client words each kind of notification, by running its own code.

The client formats a notification by the formatter its type has
(notifications/common/formatting/notificationFormatMapping.py, a class or a
function for each type), else by eve/common/script/util/notificationUtil.py's
table: for each type a subject's and a body's label, with a function that adds
to the notification's data, or a function that words it whole. Neither is in
the client's data files; both are its code. This takes those modules' compiled
code out of the client's code archive, runs them inside the client's own
python27.dll, and prints what it finds as one JSON object:

    python scripts/client-notification-formats.py <client bin64 folder> <client code.ccp>

    {"table": {"<typeID>": {"subject": label, "body": label, "parameters": name or null, "function": name or null}},
     "formatters": {"<typeID>": {"name": name, "subject": label or null, "body": label or null}}}

The table's entry has `function` where the type is worded whole by a function
(and no labels), else its two labels and the name of the function that adds to
the data, or null. A formatter's labels are those its class is made with
(BaseNotificationFormatter's subjectLabel and bodyLabel); a formatter that is a
function, or a class that cannot be made here, has none.

The modules run are notificationconst, notificationUtil and every module under
notifications/common, as the client compiled them. What they import of the rest
of the client is stood in for: an object whose every attribute and call is
another of its kind, which is enough for the modules to be built and is never
printed.

Nothing of the client is copied into this repository: its code is read where it
is, when this is run, and the copies made for the run are in the system's
temporary folder and removed after. Run it with a 64-bit Python 3 on Windows.
See scripts/client-constants.py, which this follows.
"""

import ctypes
import os
import sys
import tempfile
import zipfile
import zlib

# Python 2.7 source, run inside the client's interpreter. Only its builtin modules are there: no json and no
# codecs, so the JSON is written by hand. REAL (module name -> its code's file) and OUT are put in front of it.
RUN = r'''
import imp
import marshal
import sys
sys.path[:] = []

class Stand(object):
    """What a module of the client's that is not run here is stood in by: every attribute and call another."""
    def __getattr__(self, name):
        if name.startswith('__') and name.endswith('__'):
            raise AttributeError(name)
        return Stand()
    def __call__(self, *arguments, **keywords):
        return Stand()
    def __or__(self, other):
        return Stand()
    __ror__ = __or__

class StandModule(object):
    def __init__(self, name):
        self.__name__ = name
        self.__path__ = []
    def __getattr__(self, name):
        if name.startswith('__') and name.endswith('__'):
            raise AttributeError(name)
        return Stand()

def install(name, module):
    sys.modules[name] = module
    parent, _, child = name.rpartition('.')
    if parent:
        if parent not in sys.modules:
            install(parent, StandModule(parent))
        setattr(sys.modules[parent], child, module)

def load(name):
    path = REAL[name]
    module = imp.new_module(name)
    if name in PACKAGES:
        module.__path__ = []
    install(name, module)
    exec marshal.loads(open(path, 'rb').read()) in module.__dict__
    return module

class Finder(object):
    def find_module(self, fullname, path=None):
        # Inside a package that is run here a name is one of its modules or none: Python 2 tries an import there
        # first, and then from the top, which is where the rest of the client is stood in for.
        if fullname not in REAL and fullname.rpartition('.')[0] in REAL:
            return None
        return self
    def load_module(self, fullname):
        if fullname in sys.modules:
            return sys.modules[fullname]
        if fullname in REAL:
            return load(fullname)
        module = StandModule(fullname)
        install(fullname, module)
        return module

sys.meta_path.append(Finder())

constants = load('eve.common.script.util.notificationconst')
sys.modules['notificationconst'] = constants
util = load('eve.common.script.util.notificationUtil')
mapping = load('notifications.common.formatting.notificationFormatMapping')

def text(value):
    if value is None:
        return 'null'
    if isinstance(value, str):
        try:
            value = unicode(value, 'utf-8')
        except Exception:
            value = unicode(value, 'latin-1')
    if not isinstance(value, unicode):
        return 'null'
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

def name_of(value):
    return getattr(value, '__name__', None)

table = []
for typeID, value in sorted(util.__dict__['formatters'].items()):
    if not isinstance(typeID, (int, long)):
        continue
    if type(value) is tuple:
        parameters = name_of(value[2]) if len(value) > 2 else None
        table.append('"%d":{"subject":%s,"body":%s,"parameters":%s,"function":null}' % (typeID, text(value[0]), text(value[1]), text(parameters)))
    else:
        table.append('"%d":{"subject":null,"body":null,"parameters":null,"function":%s}' % (typeID, text(name_of(value))))

formatters = []
for typeID, value in sorted(mapping.__dict__['formatterByNotificationType'].items()):
    if not isinstance(typeID, (int, long)):
        continue
    subject = body = None
    if isinstance(value, type):
        try:
            made = value()
            subject = getattr(made, 'subjectLabel', None)
            body = getattr(made, 'bodyLabel', None)
        except Exception:
            pass
    if not isinstance(subject, basestring):
        subject = None
    if not isinstance(body, basestring):
        body = None
    formatters.append('"%d":{"name":%s,"subject":%s,"body":%s}' % (typeID, text(name_of(value)), text(subject), text(body)))

__out = open(OUT, 'wb')
__out.write('{"table":{' + ','.join(table) + '},"formatters":{' + ','.join(formatters) + '}}')
__out.close()
'''

# The modules run: these two, and every module under this folder of the archive.
NAMED = ("eve/common/script/util/notificationconst.pyj", "eve/common/script/util/notificationUtil.pyj")
FOLDER = "notifications/common/"


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    dll_dir, archive = sys.argv[1], sys.argv[2]
    if not os.path.isfile(archive):
        sys.exit("There is no code archive at %s." % archive)

    compiled = {}
    packages = []
    with zipfile.ZipFile(archive) as code:
        for entry in code.namelist():
            path = entry.replace("\\", "/")
            if path in NAMED or (path.startswith(FOLDER) and path.endswith(".pyj")):
                stem = path[: -len(".pyj")]
                if stem.endswith("/__init__"):
                    stem = stem[: -len("/__init__")]
                    packages.append(stem.replace("/", "."))
                compiled[stem.replace("/", ".")] = zlib.decompress(code.read(entry))[8:]
    for path in NAMED:
        if path[: -len(".pyj")].replace("/", ".") not in compiled:
            sys.exit("The client's code has no %s." % path)

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
        said = "REAL = %r\nPACKAGES = %r\nOUT = %r\n" % (
            dict((name, kept(content, ".marshal")) for name, content in compiled.items()),
            packages,
            out_path,
        )
        status = py27.PyRun_SimpleString((said + RUN).encode("latin1"))
        if status != 0:
            sys.exit("The client's notification modules raised inside Python 2.7 (the traceback went to stderr).")
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
