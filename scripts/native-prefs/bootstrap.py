# Python2 source executed in the installed python27.dll, not the host Python3.
# All preference methods/classes and stdlib dependencies below are the ORIGINAL
# code objects captured from this user's code.ccp. No parser is reconstructed.
import sys, zipimport, _codecs

sys.path[:] = []
_archive = _codecs.utf_8_decode(_CLIENT_MODULES_RAW)[0]


class InstalledPreferencesModules(object):

    def find_module(self, name, path=None):
        prefix = name.rpartition('.')[0].replace('.', '/')
        try:
            importer = zipimport.zipimporter(_archive + ('/' + prefix if prefix else ''))
            code = importer.get_code(name)
        except zipimport.ZipImportError:
            return None
        if code is None:
            raise ImportError('Not an installed code module: ' + name)
        filename = code.co_filename.replace('\\', '/')
        if name in ('eveprefs', 'eveprefs.filebased', 'eveprefs.iniformat'):
            allowed = '/packages/eveprefs/' in filename
        else:
            allowed = '/stdlib/' in filename
        if not allowed:
            raise ImportError('Not an installed preference/stdlib module: ' + name)
        return importer


sys.meta_path.insert(0, InstalledPreferencesModules())
# A strictly bounded REAL host interface: these callbacks execute the source
# Windows sharing/retry/file logic. It supplies no engine, paths or readiness.
import _client_prefs_io
sys.modules['blue'] = _client_prefs_io
import eveprefs
from eveprefs.iniformat import IniIniFile


def _create_preferences(root):
    owner = eveprefs.Handler(IniIniFile('prefs', root))
    # Same phase as eveprefs.Init: after constructing the real Handler/INI,
    # before GetValue or preference-driven logging initialization.
    sys.setdefaultencoding(eveprefs.DEFAULT_ENCODING)
    return owner


def _create_logmodule(backend):
    # Materialize only the selected ORIGINAL definitions. Importing the entire
    # modules would require engine/traceback/UI services we have not started.
    import types

    def module_code(name, suffix):
        prefix = name.rpartition('.')[0].replace('.', '/')
        importer = zipimport.zipimporter(_archive + ('/' + prefix if prefix else ''))
        code = importer.get_code(name)
        if code is None or not code.co_filename.replace('\\', '/').endswith(suffix):
            raise ImportError('Not the installed logging module: ' + name)
        return code

    def definition(code, name):
        matches = [value for value in code.co_consts
                   if isinstance(value, types.CodeType) and value.co_name == name]
        if len(matches) != 1:
            raise ImportError('Ambiguous installed logging definition: ' + name)
        return matches[0]

    # A real local output adapter, not blue.LogChannel's native heap type or
    # engine startup. Native callbacks parse the original C API arguments and
    # retain the actual synchronous JS backend channel through a capsule.
    class ClientLogChannelOutput(object):
        __slots__ = ('_native_token', '_facility', '_object')
        flags = {'INFO': 1, 'NOTICE': 32, 'WARN': 2, 'ERR': 4}

        def __init__(self, *args):
            token = backend.create(*args)
            self._native_token = token
            self._facility, self._object = args

        facility = property(lambda self: self._facility)
        object = property(lambda self: self._object)
        channelOpen = property(lambda self: 1)

        def IsOpen(self, *args):
            return backend.is_open(self._native_token, *args)

        def Log(self, *args):
            return backend.log(self._native_token, *args)

        def LogCounter(self, *args):
            return backend.counter(self, *args)

    source = module_code('stdlogutils.logserver', '/packages/stdlogutils/logserver.py')
    wrapper_globals = {'__name__': 'stdlogutils.logserver',
                       '__builtins__': __builtins__,
                       'LogChannel': ClientLogChannelOutput,
                       'LGINFO': 1, 'LGNOTICE': 32, 'LGWARN': 2, 'LGERR': 4}
    wrapper_globals['_LogChannelIsOpen'] = types.FunctionType(
        definition(source, '_LogChannelIsOpen'), wrapper_globals)
    wrapper_body = types.FunctionType(definition(source, 'ChannelWrapper'), wrapper_globals)
    wrapper = type('ChannelWrapper', (ClientLogChannelOutput,), wrapper_body())
    wrapper_globals['ChannelWrapper'] = wrapper
    stream_body = types.FunctionType(definition(source, 'LogChannelStream'), wrapper_globals)
    stream = type('LogChannelStream', (object,), stream_body())
    wrapper_globals['LogChannelStream'] = stream

    module = types.ModuleType('logmodule')
    namespace = module.__dict__
    namespace.update({'__builtins__': __builtins__, 'ChannelWrapper': wrapper,
                      'LogChannelStream': stream, 'Channel': wrapper,
                      'LGINFO': 1, 'LGNOTICE': 32, 'LGWARN': 2, 'LGERR': 4,
                      'baseName': '', 'channels': {}, 'uiMessageFunc': None})
    for name in ('Suppress', 'Unsuppress', 'SuppressAllChannels', 'UnsuppressAllChannels'):
        namespace[name] = getattr(wrapper, name)
    namespace['channelDict'] = wrapper.channelDict
    for name in wrapper.flags:
        namespace[name] = wrapper.flags[name]
        namespace[name.lower()] = wrapper.flags[name]
    source = module_code('logmodule', '/packages/logmodule/__init__.py')
    for name in ('GetChannel', 'init', 'SetUiMessageFunc', 'DefaultUIMessage', 'AddGlobalChannels'):
        # These defaults are the installed module's MAKE_FUNCTION operands;
        # classbody-created methods above retain their original defaults and
        # classmethod descriptors directly from the untouched bytecode.
        defaults = ('', None) if name == 'init' else None
        namespace[name] = types.FunctionType(definition(source, name), namespace, name, defaults)
    # Original order, before any init(base_name, prefs). A constructor failure
    # propagates at its actual point; GetChannel caches only successful calls.
    for variable, name in (('ui', 'UI'), ('general', 'General'),
                           ('methodcalls', 'MethodCalls'), ('unittest', 'Unittest')):
        namespace[variable] = namespace['GetChannel'](name)
    return module
