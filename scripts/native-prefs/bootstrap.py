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
        elif name in ('caching', 'caching.lazy', 'caching.memoize'):
            allowed = '/packages/caching/' in filename
        elif name in ('brennivin', 'brennivin.compat', 'brennivin.traceback2', 'traceback2', 'stringutil'):
            suffix = name.replace('.', '/') + ('/__init__.py' if name in ('brennivin', 'traceback2', 'stringutil') else '.py')
            allowed = filename.endswith('/packages/' + suffix)
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

# CPython2 marks frames using a copied builtins dictionary as restricted;
# original old-style classes (including Sissy) then cannot use __dict__.
# Keep the REAL shared builtins dictionary and route only explicit module-local
# import bindings. No per-client session/boot/preferences replace shared values.
import __builtin__
_client_import_fallback = __builtin__.__import__


def _client_scoped_import(name, globals=None, locals=None, fromlist=(), level=-1):
    bindings = globals.get('_CLIENT_IMPORT_BINDINGS') if type(globals) is dict else None
    if level in (-1, 0) and bindings is not None and name in bindings:
        return bindings[name]
    relative = globals.get('_CLIENT_RELATIVE_IMPORT_BINDINGS') if type(globals) is dict else None
    if level == 1 and relative is not None and name in relative:
        return relative[name]
    if level == -1 and type(globals) is dict and name in globals.get('_CLIENT_ABSOLUTE_IMPORT_NAMES', ()):
        level = 0
    return _client_import_fallback(name, globals, locals, fromlist, level)


__builtin__.__import__ = _client_scoped_import


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


def _create_tasklet_profile(backend):
    # Only these ORIGINAL installed class bodies/functions, with a real local
    # inactive native timer capability. No noop implementation or engine import.
    import types
    code = zipimport.zipimporter(_archive + '/ccpProfile').get_code('ccpProfile.blueTaskletImplementation')
    if code is None or not code.co_filename.replace('\\', '/').endswith('/packages/ccpProfile/blueTaskletImplementation.py'):
        raise ImportError('Not the installed blue tasklet profile')

    def definition(name):
        matches = [value for value in code.co_consts
                   if isinstance(value, types.CodeType) and value.co_name == name]
        if len(matches) != 1:
            raise ImportError('Ambiguous installed tasklet profile definition: ' + name)
        return matches[0]

    pyos = types.ModuleType('companion.tasklet_pyos_capability')
    pyos.taskletTimer = backend
    blue_host = types.ModuleType('companion.tasklet_blue_capability')
    blue_host.pyos = pyos
    module = types.ModuleType('ccpProfile.blueTaskletImplementation')
    namespace = module.__dict__
    namespace.update({'__builtins__': __builtins__, 'blue': blue_host,
                      'EnterTasklet': backend.EnterTasklet,
                      'ReturnFromTasklet': backend.ReturnFromTasklet,
                      'GetCurrent': backend.GetCurrent})
    for name, bases in (('Timer', (object,)), ('TimerPush', None)):
        body = types.FunctionType(definition(name), namespace)
        namespace[name] = type(name, bases or (namespace['Timer'],), body())
    for name in ('PushTimer', 'PopTimer', 'CurrentTimer'):
        namespace[name] = types.FunctionType(definition(name), namespace)
    return module


def _create_static_service_types(wallclock, logging, preferences, high, low, medium, skill):
    # Selected original constructors, not ServiceManager/Run or a ready static
    # service. Native Python owns these classes, dictionaries and method calls.
    import types, dis

    def module_code(name, suffix):
        prefix = name.rpartition('.')[0].replace('.', '/')
        code = zipimport.zipimporter(_archive + ('/' + prefix if prefix else '')).get_code(name)
        if code is None or not code.co_filename.replace('\\', '/').endswith(suffix):
            raise ImportError('Not the installed service module: ' + name)
        return code

    def definition(code, name):
        matches = [value for value in code.co_consts
                   if isinstance(value, types.CodeType) and value.co_name == name]
        if len(matches) != 1:
            raise ImportError('Ambiguous installed service definition: ' + name)
        return matches[0]

    def literal_prefix(code, module_name):
        # Original classbody data prefix only, before its first method code.
        # Empty maps/lists are BUILD_MAP/BUILD_LIST, not co_consts objects.
        # Decode a closed literal instruction set; never execute the unrelated
        # method-definition/default/decorator graph or alter client bytecode.
        namespace, stack, offset = {}, [], 0
        while offset < len(code.co_code):
            opcode = ord(code.co_code[offset])
            offset += 1
            argument = None
            if opcode >= dis.HAVE_ARGUMENT:
                argument = ord(code.co_code[offset]) | ord(code.co_code[offset + 1]) << 8
                offset += 2
            operation = dis.opname[opcode]
            if operation == 'LOAD_CONST':
                value = code.co_consts[argument]
                if isinstance(value, types.CodeType):
                    if stack:
                        raise ImportError('Unexpected service method-default prefix')
                    return namespace
                if not isinstance(value, (type(None), bool, int, long, float, str, unicode, tuple)):
                    raise ImportError('Unexpected service class literal')
                stack.append(value)
            elif operation == 'LOAD_NAME' and code.co_names[argument] == '__name__':
                stack.append(module_name)
            elif operation == 'BUILD_MAP' and argument == 0:
                stack.append({})
            elif operation == 'BUILD_LIST':
                value = stack[-argument:] if argument else []
                if argument:
                    del stack[-argument:]
                stack.append(value)
            elif operation == 'STORE_NAME':
                namespace[code.co_names[argument]] = stack.pop()
            else:
                raise ImportError('Unsupported installed service class prefix: ' + operation)
        raise ImportError('Installed service class has no method boundary')

    constants = types.ModuleType('companion.selected_static_constants')
    constants.effectHiPower, constants.effectLoPower = high, low
    constants.effectMedPower, constants.effectSkillEffect = medium, skill
    clock = types.ModuleType('companion.service_wallclock')
    clock.GetWallclockTimeNow = wallclock
    host = types.ModuleType('companion.service_clock_capability')
    host.os = clock
    service_constants = {'__builtins__': __builtins__}
    types.FunctionType(module_code('carbon.common.script.sys.serviceConst',
                                   '/carbon/common/script/sys/serviceConst.py'), service_constants)()
    core_code = definition(module_code('carbon.common.script.sys.service',
                                      '/carbon/common/script/sys/service.py'), 'CoreService')
    core_globals = {'__name__': 'carbon.common.script.sys.service',
                    '__builtins__': __builtins__, 'blue': host, 'log': logging,
                    'prefs': preferences, 'SERVICE_STOPPED': service_constants['SERVICE_STOPPED']}
    core_namespace = literal_prefix(core_code, core_globals['__name__'])
    for name in ('__init__', 'InitService', '__getattr__', '__setattr__'):
        core_namespace[name] = types.FunctionType(definition(core_code, name), core_globals)
    core = type('CoreService', (object,), core_namespace)
    core_globals['CoreService'] = core
    # boot/counter services remain absent: the ORIGINAL static class has empty
    # config/counters. Their other branches are not a constructed capability.
    base_code = definition(module_code('eve.common.script.dogma.baseDogmaStaticSvc',
                                      '/eve/common/script/dogma/baseDogmaStaticSvc.py'), 'BaseDogmaStaticSvc')
    base_globals = {'__name__': 'eve.common.script.dogma.baseDogmaStaticSvc',
                    '__builtins__': __builtins__, 'Service': core, 'const': constants}
    base_namespace = literal_prefix(base_code, base_globals['__name__'])
    base_namespace['__init__'] = types.FunctionType(definition(base_code, '__init__'), base_globals)
    base = type('BaseDogmaStaticSvc', (core,), base_namespace)
    client_code = definition(module_code('eve.client.script.dogma.clientDogmaStaticSvc',
                                        '/eve/client/script/dogma/clientDogmaStaticSvc.py'), 'ClientDogmaStaticSvc')
    client = type('ClientDogmaStaticSvc', (base,), literal_prefix(client_code, 'eve.client.script.dogma.clientDogmaStaticSvc'))
    result = types.ModuleType('companion.static_constructor_types')
    result.CoreService, result.BaseDogmaStaticSvc, result.ClientDogmaStaticSvc = core, base, client
    return result


