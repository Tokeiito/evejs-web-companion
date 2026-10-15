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

Each entry also has `described`: what its function makes of a notification,
found by running the function on a notification whose data's values are
stand-ins that say which value they are, with the client's helpers that word a
part recorded (an owner's link, a place's, a type's, an amount of ISK, a date,
a label's words with their parameters). For a parameter function, each
parameter it adds; for a function or a formatter, the subject and the body.
Each is run with the data's values read as true, as false, and once for each
key it reads with that key not there; a part that comes out differently, or
that the function does anything else with (compares, adds, prints), is null.
The whole is null where the function cannot be run that way at all.

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

# What a function makes of a notification, described by running it.
# A function is run on a notification whose data's every value is a Token, a stand-in that says which value of the
# data it is; what the client's helpers are handed is recorded (a name's link, an amount of ISK, a date, a label's
# words). Anything else done with a Token (compared, added, printed, its attribute read) is Unsure: the function
# cannot be described. It is run twice, the data's values read once as true and once as false, and what comes out
# the same both times is described; what does not, turned on a value, is not.

class Unsure(Exception):
    pass

def unsure(*arguments, **keywords):
    raise Unsure()

class Token(object):
    def __init__(self, path, truth):
        self.path = path
        self.truth = truth
    def __nonzero__(self):
        return self.truth
    def __getitem__(self, index):
        if not isinstance(index, (int, long, basestring)):
            raise Unsure()
        return Token(self.path + [index], self.truth)
    def __hash__(self):
        return id(self)
    def __getattr__(self, name):
        raise Unsure()
    __eq__ = __ne__ = __lt__ = __le__ = __gt__ = __ge__ = __cmp__ = unsure
    __str__ = __repr__ = __unicode__ = __int__ = __long__ = __float__ = __len__ = __iter__ = __contains__ = unsure
    __add__ = __radd__ = __sub__ = __rsub__ = __mul__ = __rmul__ = __div__ = __rdiv__ = __truediv__ = __mod__ = __rmod__ = __neg__ = __abs__ = unsure

class Marker(object):
    def __init__(self, described):
        self.described = described
    def __nonzero__(self):
        return True
    def __hash__(self):
        return id(self)
    def __getattr__(self, name):
        raise Unsure()
    __eq__ = __ne__ = __lt__ = __le__ = __gt__ = __ge__ = __cmp__ = unsure
    __str__ = __repr__ = __unicode__ = __int__ = __long__ = __float__ = __len__ = __iter__ = __contains__ = __getitem__ = unsure
    __add__ = __radd__ = __mod__ = __rmod__ = unsure

def describe(value):
    if isinstance(value, Token):
        return {'data': list(value.path)}
    if isinstance(value, Marker):
        return value.described
    if value is None or isinstance(value, (bool, int, long, float, basestring)):
        return {'value': value}
    if isinstance(value, (list, tuple)):
        return {'list': [describe(each) for each in value]}
    raise Unsure()

def literal_or_described(value):
    return describe(value)

def recorder(kind, keys):
    def record(*arguments, **keywords):
        made = {'kind': kind}
        for place, key in enumerate(keys):
            if place < len(arguments):
                made[key] = describe(arguments[place])
        if len(arguments) > len(keys):
            made['more'] = [describe(each) for each in arguments[len(keys):]]
        if keywords:
            made['keywords'] = dict((key, describe(each)) for key, each in keywords.items())
        return Marker(made)
    return record

def by_label(label, *arguments, **keywords):
    if not isinstance(label, basestring) or arguments:
        raise Unsure()
    return Marker({'kind': 'label', 'label': label, 'params': dict((key, describe(each)) for key, each in keywords.items())})

class Recording(object):
    """The client's helpers that word a notification's parts, recorded: a stand-in for a module or a service."""
    def __init__(self, names):
        self.names = names
    def __getattr__(self, name):
        if name in self.names:
            return self.names[name]
        raise Unsure()

class OwnerRecord(object):
    def __init__(self, ownerID):
        self.ownerID = ownerID
    def __getattr__(self, name):
        if name in ('name', 'ownerName'):
            return Marker({'kind': 'ownerName', 'id': describe(self.ownerID)})
        raise Unsure()

class LocationRecord(object):
    def __init__(self, locationID):
        self.locationID = locationID
    def __getattr__(self, name):
        if name in ('name', 'locationName'):
            return Marker({'kind': 'locationName', 'id': describe(self.locationID)})
        raise Unsure()

RECORDED = {
    'CreateItemInfoLink': recorder('link', ['id']),
    'CreateLocationInfoLink': recorder('location', ['id', 'typeID']),
    'CreateTypeInfoLink': recorder('type', ['typeID']),
    'GetShowInfoLink': recorder('showinfo', ['typeID', 'name', 'itemID']),
    'FmtISK': recorder('isk', ['amount']),
    'FmtDate': recorder('date', ['when', 'format']),
    'GetByLabel': by_label,
}
RECORDED['localization'] = Recording({'GetByLabel': by_label, 'GetByMessageID': recorder('message', ['messageID'])})
RECORDED['evefmt'] = RECORDED['eveFormat'] = Recording({'FmtISK': RECORDED['FmtISK'], 'FmtAmt': recorder('amount', ['amount'])})
RECORDED['fmtutil'] = RECORDED['fmtUtils'] = Recording({'FmtDate': RECORDED['FmtDate'], 'FmtISK': RECORDED['FmtISK']})
RECORDED['cfg'] = Recording({
    'eveowners': Recording({'Get': lambda ownerID: OwnerRecord(ownerID)}),
    'evelocations': Recording({'Get': lambda locationID: LocationRecord(locationID)}),
})

# What the client's modules reach for, recorded where it words a part and stood in for elsewhere.
for __name, __module in list(sys.modules.items()):
    if __name in REAL and __module is not None and hasattr(__module, '__dict__'):
        for __key in list(__module.__dict__.keys()):
            if __key in RECORDED:
                __module.__dict__[__key] = RECORDED[__key]
        __module.__dict__['cfg'] = RECORDED['cfg']
sys.modules['localization'] = RECORDED['localization']

class Data(dict):
    """A notification's data: every key there, its value a Token, but `absent`, which is not; the keys read noted."""
    def __init__(self, truth, absent, read):
        dict.__init__(self)
        self.truth = truth
        self.absent = absent
        self.read = read
    def __missing__(self, key):
        self.read.add(key)
        if key == self.absent:
            raise KeyError(key)
        return Token([key], self.truth)
    def get(self, key, default=None):
        self.read.add(key)
        if key == self.absent:
            return default
        return self[key]
    def __contains__(self, key):
        self.read.add(key)
        return dict.__contains__(self, key) or key != self.absent
    has_key = __contains__

class Fake(object):
    """A notification whose every value is a Token."""
    def __init__(self, typeID, truth, util_format, absent=None, read=None):
        self.typeID = typeID
        self.data = Data(truth, absent, read if read is not None else set())
        self.notificationID = Token(['notificationID'], truth)
        self.senderID = Token(['notification_senderID'], truth)
        self.receiverID = Token(['notification_receiverID'], truth)
        self.created = Token(['notification_created'], truth)
        self.subject = None
        self.body = None
        if util_format:
            # notificationUtil.Format gives the data these three before a parameter function is called (1512 to 1515).
            dict.__setitem__(self.data, 'notification_senderID', self.senderID)
            dict.__setitem__(self.data, 'notification_receiverID', self.receiverID)
            dict.__setitem__(self.data, 'notification_created', self.created)

def agreed(first, second):
    """Two descriptions of one part: the part where they are the same; a label's where only some of its parameters
    differ, those set to None; None where they differ otherwise."""
    if first == second:
        return first
    if (type(first) is dict and type(second) is dict and first.get('kind') == 'label' and second.get('kind') == 'label'
            and first.get('label') == second.get('label')):
        params = {}
        for key in set(first['params'].keys()) | set(second['params'].keys()):
            params[key] = agreed(first['params'].get(key), second['params'].get(key))
        return {'kind': 'label', 'label': first['label'], 'params': params}
    return None

def twice(run):
    """What `run(truth, absent, read)` makes of a fake notification: run with the data's values true and false, and
    then once more for each key either run read, with that key not in the data. Each part is described where the
    runs agree (agreed) and None where they differ; a run with a key absent that fails tells nothing (the client
    fails there too), and one that does not is compared with the rest. None for the whole where the true or the
    false run is Unsure."""
    read = set()
    made = []
    for truth in (True, False):
        try:
            made.append(run(truth, None, read))
        except Exception:
            return None
    first, second = made
    if sorted(first.keys()) != sorted(second.keys()):
        return None
    parts = dict((key, agreed(first[key], second[key])) for key in first)
    for absent in sorted(read, key=repr):
        try:
            without = run(True, absent, set())
        except Exception:
            continue
        for key in parts:
            parts[key] = agreed(parts[key], without.get(key)) if parts[key] is not None else None
    return parts

def walk(value):
    if value is None:
        return 'null'
    if value is True:
        return 'true'
    if value is False:
        return 'false'
    if isinstance(value, (int, long)):
        return str(value)
    if isinstance(value, float):
        return repr(value)
    if isinstance(value, basestring):
        return text(value)
    if isinstance(value, dict):
        return '{' + ','.join([text(str(key)) + ':' + walk(each) for key, each in sorted(value.items())]) + '}'
    if isinstance(value, (list, tuple)):
        return '[' + ','.join([walk(each) for each in value]) + ']'
    return 'null'

def parameters_of(typeID, function):
    def run(truth, absent, read):
        made = function(Fake(typeID, truth, True, absent, read))
        if type(made) is not dict:
            raise Unsure()
        return dict((key, describe(each)) for key, each in made.items())
    return twice(run)

def worded_by_function(typeID, function):
    def run(truth, absent, read):
        made = function(Fake(typeID, truth, False, absent, read))
        if type(made) is not tuple or len(made) != 2:
            raise Unsure()
        return {'subject': describe(made[0]), 'body': describe(made[1])}
    return twice(run)

def worded_by_formatter(typeID, value):
    def run(truth, absent, read):
        notification = Fake(typeID, truth, False, absent, read)
        if isinstance(value, type):
            value().Format(notification)
            return {'subject': describe(notification.subject), 'body': describe(notification.body)}
        made = value(notification)
        if type(made) is tuple and len(made) == 2:
            return {'subject': describe(made[0]), 'body': describe(made[1])}
        return {'subject': describe(notification.subject), 'body': describe(notification.body)}
    return twice(run)

table = []
for typeID, value in sorted(util.__dict__['formatters'].items()):
    if not isinstance(typeID, (int, long)):
        continue
    if type(value) is tuple:
        parameters = name_of(value[2]) if len(value) > 2 else None
        described = parameters_of(typeID, value[2]) if len(value) > 2 else None
        table.append('"%d":{"subject":%s,"body":%s,"parameters":%s,"function":null,"described":%s}' % (typeID, text(value[0]), text(value[1]), text(parameters), walk(described)))
    else:
        table.append('"%d":{"subject":null,"body":null,"parameters":null,"function":%s,"described":%s}' % (typeID, text(name_of(value)), walk(worded_by_function(typeID, value))))

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
    formatters.append('"%d":{"name":%s,"subject":%s,"body":%s,"described":%s}' % (typeID, text(name_of(value)), text(subject), text(body), walk(worded_by_formatter(typeID, value))))

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
