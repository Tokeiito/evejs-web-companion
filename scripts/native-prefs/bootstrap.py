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