def _load_cfsd(name, pyd, data):
    # Called only with the JS provider's indexed, hashed local inputs. Keep the
    # original extension and its real heap wrappers; no JSON row projection.
    import imp, os
    module = imp.load_dynamic(name, pyd)
    if os.path.normcase(os.path.abspath(module.__file__)) != os.path.normcase(os.path.abspath(pyd)):
        raise ImportError('Installed cFSD module path differs: ' + name)
    result = module.load(data)
    if result is None:
        raise IOError('Installed cFSD loader returned no data: ' + name)
    return result


def _attach_static_attribute_data(service_types, raw, constant_values):
    import types
    from collections import defaultdict

    def module_code(name, suffix):
        prefix = name.rpartition('.')[0].replace('.', '/')
        code = zipimport.zipimporter(_archive + ('/' + prefix if prefix else '')).get_code(name)
        if code is None or not code.co_filename.replace('\\', '/').endswith(suffix):
            raise ImportError('Not the installed static data module: ' + name)
        return code

    def definition(code, name):
        matches = [value for value in code.co_consts
                   if isinstance(value, types.CodeType) and value.co_name == name]
        if len(matches) != 1:
            raise ImportError('Ambiguous installed static data definition: ' + name)
        return matches[0]

    # Execute the ORIGINAL memoizer, including its real native time/stdlib
    # cache semantics. Its optional locks import follows its own ImportError
    # path here; MemoizeWithLock is not selected or fabricated as available.
    from caching.memoize import Memoize as memoize

    loader_globals = {'__name__': 'fsdBuiltData.common.base',
                      '__builtins__': __builtins__, 'NO_BINARY_LOADER': object()}
    loader_code = definition(module_code('fsdBuiltData.common.base',
                                        '/packages/fsdBuiltData/common/base.py'), 'BuiltDataLoader')
    loader = type('BuiltDataLoader', (object,), types.FunctionType(loader_code, loader_globals)())
    # Prepare the real binary, then use the ORIGINAL cached GetData path. The
    # resource/autobuild/engine load and disk-watching paths remain unconfigured;
    # they are not replaced with a successful fake loader or a reload callback.
    data_source = module_code('dogma.data', '/packages/dogma/data.py')
    data = types.ModuleType('dogma.data')
    namespace = data.__dict__
    namespace.update({'__builtins__': __builtins__, 'defaultdict': defaultdict,
                      'dogmaAttributesLoader': sys.modules['dogmaAttributesLoader']})
    attributes_body = types.FunctionType(definition(data_source, 'DogmaAttributes'), namespace)
    attributes = type('DogmaAttributes', (loader,), attributes_body())
    attributes.__binary__ = raw
    namespace['DogmaAttributes'] = attributes
    namespace['attributeDataTypeTypeDamage'] = constant_values['attributeDataTypeTypeDamage']
    memoized = ('get_all_attributes_by_name', 'get_attribute_list_by_data_type',
                'get_charge_recharge_time_attributes_by_id')
    for name in ('_get_dogma_attributes', 'get_all_attributes', 'get_all_attributes_by_id',
                 'get_all_attributes_by_name', 'get_attribute_list_by_data_type',
                 'get_charge_recharge_time_attributes_by_id', 'get_attributes_by_charge_recharge_time_id'):
        function = types.FunctionType(definition(data_source, name), namespace)
        namespace[name] = memoize(function) if name in memoized else function
    base = service_types.BaseDogmaStaticSvc
    globals = base.__dict__['__init__'].func_globals
    for name, value in constant_values.iteritems():
        setattr(globals['const'], name, value)
    globals['dogma_data'] = data
    base_source = module_code('eve.common.script.dogma.baseDogmaStaticSvc',
                              '/eve/common/script/dogma/baseDogmaStaticSvc.py')
    base.LoadAttributes = types.FunctionType(definition(definition(base_source, 'BaseDogmaStaticSvc'),
                                                       'LoadAttributes'), globals)
    return data


