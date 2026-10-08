# Which notifications does a class in the retail client register for?
#
# The decompiled client prints a class's __notifyevents__ as a list of numbers:
# the names are lost. They are still in the compiled class body, as the
# constants loaded just before the list is built. This reads them from there.
#
# It is a snippet for scripts/py27-oracle.py, and reads one module's compiled
# code as scripts/client-code.py writes it. The oracle passes a snippet no
# arguments, so the file is named in the environment:
#
#     python scripts/client-code.py "<client>/tq/code.ccp" script/dogma/clientDogmaLocation.pyj scratch/module.marshal
#     CLIENT_MODULE=scratch/module.marshal python scripts/py27-oracle.py "<client>/tq/bin64" scripts/client-notify-events.py
#
# It prints one line for each class in the module that has the list:
#
#     DogmaLocation.__notifyevents__ = ['OnModuleAttributeChanges', ...]
#
# Python 2.7, builtin modules only (the client's standard library is not loaded).
import marshal
import nt

handle = open(nt.environ['CLIENT_MODULE'], 'rb')
module = marshal.loads(handle.read())
handle.close()

LOAD_CONST, BUILD_LIST, STORE_NAME, HAVE_ARGUMENT = 100, 103, 90, 90


def classes(code):
    """Every code object in a module, however deep."""
    for const in code.co_consts:
        if hasattr(const, 'co_code'):
            yield const
            for inner in classes(const):
                yield inner


for code in classes(module):
    raw = code.co_code
    held = []
    i = 0
    while i < len(raw):
        op = ord(raw[i])
        if op >= HAVE_ARGUMENT:
            arg = ord(raw[i + 1]) + ord(raw[i + 2]) * 256
            i += 3
        else:
            arg = None
            i += 1
        if op == LOAD_CONST:
            held.append(code.co_consts[arg])
        elif op == BUILD_LIST:
            held = [held[len(held) - arg:] if arg else []]
        elif op == STORE_NAME:
            if code.co_names[arg] == '__notifyevents__' and held:
                out('%s.__notifyevents__ = %r' % (code.co_name, held[-1]))
            held = []
        else:
            held = []