def _attach_static_phases(service_types, data, raw_type_dogma, raw_effects, raw_types, constant_values):
    # Extend THIS client's original data namespace and classes. Native roots,
    # captured rows, defaultdict misses and memoizer lifetimes stay Python's.
    import types
    from collections import defaultdict, namedtuple
    from caching.memoize import Memoize as memoize

    def module_code(name, suffix):
        prefix = name.rpartition('.')[0].replace('.', '/')
        code = zipimport.zipimporter(_archive + ('/' + prefix if prefix else '')).get_code(name)
        if code is None or not code.co_filename.replace('\\', '/').endswith(suffix):
            raise ImportError('Not the installed static phase module: ' + name)
        return code

    def definition(code, name):
        matches = [value for value in code.co_consts
                   if isinstance(value, types.CodeType) and value.co_name == name]
        if len(matches) != 1:
            raise ImportError('Ambiguous installed static phase definition: ' + name)
        return matches[0]

    base = service_types.BaseDogmaStaticSvc
    base_globals = base.__dict__['__init__'].func_globals
    if base_globals['dogma_data'] is not data:
        raise ValueError('Static phase data belongs to another native service')
    const = base_globals['const']
    for name, value in constant_values.iteritems():
        setattr(const, name, value)
    namespace = data.__dict__
    loader = data.DogmaAttributes.__bases__[0]
    source = module_code('dogma.data', '/packages/dogma/data.py')
    for name, extension, raw in (('TypeDogma', 'typeDogmaLoader', raw_type_dogma),
                                 ('DogmaEffects', 'dogmaEffectsLoader', raw_effects)):
        namespace[extension] = sys.modules[extension]
        body = types.FunctionType(definition(source, name), namespace)
        cls = type(name, (loader,), body())
        cls.__binary__ = raw
        namespace[name] = cls

    # Actual installed evetypes physical getters and exceptions. Its other
    # localization/group/engine APIs are not fabricated by this selected host.
    evetypes = types.ModuleType('evetypes')
    type_globals = evetypes.__dict__
    type_globals['__builtins__'] = __builtins__
    types_data = types.ModuleType('evetypes.data')
    types_data.__dict__.update({'__builtins__': __builtins__, 'typesLoader': sys.modules['typesLoader']})
    type_source = module_code('evetypes.data', '/packages/evetypes/data.py')
    body = types.FunctionType(definition(type_source, 'Types'), types_data.__dict__)
    types_data.Types = type('Types', (loader,), body())
    types_data.Types.__binary__ = raw_types
    type_globals['Types'] = types_data.Types
    evetypes.data = types_data
    type_source = module_code('evetypes', '/packages/evetypes/__init__.py')
    for name in ('TypeNotFoundException', 'TypeAttributeNotFoundException'):
        body = types.FunctionType(definition(type_source, name), type_globals)
        type_globals[name] = type(name, (Exception,), body())
    for name in ('GetTypes', 'GetType', '_GetAttributeForType', 'Exists',
                 'GetMass', 'GetCapacity', 'GetVolume', 'GetRadius'):
        type_globals[name] = types.FunctionType(definition(type_source, name), type_globals)
    namespace['evetypes'] = evetypes
    identity = types.ModuleType('dogma.identity')
    identity.__dict__['__builtins__'] = __builtins__
    identity_source = module_code('dogma.identity', '/packages/dogma/identity.py')
    namespace['get_safe_dogma_identity'] = types.FunctionType(
        definition(identity_source, 'get_safe_dogma_identity'), identity.__dict__)
    namespace['DogmaTypeAttribute'] = namedtuple('DogmaTypeAttribute', ['attributeID', 'value'])
    namespace['DogmaTypeAttribute'].__module__ = 'dogma.data'
    for name in ('attributeMass', 'attributeCapacity', 'attributeVolume', 'attributeRadius'):
        namespace[name] = constant_values[name]
    memoized = ('get_type_attributes', 'get_type_attributes_by_id',
                'get_all_effects_by_name', 'get_all_effects_by_id', 'get_all_type_ids_and_effects',
                'get_effects_indexed_by_type_id_and_effect_id', 'get_effects_indexed_by_effect_id_and_type_id')
    for name in ('_get_type_dogma', 'get_type_dogma', 'get_type_attributes',
                 'has_type_attributes', 'get_type_attributes_by_id', 'get_type_attribute',
                 '_get_effects', 'get_all_effects_by_name', 'get_all_effects_by_id',
                 'get_all_type_ids_and_effects', 'get_effects_indexed_by_type_id_and_effect_id',
                 'get_effects_indexed_by_effect_id_and_type_id'):
        defaults = (None,) if name == 'get_type_attribute' else None
        function = types.FunctionType(definition(source, name), namespace, name, defaults)
        namespace[name] = memoize(function) if name in memoized else function

    client_globals = {'__name__': 'eve.client.script.dogma.clientDogmaStaticSvc',
                      '__builtins__': __builtins__, 'defaultdict': defaultdict,
                      'dogma_data': data, 'const': const, 'evetypes': evetypes}
    client_source = module_code('eve.client.script.dogma.clientDogmaStaticSvc',
                                '/eve/client/script/dogma/clientDogmaStaticSvc.py')
    for name in ('AttributesByTypeLookupDict', 'AttributesByTypeAttribute'):
        body = types.FunctionType(definition(client_source, name), client_globals)
        client_globals[name] = type(name, (defaultdict,), body())
    client_code = definition(client_source, 'ClientDogmaStaticSvc')
    service_types.ClientDogmaStaticSvc.LoadTypeAttributes = types.FunctionType(
        definition(client_code, 'LoadTypeAttributes'), client_globals)
    base_source = definition(module_code('eve.common.script.dogma.baseDogmaStaticSvc',
                                        '/eve/common/script/dogma/baseDogmaStaticSvc.py'), 'BaseDogmaStaticSvc')
    for name in ('get_effects_indexed_by_type_id_and_effect_id', 'get_effects_indexed_by_effect_id_and_type_id'):
        base_globals[name] = namespace[name]
    base_globals['evetypes'] = evetypes
    for name in ('LoadEffects', 'LoadTypeEffects', 'GetTypeAttribute', 'GetTypeAttribute2', 'GetTypeAttributes'):
        defaults = (False,) if name == 'LoadTypeEffects' else (None,) if name == 'GetTypeAttribute' else None
        setattr(base, name, types.FunctionType(definition(base_source, name), base_globals, name, defaults))
    return evetypes


def _create_localization_settings(boot_root, preferences):
    # Actual read-only start/common INI snapshots and private original helper
    # namespaces. This is a settings/cleaner field phase, not eveprefs.Init or
    # Localization.LoadLanguageData, a parser, session or engine readiness.
    import types, re, __builtin__
    boot = eveprefs.Handler(IniIniFile('start', boot_root, 1))
    common = IniIniFile('common', boot_root, 1)
    boot.keyval.update(common.keyval)

    def module_code(name, suffix):
        prefix = name.rpartition('.')[0].replace('.', '/')
        code = zipimport.zipimporter(_archive + ('/' + prefix if prefix else '')).get_code(name)
        if code is None or not code.co_filename.replace('\\', '/').endswith(suffix):
            raise ImportError('Not the installed localization settings module: ' + name)
        return code

    def definition(code, name):
        matches = [value for value in code.co_consts
                   if isinstance(value, types.CodeType) and value.co_name == name]
        if len(matches) != 1:
            raise ImportError('Ambiguous installed localization definition: ' + name)
        return matches[0]

    # Only this private import binding supplies real owners. Never replace the
    # process-global eveprefs.boot/prefs used by other emulated clients.
    owned_prefs = types.ModuleType('eveprefs')
    owned_prefs.boot, owned_prefs.prefs = boot, preferences
    original_import = __builtin__.__import__

    def owner_import(name, globals=None, locals=None, fromlist=(), level=-1):
        if name == 'eveprefs':
            return owned_prefs
        return original_import(name, globals, locals, fromlist, level)

    builtins = dict(__builtin__.__dict__)
    builtins['__import__'] = owner_import

    def original_module(name, suffix):
        module = types.ModuleType(name)
        # These private namespaces are not registered as application packages.
        # Their original imports are absolute; avoid Python2's implicit relative
        # lookup through an unrelated/missing shared localization package.
        module.__package__ = ''
        module.__dict__['__builtins__'] = builtins
        types.FunctionType(module_code(name, suffix), module.__dict__)()
        return module

    internal = original_module('localization.internalUtil', '/packages/localization/internalUtil.py')
    qa = original_module('localization.settings.qaSettings', '/packages/localization/settings/qaSettings.py')
    bilingual = original_module('localization.settings.bilingualSettings', '/packages/localization/settings/bilingualSettings.py')
    constants = original_module('localization.const', '/packages/localization/const.py')
    commonutils = types.ModuleType('carbon.common.script.util.commonutils')
    commonutils.__dict__.update({'__builtins__': builtins, 're': re})
    source = module_code('carbon.common.script.util.commonutils', '/carbon/common/script/util/commonutils.py')
    commonutils.StripTags = types.FunctionType(definition(source, 'StripTags'), commonutils.__dict__, 'StripTags', ((), ()))
    namespace = {'__name__': 'localization.localizationBase', '__builtins__': builtins,
                 'internalUtil': internal, 'qaSettings': qa, 'bilingualSettings': bilingual,
                 'commonutils': commonutils, 'locconst': constants}
    source = definition(module_code('localization.localizationBase', '/packages/localization/localizationBase.py'), 'Localization')
    methods = {'__module__': 'companion.localization_settings'}
    for name in ('_GetPrimaryLanguage', 'HighlightImportant', 'UseImportantTooltip',
                 '_QaTooltipOverride', 'CleanImportantMarkup'):
        methods[name] = types.FunctionType(definition(source, name), namespace)
    selected = type('ClientLocalizationSettings', (object,), methods)()
    # The four source constructor setting fields, plus the actual original
    # primary-language constant used by settings comparisons. No text/language
    # parser is published or told that its data has loaded by this operation.
    selected._importantNameSetting = None
    selected._languageTooltipSetting = None
    selected._qaTooltipOverride = None
    selected._highlightImportantSetting = None
    selected._primaryLanguageID = selected._GetPrimaryLanguage()
    result = types.ModuleType('companion.localization_settings_owner')
    result.boot, result.common, result.preferences = boot, common, preferences
    result.internal, result.qa, result.bilingual = internal, qa, bilingual
    result.settings, result.constants, result.commonutils = selected, constants, commonutils
    return result


def _prepare_localization_data(extension, main_filename, english_filename):
    # Explicit host extension/indexed-file I/O phase. The actual installed
    # cPickle and native module own full tuples, metadata and token dictionaries.
    # This does not execute Blue.LoadExtension/ResFile/statistics zones or the
    # original Localization loader/constructor and does not register handlers.
    import imp, os, cPickle, types
    backend = imp.load_dynamic('_evelocalization', extension)
    if os.path.normcase(os.path.abspath(backend.__file__)) != os.path.normcase(os.path.abspath(extension)):
        raise ImportError('Installed localization module path differs')
    with open(main_filename, 'rb') as source:
        main = cPickle.loads(source.read())
    with open(english_filename, 'rb') as source:
        english = cPickle.loads(source.read())
    if not isinstance(main, dict) or not isinstance(english, tuple) or len(english) != 2 or english[0] != 'en-us' or not isinstance(english[1], dict):
        raise ValueError('Unexpected installed main/English localization data')
    backend.SetPrimaryLanguage(english[0])
    backend.LoadMessageData(*english)
    result = types.ModuleType('companion.native_localization_data')
    result.backend, result.main, result.english = backend, main, english
    return result


def _create_session_context(field_state=None):
    # Original localstorage/Sissy, with actual Stackless getcurrent and a
    # PRIVATE builtin namespace. The bounded transport-field object is not a
    # constructed CoreSession, its default policy or engine lifecycle.
    import types, __builtin__, stackless
    if hasattr(stackless.getcurrent(), 'localStorage'):
        raise RuntimeError('Per-tasklet shared localStorage requires an owned entry context')
    owned_builtins = types.ModuleType('__builtin__')
    owned_builtins.__dict__.update(__builtin__.__dict__)
    source = zipimport.zipimporter(_archive).get_code('localstorage')
    if source is None or not source.co_filename.replace('\\', '/').endswith('/packages/localstorage/__init__.py'):
        raise ImportError('Not the installed localstorage module')
    storage = types.ModuleType('localstorage')
    storage.__dict__.update({'__builtins__': __builtin__.__dict__, '__package__': '',
                             '_CLIENT_IMPORT_BINDINGS': {'__builtin__': owned_builtins}})
    types.FunctionType(source, storage.__dict__)()
    fields = field_state if field_state is not None else type('CurrentTransportSessionFields', (object,), {'__module__': 'companion.transport_session_fields'})()

    def assert_entry():
        # Stackless creates a new current tasklet at separate embedding calls.
        # The native addon enforces one Node environment/Windows owner thread;
        # ORIGINAL GetLocalStorage uses this namespace's real main fallback.
        if hasattr(stackless.getcurrent(), 'localStorage'):
            raise RuntimeError('Session context requires native owner entries without shared tasklet storage')

    def publish(values):
        assert_entry()
        fields.__dict__.clear()
        fields.__dict__.update(values)
        storage.GetLocalStorage()['base.session'] = fields

    def retire():
        assert_entry()
        storage.GetLocalStorage().pop('base.session', None)

    result = types.ModuleType('companion.session_context')
    result.localstorage, result.builtins = storage, owned_builtins
    result.session, result.fields = owned_builtins.session, fields
    result.publish, result.retire, result.assert_entry = publish, retire, assert_entry
    return result


def _create_effective_session_context(preferences, boot):
    # A named FIELD phase, not Session.__init__/__ChangeAttribute or the engine
    # lifecycle. Definitions/literals and pure field helpers are original code;
    # clocks, indexes, history, masquerades and service broadcasts are not run.
    import types, __builtin__, dis

    def module_code(name, suffix):
        prefix = name.rpartition('.')[0].replace('.', '/')
        code = zipimport.zipimporter(_archive + ('/' + prefix if prefix else '')).get_code(name)
        if code is None or not code.co_filename.replace('\\', '/').endswith(suffix):
            raise ImportError('Not the installed session field module: ' + name)
        return code

    def definition(code, name):
        matches = [value for value in code.co_consts if type(value) is types.CodeType and value.co_name == name]
        if len(matches) != 1:
            raise ImportError('Ambiguous installed session field definition: ' + name)
        return matches[0]

    constants = types.ModuleType('carbon.common.script.sys.serviceConst')
    constants.__dict__['__builtins__'] = __builtin__.__dict__
    types.FunctionType(module_code(constants.__name__, '/carbon/common/script/sys/serviceConst.py'), constants.__dict__)()
    session_constants = types.ModuleType('carbon.common.lib.session')
    session_constants.__dict__['__builtins__'] = __builtin__.__dict__
    types.FunctionType(module_code(session_constants.__name__, '/carbon/common/lib/session.py'), session_constants.__dict__)()
    stringutil = types.ModuleType('stringutil')
    stringutil.__dict__['__builtins__'] = __builtin__.__dict__
    types.FunctionType(module_code('stringutil', '/packages/stringutil/__init__.py'), stringutil.__dict__)()
    # machobase's actual mode assignment is boot.role. This selected data input
    # does not import/construct its network, locks or blue engine dependencies.
    mode = types.ModuleType('companion.installed_client_mode')
    mode.mode = boot.role
    if mode.mode != 'client':
        raise ValueError('Effective client fields require installed boot.role client')
    namespace = {'__name__': 'carbon.common.script.sys.basesession', '__builtins__': __builtin__.__dict__,
                 'ROLE_LOGIN': constants.ROLE_LOGIN, 'prefs': preferences, 'strx': stringutil.strx, 'machobase': mode}
    source = module_code('carbon.common.script.sys.basesession', '/carbon/common/script/sys/basesession.py')
    # Class bodies only create definitions and literals. No whole module import:
    # basesession also starts an ObjectKillah scheduler at module scope.
    core = types.ClassType('CoreSession', (), types.FunctionType(definition(source, 'CoreSession'), namespace)())
    namespace['CoreSession'] = core
    original = types.ClassType('Session', (core,), types.FunctionType(definition(source, 'Session'), namespace)())
    selected = {'__module__': 'companion.effective_session_fields',
                '__persistvars__': original.__persistvars__,
                '__attributesWithDefaultValueOfZero__': original.__attributesWithDefaultValueOfZero__}
    for name in ('GetDefaultValueOfAttribute', 'ComputeNotifySets'):
        selected[name] = core.__dict__[name]
    selected['__repr__'] = core.__dict__['__repr__']
    for name in ('RecalculateDependantAttributes', 'RecalculateDependantAttributesWithChanges'):
        selected[name] = original.__dict__[name]
    state = type('EffectiveTransportSessionFields', (object,), selected)()
    for name in original.__persistvars__ + ['locationid', 'corprole']:
        state.__dict__[name] = state.GetDefaultValueOfAttribute(name)
    state.__dict__['sessionType'] = session_constants.SESSION_TYPE_GAME

    def display_list(name):
        # Read only the original constructor's closed literal assignment.
        # Do not execute a sliced constructor or invent its engine fields.
        code = original.__dict__['__init__'].func_code
        instructions, cursor = [], 0
        while cursor < len(code.co_code):
            opcode = ord(code.co_code[cursor])
            cursor += 1
            argument = None
            if opcode >= dis.HAVE_ARGUMENT:
                argument = ord(code.co_code[cursor]) | (ord(code.co_code[cursor + 1]) << 8)
                cursor += 2
            if opcode == dis.opmap['EXTENDED_ARG']:
                raise ImportError('Unsupported session display literal instruction')
            instructions.append((opcode, argument))
        positions = [i for i, (op, arg) in enumerate(instructions)
                     if op == dis.opmap['STORE_ATTR'] and code.co_names[arg] == name]
        if len(positions) != 1:
            raise ImportError('Ambiguous session display list: ' + name)
        index = positions[0]
        if instructions[index - 1] != (dis.opmap['LOAD_FAST'], 0) or instructions[index - 2][0] != dis.opmap['BUILD_LIST']:
            raise ImportError('Unexpected session display assignment: ' + name)
        count = instructions[index - 2][1]
        entries = instructions[index - 2 - count:index - 2]
        if len(entries) != count or any(op != dis.opmap['LOAD_CONST'] or type(code.co_consts[arg]) is not str for op, arg in entries):
            raise ImportError('Session display list is not a closed string literal: ' + name)
        return [code.co_consts[arg] for op, arg in entries]

    state.additionalAttributesToPrint = display_list('additionalAttributesToPrint')
    state.additionalHexAttributes = display_list('additionalHexAttributes')
    result = _create_session_context(state)

    def restore_current():
        result.assert_entry()
        result.localstorage.GetLocalStorage()['base.session'] = state

    def receive(changes, initial):
        result.assert_entry()
        if state.role & constants.ROLE_SERVICE:
            raise RuntimeError('A service session cannot receive client field changes')
        if initial:
            state.RecalculateDependantAttributes(changes)
        else:
            state.RecalculateDependantAttributesWithChanges(changes)
        notify, disappeared = state.ComputeNotifySets(changes, pairs=not initial)
        if 'userid' in notify and notify['userid'][0] and notify['userid'][1]:
            raise RuntimeError("A session's userID may not change")
        # The bounded field commit retains the EXACT old object on native ==.
        # This is deliberately not __ChangeAttribute's simclock/index lifecycle.
        for name in notify:
            state.__dict__[name] = changes[name] if initial else changes[name][1]
        result.last_notify, result.last_disappeared = notify, disappeared
        restore_current()
        return notify, disappeared

    del result.publish  # Effective state is never rebuilt from a raw snapshot.
    result.restore_current, result.receive = restore_current, receive
    result.wire_pair = lambda old, new: (old, new)
    result.preferences, result.boot, result.source_classes = preferences, boot, (core, original)
    result.last_notify, result.last_disappeared = {}, set()
    restore_current()
    return result


def _create_std_logging(logmodule, preferences, context):
    # Entire original stdlib logging namespace per client: real root, Manager,
    # locks, Handler, records, exception handling and atexit registration. No
    # shared logging.root broadcast and no replacement formatter/error sink.
    import types, __builtin__, os
    context.assert_entry()
    if context.preferences is not preferences or context.boot.role != 'client':
        raise ValueError('Logging must share actual effective client field owners')

    def module_code(name, suffix):
        prefix = name.rpartition('.')[0].replace('.', '/')
        importer = zipimport.zipimporter(_archive + ('/' + prefix if prefix else ''))
        code = importer.get_code(name)
        if code is None or not code.co_filename.replace('\\', '/').endswith(suffix):
            raise ImportError('Not the installed logging dependency: ' + name)
        return importer, code

    def definition(code, name):
        matches = [value for value in code.co_consts if type(value) is types.CodeType and value.co_name == name]
        if len(matches) != 1:
            raise ImportError('Ambiguous installed logging definition: ' + name)
        return matches[0]

    owned_prefs = types.ModuleType('eveprefs')
    owned_prefs.boot, owned_prefs.prefs = context.boot, preferences
    bindings = {'__builtin__': context.builtins, 'eveprefs': owned_prefs}
    # These original absolute dependencies are shared real modules. Resolve
    # them explicitly so Python2 does not attempt implicit relative lookup in
    # private application packages that are deliberately absent from sys.modules.
    for dependency in ('sys', 'os', 'time', 'cStringIO', 'traceback', 'warnings',
                       'weakref', 'codecs', 'thread', 'threading', 'atexit',
                       'fnmatch', 'zlib', 'traceback2', 'stringutil'):
        bindings[dependency] = _client_import_fallback(dependency, globals(), locals(), (), 0)

    def original_module(name, suffix):
        importer, code = module_code(name, suffix)
        module = types.ModuleType(name)
        # Preserve actual zipimport metadata, including .pyj __file__. Its
        # logging._srcfile need not equal embedded BuildAgent co_filename.
        filename, package = importer.get_filename(name), importer.is_package(name)
        module.__file__, module.__loader__ = filename, importer
        module.__package__ = name if package else name.rpartition('.')[0]
        if package:
            module.__path__ = [os.path.dirname(filename)]
        module.__dict__.update({'__builtins__': __builtin__.__dict__,
                                '_CLIENT_IMPORT_BINDINGS': bindings,
                                'session': context.session})
        if name == 'stdlogutils':
            # Both absolute devenv and stdlogutils/devenv are absent from the
            # pinned archive. Perform the real failed absolute import without
            # a private-parent warning; the original try/except still runs.
            module.__dict__['_CLIENT_ABSOLUTE_IMPORT_NAMES'] = ('devenv',)
        types.FunctionType(code, module.__dict__)()
        return module

    logging = original_module('logging', '/stdlib/logging/__init__.py')
    bindings['logging'] = logging
    helpers = original_module('brennivin.logutils', '/packages/brennivin/logutils.py')
    bindings['brennivin.logutils'] = helpers
    stdlogutils = original_module('stdlogutils', '/packages/stdlogutils/__init__.py')
    bindings['stdlogutils'] = stdlogutils
    _, code = module_code('stdlogutils.logserver', '/packages/stdlogutils/logserver.py')
    logserver = types.ModuleType('stdlogutils.logserver')
    namespace = logserver.__dict__
    namespace.update({'__builtins__': __builtin__.__dict__, '_CLIENT_IMPORT_BINDINGS': bindings,
                      'logging': logging, 'stdlogutils': stdlogutils,
                      'ChannelWrapper': logmodule.ChannelWrapper})
    # Original source LEVEL_MAP resolves these real logging/channel constants.
    namespace['LEVEL_MAP'] = {logging.CRITICAL: logmodule.LGERR, logging.ERROR: logmodule.LGERR,
                             logging.WARNING: logmodule.LGWARN, logging.INFO: logmodule.LGINFO,
                             logging.DEBUG: logmodule.LGINFO, logging.NOTSET: logmodule.LGINFO}
    body = types.FunctionType(definition(code, 'LogServerHandler'), namespace)()
    namespace['LogServerHandler'] = type('LogServerHandler', (logging.Handler,), body)
    for name in ('GetLoggingLevelFromPrefs', 'InitLoggingToLogserver'):
        namespace[name] = types.FunctionType(definition(code, name), namespace)
    # Same original startup order as autoexec: init the EXISTING wrapper/mask,
    # then install original handler/FMT_EVE with original preference mapping.
    logmodule.init(context.boot.role, preferences)
    logserver.InitLoggingToLogserver(logserver.GetLoggingLevelFromPrefs())
    result = types.ModuleType('companion.std_logging_owner')
    result.logging, result.stdlogutils, result.logserver = logging, stdlogutils, logserver
    result.formatter, result.root = stdlogutils.Fmt.FMT_EVE, logging.root
    result.context, result.preferences, result.boot = context, preferences, context.boot
    return result


def _attach_error_logging(logmodule, stdlogutils, context, tasklet_timer, arguments):
    # Original selected error graph on the EXISTING logmodule and owners.
    # This is the client/pre-UI profile, not SettingsSvc/ServiceManager startup,
    # scheduler/popups/alerts, memory diagnostics or a constructed Blue engine.
    import types, __builtin__, datetime, traceback2, cStringIO

    def module_code(name, suffix):
        prefix = name.rpartition('.')[0].replace('.', '/')
        code = zipimport.zipimporter(_archive + ('/' + prefix if prefix else '')).get_code(name)
        if code is None or not code.co_filename.replace('\\', '/').endswith(suffix):
            raise ImportError('Not the installed error logging dependency: ' + name)
        return code

    def definition(code, name):
        matches = [value for value in code.co_consts if type(value) is types.CodeType and value.co_name == name]
        if len(matches) != 1:
            raise ImportError('Ambiguous installed error logging definition: ' + name)
        return matches[0]

    if type(arguments) is not list or not arguments or any(type(arg) is not unicode for arg in arguments):
        raise TypeError('Actual companion startup arguments must be a nonempty Unicode list')
    startup_args = tuple(arguments)
    startup_map = {}
    # Source-backed companion input port: BlueOS.SetStartupArgs2080+, skip argv0,
    # remove ONE slash, split FIRST '=', case-sensitive names. Real host inputs,
    # not empty/always-false flags or ExeFile/@ expansion/BlueOS construction.
    for arg in startup_args[1:]:
        name = arg[1:] if arg.startswith(u'/') else arg
        name, separator, value = name.partition(u'=')
        startup_map[name] = value

    def get_args():
        # BluePython.PyGetArg1544 returns a fresh Unicode list. The append/slice
        # also copies native Unicode contents without changing surrogate units.
        return [(arg + u'\0')[:-1] for arg in startup_args]

    def has_argument(name):
        return name in startup_map

    startup = types.ModuleType('companion.log_startup_inputs')
    startup.arguments, startup.map = startup_args, startup_map
    startup.GetArg, startup.HasStartupArg = get_args, has_argument
    pyos = types.ModuleType('companion.error_pyos_inputs')
    pyos.taskletTimer, pyos.GetArg = tasklet_timer, get_args
    os_inputs = types.ModuleType('companion.error_os_inputs')
    os_inputs.HasStartupArg = has_argument
    blue_inputs = types.ModuleType('companion.error_blue_inputs')
    blue_inputs.pyos, blue_inputs.os = pyos, os_inputs

    bunch_module = types.ModuleType('carbonui.util.bunch')
    bunch_module.__dict__['__builtins__'] = __builtin__.__dict__
    types.FunctionType(module_code('carbonui.util.bunch', '/packages/carbonui/util/bunch.py'), bunch_module.__dict__)()
    # Actual SettingsSvc.LoadSettings prefix creates Bunch before section load.
    # Do not invent/alias public.generic as top-level generic or claim files,
    # YAML, autotimers, settings services or browser dialog initialization.
    if hasattr(context.builtins, 'settings'):
        raise RuntimeError('Existing settings namespace needs its actual source owner')
    settings = bunch_module.Bunch()
    context.builtins.settings = settings

    error_globals = {'__name__': 'eveexceptions', '__builtins__': __builtin__.__dict__, 'types': types}
    # Preserve the original conditional strx selection, not stringutil.strx.
    error_globals['strx'] = getattr(context.builtins, 'strx', str)
    error_source = module_code('eveexceptions', '/packages/eveexceptions/__init__.py')
    user_error = type('UserError', (StandardError,), types.FunctionType(definition(error_source, 'UserError'), error_globals)())
    error_globals['UserError'] = user_error

    namespace = logmodule.__dict__
    namespace.update({'__builtins__': __builtin__.__dict__, '__builtin__': context.builtins,
                      '_CLIENT_IMPORT_BINDINGS': dict(stdlogutils.__dict__['_CLIENT_IMPORT_BINDINGS']),
                      'blue': blue_inputs, 'localstorage': context.localstorage,
                      'session': context.session, 'settings': settings,
                      'sys': sys, 'datetime': datetime, 'traceback2': traceback2,
                      'StringIO': cStringIO.StringIO, 'UserError': user_error,
                      'GetStack': stdlogutils.GetStack, 'NextTraceID': stdlogutils.NextTraceID,
                      'DATETIME_FORMAT_STR': '%m/%d/%Y %H:%M:%S', '_WIN_EBADF': 9,
                      'logExceptionLevel': 0, 'sentry_client': None, 'postStackTraceAll': None})
    namespace['_CLIENT_IMPORT_BINDINGS'].update({'blue': blue_inputs, 'localstorage': context.localstorage, 'logmodule': logmodule})
    source = module_code('logmodule', '/packages/logmodule/__init__.py')
    for name in ('Multiplex', 'MsgWindowStream', 'LogAlertServiceStream'):
        namespace[name] = type(name, (object,), types.FunctionType(definition(source, name), namespace)())
    for name in ('GetMultiplex', '_LogThreadLocals', 'MsgWindowStreamToMsgWindow', '_LogException',
                 'LogException', 'LogTraceback', 'DumpMemoryStatus', 'DumpMemHistory'):
        defaults = None
        if name == 'LogException':
            defaults = ('', 'general', 1, 1, None, 1, None, None, None, None, 1)
        elif name == 'LogTraceback':
            defaults = ('', 'general', 1, None, 1, 0, None, logmodule.LGERR, 1, None)
        namespace[name] = types.FunctionType(definition(source, name), namespace, name, defaults)

    def assert_profile():
        context.assert_entry()
        if hasattr(context.builtins, 'sm') or settings.has_key('generic'):
            raise RuntimeError('Active settings/service-manager logging needs its real loaded providers')
        if logmodule.MsgWindowStreamToMsgWindow():
            raise RuntimeError('Enabled exception popups require a real scheduler/UI producer')

    assert_profile()
    logger = types.ModuleType('localization.logger')
    logger.__dict__.update({'__builtins__': __builtin__.__dict__, '__package__': '',
                            '_CLIENT_IMPORT_BINDINGS': namespace['_CLIENT_IMPORT_BINDINGS']})
    types.FunctionType(module_code('localization.logger', '/packages/localization/logger.py'), logger.__dict__)()
    result = types.ModuleType('companion.error_logging_owner')
    result.logmodule, result.localization_logger, result.UserError = logmodule, logger, user_error
    result.settings, result.startup, result.blue = settings, startup, blue_inputs
    result.assert_profile, result.context, result.stdlogutils = assert_profile, context, stdlogutils

    def traceback_entry(*args):
        # A genuine companion entry frame for original extract_stack(up=1).
        # The installed function and its defaults/caller traversal stay intact.
        assert_profile()
        return logmodule.LogTraceback(*args)

    def exception_entry(*args):
        assert_profile()
        return logmodule.LogException(*args)

    result.traceback_entry, result.exception_entry = traceback_entry, exception_entry
    return result


def _attach_localization_lookup(settings_owner, data, standard_logging, logmodule, logger, context, startup):
    # Named lookup/data phase on the SAME settings instance; not its full
    # Localization constructor/LoadLanguageData, property handlers or Blue engine.
    import types, __builtin__, os, dis, re
    context.assert_entry()
    if context.preferences is not settings_owner.preferences or context.boot is not settings_owner.boot:
        raise ValueError('Localization must retain the actual early settings/session owners')

    def code_for(name, suffix):
        prefix = name.rpartition('.')[0].replace('.', '/')
        importer = zipimport.zipimporter(_archive + ('/' + prefix if prefix else ''))
        code = importer.get_code(name)
        if code is None or not code.co_filename.replace('\\', '/').endswith(suffix):
            raise ImportError('Not the installed localization lookup dependency: ' + name)
        return importer, code

    def definition(code, name):
        matches = [v for v in code.co_consts if type(v) is types.CodeType and v.co_name == name]
        if len(matches) != 1:
            raise ImportError('Ambiguous installed lookup definition: ' + name)
        return matches[0]

    def instructions(code):
        result, cursor = [], 0
        while cursor < len(code.co_code):
            opcode = ord(code.co_code[cursor])
            cursor += 1
            argument = None
            if opcode >= dis.HAVE_ARGUMENT:
                argument = ord(code.co_code[cursor]) | ord(code.co_code[cursor + 1]) << 8
                cursor += 2
            if opcode == dis.EXTENDED_ARG:
                raise ImportError('Unsupported lookup literal instruction')
            result.append((dis.opname[opcode], argument))
        return result

    def literal(code, name):
        rows = instructions(code)
        stores = [i for i, (op, arg) in enumerate(rows) if op == 'STORE_NAME' and code.co_names[arg] == name]
        if len(stores) != 1 or rows[stores[0] - 1][0] != 'LOAD_CONST':
            raise ImportError('Not a closed lookup literal: ' + name)
        return code.co_consts[rows[stores[0] - 1][1]]

    # Fresh BluePyOS policy bool is source/shipped false; its Startup enables
    # by argument PRESENCE, not value. This is a selected companion policy port
    # over real captured host inputs, NOT a native getter or ExeFile invocation.
    policy = types.ModuleType('companion.fresh_localization_telemetry_policy')
    policy.markupZonesInPython = False
    if startup.HasStartupArg('telemetryMarkup'):
        policy.markupZonesInPython = True
    if policy.markupZonesInPython:
        raise RuntimeError('Telemetry markup requires a real statistics zone producer')
    blue_policy = types.ModuleType('companion.localization_policy_inputs')
    blue_policy.pyos = policy
    owned_prefs = types.ModuleType('eveprefs')
    owned_prefs.boot, owned_prefs.prefs = context.boot, settings_owner.preferences
    bindings = {'logging': standard_logging, 'eveprefs': owned_prefs, '__builtin__': context.builtins,
                'localstorage': context.localstorage, 'blue': blue_policy}
    for name in ('operator', 'contextlib', 'functools', 'types'):
        bindings[name] = _client_import_fallback(name, globals(), locals(), (), 0)

    def shell(name, suffix):
        importer, code = code_for(name, suffix)
        module = types.ModuleType(name)
        filename, package = importer.get_filename(name), importer.is_package(name)
        module.__file__, module.__loader__ = filename, importer
        module.__package__ = name if package else name.rpartition('.')[0]
        if package:
            module.__path__ = [os.path.dirname(filename)]
        module.__dict__.update({'__builtins__': __builtin__.__dict__, '_CLIENT_IMPORT_BINDINGS': bindings,
                                'session': context.session})
        return module, code

    langutils, root_code = shell('langutils', '/packages/langutils/__init__.py')
    bindings['langutils'] = langutils
    modules = []
    for name in ('comfylang', 'langconst', 'logic'):
        module, code = shell('langutils.' + name, '/packages/langutils/' + name + '.py')
        setattr(langutils, name, module)
        bindings[name], bindings['langutils.' + name] = module, module
        modules.append((module, code))
    langutils.__dict__['_CLIENT_RELATIVE_IMPORT_BINDINGS'] = {name: getattr(langutils, name) for name in ('comfylang', 'langconst', 'logic')}
    for module, code in modules:
        types.FunctionType(code, module.__dict__)()
    types.FunctionType(root_code, langutils.__dict__)()
    zoning, zoning_code = shell('pytelemetry.zoning', '/packages/pytelemetry/zoning.py')
    types.FunctionType(zoning_code, zoning.__dict__)()
    settings_package = types.ModuleType('localization.settings')
    settings_package.qaSettings, settings_package.bilingualSettings = settings_owner.qa, settings_owner.bilingual
    uiutil = types.ModuleType('localization.uiutil')
    uiutil.__dict__.update({'__builtins__': __builtin__.__dict__, 'settings': settings_package})
    _, ui_code = code_for('localization.uiutil', '/packages/localization/uiutil.py')
    uiutil.PrepareLocalizationSafeString = types.FunctionType(definition(ui_code, 'PrepareLocalizationSafeString'), uiutil.__dict__, 'PrepareLocalizationSafeString', (None,))
    _, source = code_for('localization.localizationBase', '/packages/localization/localizationBase.py')
    cls = definition(source, 'Localization')
    # Recover the actual eight Unicode strings from the closed original dict
    # expression; never use the corrupted non-English decompiler rendering.
    rows = instructions(source)
    stores = [i for i, (op, arg) in enumerate(rows) if op == 'STORE_NAME' and source.co_names[arg] == 'FALLBACK_TRANSLATION_STRINGS']
    if len(stores) != 1:
        raise ImportError('Ambiguous original fallback dictionary')
    end = stores[0]
    start = max(i for i, (op, arg) in enumerate(rows[:end]) if op == 'BUILD_MAP')
    stack = []
    for op, arg in rows[start:end]:
        if op == 'BUILD_MAP' and not stack:
            stack.append({})
        elif op == 'LOAD_CONST':
            stack.append(source.co_consts[arg])
        elif op == 'STORE_MAP' and len(stack) == 3 and type(stack[0]) is dict:
            key, value = stack.pop(), stack.pop()
            stack[0][key] = value
        else:
            raise ImportError('Fallback dictionary is not a closed constant expression')
    if len(stack) != 1 or type(stack[0]) is not dict or len(stack[0]) != 8:
        raise ImportError('Unexpected original fallback dictionary')
    _, common = code_for('localization.common.util', '/packages/localization/common/util.py')
    constants, constants_code = shell('carbon.common.script.sys.serviceConst', '/carbon/common/script/sys/serviceConst.py')
    types.FunctionType(constants_code, constants.__dict__)()
    namespace = {'__name__': 'localization.localizationBase', '__builtins__': __builtin__.__dict__,
                 '_CLIENT_IMPORT_BINDINGS': bindings, 'session': context.session,
                 'boot': context.boot, 'prefs': settings_owner.preferences, 'langutils': langutils,
                 'internalUtil': settings_owner.internal, 'qaSettings': settings_owner.qa,
                 'bilingualSettings': settings_owner.bilingual, 'commonutils': settings_owner.commonutils,
                 'locconst': settings_owner.constants, 'UNRESOLVED_LOC_MARKER': literal(common, 'UNRESOLVED_LOC_MARKER'),
                 'FALLBACK_TRANSLATION_STRINGS': stack[0], 'ROLEMASK_ELEVATEDPLAYER': constants.ROLEMASK_ELEVATEDPLAYER,
                 'logger': logger, 'logmodule': logmodule, 'log': standard_logging.getLogger('localization.localizationBase'),
                 'eveLocalization': data.backend, 'uiutil': uiutil, 're': re, 'sys': sys}
    selected, decorated = settings_owner.settings, []
    if hasattr(selected, 'languageLabels'):
        raise RuntimeError('An attached localization lookup cannot be initialized again')
    for name in ('_InitializeInternalVariables', '_InitializeTextData', '_ReadMainLocalizationData', '_IsValidLanguage',
                 'SetFallBackMode', 'GetFallBackMode', 'Get', 'GetByMessageID', 'GetByLabel',
                 'GetImportantByMessageID', 'GetImportantByLabel', 'GetMessageIDForLabel', 'GetLanguages',
                 'UsePrimaryLanguageText', 'HighlightImportant', 'UseImportantTooltip', '_QaTooltipOverride',
                 'FormatImportantString', 'CleanImportantMarkup'):
        defaults = (None,) if name in ('Get', 'GetByMessageID', 'GetByLabel') else None
        method = types.FunctionType(definition(cls, name), namespace, name, defaults)
        if name in ('_InitializeTextData', '_ReadMainLocalizationData', 'UsePrimaryLanguageText'):
            method = zoning.ZONE_METHOD(method)
            decorated.append(name)
        setattr(type(selected), name, method)
    for name in ('FIELD_LABELS', 'FIELD_LANGUAGES', 'FIELD_TYPES'):
        setattr(type(selected), name, literal(cls, name))
    selected._InitializeInternalVariables()
    selected._InitializeTextData()
    selected.SetFallBackMode(0)
    supported = selected._ReadMainLocalizationData(data.main, settings_owner.constants.DATATYPE_FSD)
    if not supported or not data.backend.HasLanguage(selected._GetPrimaryLanguage()):
        raise RuntimeError('Original main label data or actual primary language is unavailable')
    selected._primaryLanguageID = data.backend.GetPrimaryLanguage()
    if selected._primaryLanguageID != selected._GetPrimaryLanguage():
        raise RuntimeError('Loaded backend and original primary-language constant differ')
    selected._GetByMessageID = data.backend.GetMessageByID
    result = types.ModuleType('companion.localization_lookup_owner')
    result.settings, result.data, result.context = settings_owner, data, context
    result.instance, result.langutils, result.uiutil = selected, langutils, uiutil
    result.policy, result.zoning, result.decorated = policy, zoning, tuple(decorated)
    result.namespace = namespace

    def invoke(name, args, kwargs):
        return getattr(selected, name)(*args, **kwargs)

    result.invoke = invoke
    def entry(name):
        def call(*args):
            # A real companion caller for source Get's exception-frame locals.
            return getattr(selected, name)(*args)
        return call
    result.entries = {name: entry(name) for name in ('Get', 'GetByMessageID', 'GetByLabel', 'GetImportantByMessageID', 'GetImportantByLabel')}
    return result
