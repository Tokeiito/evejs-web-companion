// Actual installed Python27 heap host, not a parser or Blue engine host.
// Opaque public C-API pointers: no PyObject layout/refcount macros are used.
// One Node environment/Windows owner thread, one interpreter, no Py_Finalize
// or DLL unload. Original compiled modules/bootstrap belong to the caller.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <wincrypt.h>
#include <node_api.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <limits.h>
#include "atomic_files.h"
#include "log_backend.h"
#include "tasklet_timer.h"

typedef struct _object PyObject;
typedef intptr_t Py_ssize_t;
typedef PyObject* (__cdecl *PyCFunction)(PyObject*, PyObject*);
typedef struct { const char* name; PyCFunction method; int flags; const char* doc; } PyMethodDef;
typedef char check_method_def_size[(sizeof(PyMethodDef) == 32) ? 1 : -1];
#define BINDINGS(X) \
 X(void, Py_InitializeEx, (int)) \
 X(int, Py_IsInitialized, (void)) \
 X(void, PyEval_InitThreads, (void)) \
 X(void*, PyEval_SaveThread, (void)) \
 X(void, PyEval_RestoreThread, (void*)) \
 X(int, PyGILState_Ensure, (void)) \
 X(void, PyGILState_Release, (int)) \
 X(void, Py_IncRef, (PyObject*)) \
 X(void, Py_DecRef, (PyObject*)) \
 X(PyObject*, PyRun_StringFlags, (const char*, int, PyObject*, PyObject*, void*)) \
 X(PyObject*, PyEval_GetBuiltins, (void)) \
 X(PyObject*, PyDict_New, (void)) \
 X(int, PyDict_SetItemString, (PyObject*, const char*, PyObject*)) \
 X(int, PyDict_SetItem, (PyObject*, PyObject*, PyObject*)) \
 X(PyObject*, PyImport_GetModuleDict, (void)) \
 X(PyObject*, PyModule_New, (const char*)) \
 X(int, PyModule_AddObject, (PyObject*, const char*, PyObject*)) \
 X(PyObject*, PyCFunction_NewEx, (PyMethodDef*, PyObject*, PyObject*)) \
 X(PyObject*, PyObject_CallObject, (PyObject*, PyObject*)) \
 X(PyObject*, PyObject_GetAttr, (PyObject*, PyObject*)) \
 X(PyObject*, PyObject_GetAttrString, (PyObject*, const char*)) \
 X(int, PyObject_SetAttr, (PyObject*, PyObject*, PyObject*)) \
 X(PyObject*, PyObject_GetItem, (PyObject*, PyObject*)) \
 X(int, PyObject_SetItem, (PyObject*, PyObject*, PyObject*)) \
 X(int, PyObject_IsTrue, (PyObject*)) \
 X(int, PyObject_IsInstance, (PyObject*, PyObject*)) \
 X(PyObject*, PyObject_Type, (PyObject*)) \
 X(PyObject*, PyObject_Str, (PyObject*)) \
 X(PyObject*, PyObject_Unicode, (PyObject*)) \
 X(PyObject*, PyTuple_New, (Py_ssize_t)) \
 X(Py_ssize_t, PyTuple_Size, (PyObject*)) \
 X(PyObject*, PyTuple_GetItem, (PyObject*, Py_ssize_t)) \
 X(int, PyTuple_SetItem, (PyObject*, Py_ssize_t, PyObject*)) \
 X(PyObject*, PyList_New, (Py_ssize_t)) \
 X(int, PyList_SetItem, (PyObject*, Py_ssize_t, PyObject*)) \
 X(Py_ssize_t, PyList_Size, (PyObject*)) \
 X(PyObject*, PyList_GetItem, (PyObject*, Py_ssize_t)) \
 X(PyObject*, PyByteArray_FromStringAndSize, (const char*, Py_ssize_t)) \
 X(char*, PyByteArray_AsString, (PyObject*)) \
 X(Py_ssize_t, PyByteArray_Size, (PyObject*)) \
 X(Py_ssize_t, PySequence_Size, (PyObject*)) \
 X(PyObject*, PySequence_GetItem, (PyObject*, Py_ssize_t)) \
 X(PyObject*, PySequence_Fast, (PyObject*, const char*)) \
 X(Py_ssize_t, PySequence_Index, (PyObject*, PyObject*)) \
 X(int, PyObject_Cmp, (PyObject*, PyObject*, int*)) \
 X(int, PyErr_WarnEx, (PyObject*, const char*, Py_ssize_t)) \
 X(int, PyArg_ParseTuple, (PyObject*, const char*, ...)) \
 X(int, PyType_IsSubtype, (PyObject*, PyObject*)) \
 X(PyObject*, PyString_FromStringAndSize, (const char*, Py_ssize_t)) \
 X(PyObject*, PyString_InternFromString, (const char*)) \
 X(Py_ssize_t, PyNumber_AsSsize_t, (PyObject*, PyObject*)) \
 X(int, PyString_AsStringAndSize, (PyObject*, char**, Py_ssize_t*)) \
 X(PyObject*, PyUnicodeUCS2_FromUnicode, (const uint16_t*, Py_ssize_t)) \
 X(uint16_t*, PyUnicodeUCS2_AsUnicode, (PyObject*)) \
 X(Py_ssize_t, PyUnicodeUCS2_GetSize, (PyObject*)) \
 X(PyObject*, PyBool_FromLong, (long)) \
 X(PyObject*, PyInt_FromLong, (long)) \
 X(long, PyInt_AsLong, (PyObject*)) \
 X(PyObject*, PyLong_FromString, (char*, char**, int)) \
 X(long long, PyLong_AsLongLong, (PyObject*)) \
 X(unsigned long long, PyLong_AsUnsignedLongLong, (PyObject*)) \
 X(PyObject*, PyLong_FromLongLong, (long long)) \
 X(PyObject*, PyLong_FromUnsignedLongLong, (unsigned long long)) \
 X(PyObject*, PyFloat_FromDouble, (double)) \
 X(double, PyFloat_AsDouble, (PyObject*)) \
 X(PyObject*, PyErr_Occurred, (void)) \
 X(void, PyErr_Fetch, (PyObject**, PyObject**, PyObject**)) \
 X(void, PyErr_Restore, (PyObject*, PyObject*, PyObject*)) \
 X(void, PyErr_Clear, (void)) \
 X(PyObject*, PyErr_NoMemory, (void)) \
 X(void, PyErr_SetString, (PyObject*, const char*)) \
 X(PyObject*, PyErr_Format, (PyObject*, const char*, ...)) \
 X(PyObject*, PyErr_NewException, (char*, PyObject*, PyObject*)) \
 X(PyObject*, PyErr_SetExcFromWindowsErr, (PyObject*, int))
#define DECLARE(ret, name, args) typedef ret (__cdecl *name##_fn) args; static name##_fn name;
BINDINGS(DECLARE)
#undef DECLARE

static PyObject *none_object, *int_type, *long_type, *float_type, *bool_type, *str_type, *unicode_type, *list_type, *dict_type;
static PyObject **exc_type, **exc_value, **exc_runtime, **exc_io, **exc_memory, **exc_key, **exc_index, **exc_warning;
static PyObject** exc_windows;
static HMODULE python_dll;
static PyObject* globals;
static int initialized, entered, closed;
static DWORD owner_thread;
static napi_env owner_env;
static int log_owner_guard(void) { return initialized && entered && !closed && GetCurrentThreadId() == owner_thread; }
static const napi_type_tag handle_tag = { 0x752ac91d3fa64a17ull, 0xb9f734e2ca5919d3ull };
typedef struct Handle { PyObject* object; int disposed; struct Handle* next; } Handle;
static Handle* pending;
static SRWLOCK pending_lock = SRWLOCK_INIT;
typedef struct { int active; int initial; int gil; } Scope;

static napi_value bridge_error(napi_env env, const char* text) {
  napi_throw_error(env, "PYTHON_PREFS_BRIDGE", text); return NULL;
}
static int ok(napi_env env, napi_status status) {
  if (status == napi_ok) return 1;
  bool throwing = false; napi_is_exception_pending(env, &throwing);
  if (!throwing) napi_throw_error(env, "PYTHON_PREFS_BRIDGE", "Node value operation failed.");
  return 0;
}
static napi_value js_null(napi_env env) { napi_value value; return ok(env, napi_get_null(env, &value)) ? value : NULL; }
static napi_value js_bool(napi_env env, int value) { napi_value result; return ok(env, napi_get_boolean(env, value != 0, &result)) ? result : NULL; }
static void decref(PyObject* value) { if (value) Py_DecRef(value); }
static PyObject* new_none(void) { Py_IncRef(none_object); return none_object; }

// NAPI GC finalizers NEVER enter Python: DECREF can invoke arbitrary __del__.
// Ordinary guarded API entries drain this native queue under the actual GIL.
static void finalize_handle(napi_env env, void* data, void* hint) {
  Handle* handle = (Handle*)data;
  if (!handle->object) { free(handle); return; }
  handle->disposed = 1;
  AcquireSRWLockExclusive(&pending_lock); handle->next = pending; pending = handle; ReleaseSRWLockExclusive(&pending_lock);
}
static void drain(void) {
  Handle* list; PyObject *type = NULL, *value = NULL, *trace = NULL;
  PyErr_Fetch(&type, &value, &trace);
  AcquireSRWLockExclusive(&pending_lock); list = pending; pending = NULL; ReleaseSRWLockExclusive(&pending_lock);
  while (list) { Handle* next = list->next; decref(list->object); free(list); list = next; }
  prefs_log_drain(owner_env);
  PyErr_Clear(); PyErr_Restore(type, value, trace);
}
static int begin(napi_env env, Scope* scope) {
  memset(scope, 0, sizeof(*scope));
  if (!initialized || closed) { bridge_error(env, "The owned Python interpreter is not available."); return 0; }
  if (GetCurrentThreadId() != owner_thread || env != owner_env) { bridge_error(env, "Python preferences require their original Node main owner."); return 0; }
  if (entered) { bridge_error(env, "Reentrant Python bridge entry is unavailable."); return 0; }
  entered = 1; scope->active = 1; scope->gil = PyGILState_Ensure(); drain(); return 1;
}
static napi_value finish(Scope* scope, napi_value result) {
  if (scope->active) {
    if (scope->initial) PyEval_SaveThread(); else PyGILState_Release(scope->gil);
    entered = 0; scope->active = 0;
  }
  return result;
}
static void env_cleanup(void* ignored) { closed = 1; prefs_log_close(); /* No Python/destructors during env teardown. */ }
static napi_value wrap(napi_env env, PyObject* object) {
  Handle* handle; napi_value result;
  if (!object) return NULL;
  handle = (Handle*)calloc(1, sizeof(*handle));
  if (!handle) { decref(object); return bridge_error(env, "Native handle allocation failed."); }
  handle->object = object;
  if (!ok(env, napi_create_external(env, handle, finalize_handle, NULL, &result))) { decref(object); free(handle); return NULL; }
  // The external/finalizer owns object after successful create, even if tag fails.
  if (!ok(env, napi_type_tag_object(env, result, &handle_tag))) return NULL;
  return result;
}
static Handle* handle(napi_env env, napi_value value, int allow_disposed) {
  Handle* result; bool valid = false;
  if (!ok(env, napi_check_object_type_tag(env, value, &handle_tag, &valid))) return NULL;
  if (!valid) { bridge_error(env, "An actual Python value handle is required."); return NULL; }
  if (!ok(env, napi_get_value_external(env, value, (void**)&result))) return NULL;
  if (!allow_disposed && (result->disposed || !result->object)) { bridge_error(env, "The Python value handle was disposed."); return NULL; }
  return result;
}
static int arguments(napi_env env, napi_callback_info info, size_t expected, napi_value* argv) {
  size_t count = expected;
  if (!ok(env, napi_get_cb_info(env, info, &count, argv, NULL, NULL))) return 0;
  if (count != expected) { bridge_error(env, "Unexpected Python bridge argument count."); return 0; }
  return 1;
}
static char* utf8(napi_env env, napi_value value) {
  size_t length; char* result; napi_valuetype kind;
  if (!ok(env, napi_typeof(env, value, &kind))) return NULL;
  if (kind != napi_string) { bridge_error(env, "A string is required."); return NULL; }
  if (!ok(env, napi_get_value_string_utf8(env, value, NULL, 0, &length))) return NULL;
  result = (char*)malloc(length + 1); if (!result) { bridge_error(env, "String allocation failed."); return NULL; }
  if (!ok(env, napi_get_value_string_utf8(env, value, result, length + 1, &length))) { free(result); return NULL; }
  if (memchr(result, 0, length)) { free(result); bridge_error(env, "Embedded NUL is unavailable in bridge source/names."); return NULL; }
  return result;
}
static PyObject* unicode_value(napi_env env, napi_value value) {
  napi_valuetype kind; size_t length; char16_t* text; PyObject* result;
  if (!ok(env, napi_typeof(env, value, &kind))) return NULL;
  if (kind != napi_string) { bridge_error(env, "A UTF16 string is required."); return NULL; }
  if (!ok(env, napi_get_value_string_utf16(env, value, NULL, 0, &length))) return NULL;
  text = (char16_t*)malloc((length + 1) * sizeof(char16_t));
  if (!text) { bridge_error(env, "UTF16 allocation failed."); return NULL; }
  if (!ok(env, napi_get_value_string_utf16(env, value, text, length + 1, &length))) { free(text); return NULL; }
  result = PyUnicodeUCS2_FromUnicode((uint16_t*)text, (Py_ssize_t)length); free(text); return result;
}
static napi_value unicode_js(napi_env env, PyObject* object) {
  uint16_t* text = PyUnicodeUCS2_AsUnicode(object); Py_ssize_t length; napi_value result;
  if (!text) return NULL; length = PyUnicodeUCS2_GetSize(object); if (length < 0) return NULL;
  return ok(env, napi_create_string_utf16(env, (char16_t*)text, (size_t)length, &result)) ? result : NULL;
}
static napi_value python_error(napi_env env) {
  PyObject *type = NULL, *value = NULL, *trace = NULL, *name = NULL, *display = NULL, *name_unicode = NULL;
  napi_value js_name = NULL, js_message = NULL, error, part;
  PyErr_Fetch(&type, &value, &trace); // Own ORIGINAL triple; never print/flatten it.
  if (!type) return bridge_error(env, "Python returned no value without an exception.");
  name = PyObject_GetAttrString(type, "__name__");
  if (name) name_unicode = PyObject_Unicode(name);
  if (name_unicode) js_name = unicode_js(env, name_unicode);
  PyErr_Clear();
  if (value) display = PyObject_Unicode(value);
  if (display) js_message = unicode_js(env, display);
  PyErr_Clear(); decref(name); decref(name_unicode); decref(display);
  if (!js_name) napi_create_string_utf8(env, "PythonError", NAPI_AUTO_LENGTH, &js_name);
  if (!js_message) napi_create_string_utf8(env, "Native Python exception (see retained value).", NAPI_AUTO_LENGTH, &js_message);
  if (!ok(env, napi_create_error(env, NULL, js_message, &error))) { decref(type); decref(value); decref(trace); return NULL; }
  if (!ok(env, napi_set_named_property(env, error, "name", js_name))) { decref(type); decref(value); decref(trace); return NULL; }
  part = wrap(env, type); type = NULL;
  if (!part || !ok(env, napi_set_named_property(env, error, "pythonType", part))) { decref(value); decref(trace); return NULL; }
  part = wrap(env, value ? value : new_none()); value = NULL;
  if (!part || !ok(env, napi_set_named_property(env, error, "pythonValue", part))) { decref(trace); return NULL; }
  part = wrap(env, trace ? trace : new_none()); trace = NULL;
  if (!part || !ok(env, napi_set_named_property(env, error, "pythonTraceback", part))) return NULL;
  ok(env, napi_throw(env, error)); return NULL;
}
static napi_value result(napi_env env, Scope* scope, PyObject* value) {
  bool throwing = false;
  if (!value) { napi_is_exception_pending(env, &throwing); if (throwing) return finish(scope, NULL); }
  return finish(scope, value ? wrap(env, value) : python_error(env));
}

// Real Win32 AtomicFile operations and the explicit source-port layout
// capability below, NEVER a loaded or initialized Blue module.
// DefineErrors/PyWin32Error: blue/src/win32.cpp1279-1370,1437. These are REAL
// Python exception subclasses made by the same exported C API, not JS names.
typedef struct { const char* name; DWORD code; PyObject* exception; } WinError;
#define WIN_ERROR(name) {"ERROR_" #name, ERROR_##name, NULL}
#define CRYPTO_ERROR(name) {"NTE_" #name, (DWORD)NTE_##name, NULL}
static WinError windows_errors[] = {
  WIN_ERROR(INVALID_FUNCTION), WIN_ERROR(FILE_NOT_FOUND), WIN_ERROR(PATH_NOT_FOUND),
  WIN_ERROR(ACCESS_DENIED), WIN_ERROR(INVALID_HANDLE), WIN_ERROR(ARENA_TRASHED),
  WIN_ERROR(NOT_ENOUGH_MEMORY), WIN_ERROR(INVALID_BLOCK), WIN_ERROR(BAD_ENVIRONMENT),
  WIN_ERROR(BAD_FORMAT), WIN_ERROR(INVALID_ACCESS), WIN_ERROR(INVALID_DATA),
  WIN_ERROR(OUTOFMEMORY), WIN_ERROR(INVALID_DRIVE), WIN_ERROR(CURRENT_DIRECTORY),
  WIN_ERROR(WRITE_PROTECT), WIN_ERROR(NOT_SUPPORTED), WIN_ERROR(INVALID_PARAMETER),
  WIN_ERROR(OPEN_FAILED), WIN_ERROR(DISK_FULL), WIN_ERROR(CALL_NOT_IMPLEMENTED),
  WIN_ERROR(INVALID_NAME), WIN_ERROR(MOD_NOT_FOUND), WIN_ERROR(PROC_NOT_FOUND),
  WIN_ERROR(BAD_ARGUMENTS), WIN_ERROR(BUSY), WIN_ERROR(MORE_DATA),
  CRYPTO_ERROR(BAD_ALGID), CRYPTO_ERROR(BAD_DATA), CRYPTO_ERROR(BAD_FLAGS),
  CRYPTO_ERROR(BAD_HASH), CRYPTO_ERROR(BAD_HASH_STATE), CRYPTO_ERROR(BAD_KEY),
  CRYPTO_ERROR(BAD_KEY_STATE), CRYPTO_ERROR(BAD_KEYSET), CRYPTO_ERROR(BAD_KEYSET_PARAM),
  CRYPTO_ERROR(BAD_LEN), CRYPTO_ERROR(BAD_UID), CRYPTO_ERROR(BAD_VER),
  CRYPTO_ERROR(BAD_TYPE), CRYPTO_ERROR(BAD_PROV_TYPE), CRYPTO_ERROR(BAD_SIGNATURE),
  CRYPTO_ERROR(BAD_PUBLIC_KEY), CRYPTO_ERROR(DOUBLE_ENCRYPT), CRYPTO_ERROR(FAIL),
  CRYPTO_ERROR(NO_MEMORY), CRYPTO_ERROR(NO_KEY), CRYPTO_ERROR(EXISTS),
  CRYPTO_ERROR(KEYSET_ENTRY_BAD), CRYPTO_ERROR(KEYSET_NOT_DEF), CRYPTO_ERROR(PROV_DLL_NOT_FOUND),
  CRYPTO_ERROR(PROV_TYPE_ENTRY_BAD), CRYPTO_ERROR(PROV_TYPE_NO_MATCH), CRYPTO_ERROR(PROV_TYPE_NOT_DEF),
  CRYPTO_ERROR(PROVIDER_DLL_FAIL), CRYPTO_ERROR(SIGNATURE_FILE_BAD), CRYPTO_ERROR(SILENT_CONTEXT)
};
#undef WIN_ERROR
#undef CRYPTO_ERROR
static PyObject* atomic_failure(int status, DWORD error) {
  if (status == PREFS_ATOMIC_OS_ERROR) {
    PyObject* exception = *exc_windows;
    if (!error) error = GetLastError(); // Preserve actual PyWin32Error default0.
    for (size_t i = 0; i < sizeof(windows_errors)/sizeof(windows_errors[0]); ++i) {
      if (windows_errors[i].code == error) { exception = windows_errors[i].exception; break; }
    }
    return PyErr_SetExcFromWindowsErr(exception, (int)error);
  }
  if (status == PREFS_ATOMIC_SHORT_READ) PyErr_SetString(*exc_runtime, "Read short file");
  else if (status == PREFS_ATOMIC_SHORT_WRITE) PyErr_SetString(*exc_io, "Wrote short file");
  else if (status == PREFS_ATOMIC_NO_MEMORY) return PyErr_NoMemory();
  else PyErr_SetString(*exc_runtime, "Unexpected atomic preferences IO status");
  return NULL;
}
static PyObject* path_unicode(PyObject* value) {
  PyObject *kind = PyObject_Type(value), *text;
  if (!kind) return NULL;
  if (kind != str_type && kind != unicode_type) { decref(kind); PyErr_SetString(*exc_type, "Atomic file path must be str or unicode"); return NULL; }
  decref(kind); text = PyObject_Unicode(value); if (!text) return NULL;
  // Native CreateFileW consumes its NUL-terminated pointer. Do not add an
  // embedded-NUL rejection absent from the actual source path producer.
  if (!PyUnicodeUCS2_AsUnicode(text)) { decref(text); return NULL; }
  return text;
}
static PyObject* io_read(PyObject* self, PyObject* args) {
  PyObject *path, *answer; char* data = NULL; size_t length = 0; DWORD error = 0; int status; wchar_t* filename; void* thread;
  if (PyTuple_Size(args) != 1) { PyErr_SetString(*exc_type, "read requires one path"); return NULL; }
  path = path_unicode(PyTuple_GetItem(args, 0)); if (!path) return NULL;
  filename = (wchar_t*)PyUnicodeUCS2_AsUnicode(path); if (!filename) { decref(path); return NULL; }
  // Actual Blue Atomic IO allows Python threads during Win32 operations.
  // Keep path/args strongly owned; the released segment calls only pure C.
  Py_IncRef(args); thread = PyEval_SaveThread();
  status = prefs_atomic_read(filename, &data, &length, &error);
  PyEval_RestoreThread(thread); decref(args); decref(path);
  if (status != PREFS_ATOMIC_OK) { free(data); return atomic_failure(status, error); }
  answer = PyString_FromStringAndSize(data, (Py_ssize_t)length); free(data); return answer;
}
static PyObject* io_write(PyObject* self, PyObject* args) {
  PyObject* path; char* data; Py_ssize_t length; DWORD error = 0; int status; wchar_t* filename; void* thread;
  if (PyTuple_Size(args) != 2) { PyErr_SetString(*exc_type, "write requires path and byte str"); return NULL; }
  path = path_unicode(PyTuple_GetItem(args, 0)); if (!path) return NULL;
  if (PyString_AsStringAndSize(PyTuple_GetItem(args, 1), &data, &length) != 0) { decref(path); return NULL; }
  filename = (wchar_t*)PyUnicodeUCS2_AsUnicode(path); if (!filename) { decref(path); return NULL; }
  Py_IncRef(args); thread = PyEval_SaveThread();
  status = prefs_atomic_write(filename, data, (size_t)length, &error);
  PyEval_RestoreThread(thread); decref(args); decref(path);
  if (status != PREFS_ATOMIC_OK) return atomic_failure(status, error);
  return new_none();
}

// Copyright (c) 2014 CCP ehf. Source port of blue/src/PyRowSet.cpp
// RowDescriptor::Init/InitFromTypedList, under clientPreferences-LICENSE.txt.
// Installed blue.dll 3396210: 0x1802f99f0 / 0x1802f9c30; exposed signed
// size confirmed by SequenceGet 0x1802fb0f0 (MOVSX byte -> PyInt_FromLong).
// This is a standalone layout capability, NOT a Blue heap type, DBRow,
// virtual-column resolver, or a call to initblue/any engine initializer.
typedef struct { const char* name; uint16_t type; int size, offset; } RowColumn;
static PyObject* row_descriptor_layout(PyObject* self, PyObject* args) {
  PyObject *schema, *kind = NULL, *tuple_type = NULL, *columns = NULL, *answer = NULL;
  RowColumn* rows = NULL;
  if (!PyArg_ParseTuple(args, "O:row_descriptor_layout", &schema)) return NULL;
  PyObject* empty = PyTuple_New(0);
  if (!empty) return NULL;
  tuple_type = PyObject_Type(empty); decref(empty);
  kind = PyObject_Type(schema);
  if (!tuple_type || !kind) goto failed;
  int is_tuple = PyType_IsSubtype(kind, tuple_type);
  decref(kind); kind = NULL; decref(tuple_type); tuple_type = NULL;
  if (!is_tuple) { PyErr_SetString(*exc_type, "expected a tuple of tuples of name and type"); goto failed; }
  Py_ssize_t count = PyTuple_Size(schema);
  // Avoid C integer/allocator overflow; no undefined-memory behavior is a
  // supported capability. Real inventory/effect schemas are small tuples.
  if (count < 0) goto failed;
  if (count > INT_MAX / 128) { PyErr_NoMemory(); goto failed; }
  rows = (RowColumn*)calloc(count ? (size_t)count : 1, sizeof(RowColumn));
  if (!rows) { PyErr_NoMemory(); goto failed; }
  for (Py_ssize_t i = 0; i < count; ++i) {
    int type; PyObject* ignored = NULL;
    if (!PyArg_ParseTuple(PyTuple_GetItem(schema, i), "si|O:DBRowDescriptor", &rows[i].name, &type, &ignored)) goto failed;
    rows[i].type = (uint16_t)type; // Original DBTYPE is a 16-bit field.
  }
  int sizes[5] = {0}, offsets[5] = {0}, objects = 0, real = 0;
  for (Py_ssize_t i = 0; i < count; ++i) {
    int size;
    switch (rows[i].type) {
      case 0: size = -1; break;
      case 11: size = 0; break;
      case 16: case 17: size = 1; break;
      case 2: case 18: size = 2; break;
      case 3: case 4: case 19: size = 3; break;
      case 5: case 6: case 20: case 21: case 64: case 135: size = 4; break;
      case 128: case 129: case 130: size = 5; break;
      default:
        PyErr_Format(*exc_type, "DBRowDescriptor doesn't support data type %d", (int)(int16_t)rows[i].type);
        goto failed;
    }
    rows[i].size = size;
    if (size == 5) { ++objects; ++real; }
    else if (size >= 0) { ++sizes[size]; ++real; }
  }
  int offset = 0;
  for (int i = 4; i > 0; --i) { offsets[i] = offset; offset += sizes[i] * (1 << (i - 1)); }
  offset *= 8; offsets[0] = offset; offset += sizes[0];
  int null_start = offset, data_length = (offset + real + 7) / 8;
  offset = objects ? (data_length + 7) & ~7 : data_length;
  int object_start = objects ? offset / 8 : 0, total_length = offset + objects * 8, virtuals = 0;
  columns = PyTuple_New(count);
  if (!columns) goto failed;
  for (Py_ssize_t i = 0; i < count; ++i) {
    RowColumn* column = &rows[i];
    if (column->size == 5) { column->offset = offset; column->size = 8; offset += 8; }
    else if (column->size == -1) { column->offset = virtuals++; column->size = 0; }
    else if (column->size == 0) { column->offset = offsets[0]++; column->size = -1; }
    else { int slot = column->size; column->offset = offsets[slot]; column->size = 1 << (slot - 1); offsets[slot] += column->size; }
    PyObject* entry = PyTuple_New(4);
    if (!entry) goto failed;
    PyObject* name = PyString_FromStringAndSize(column->name, (Py_ssize_t)strlen(column->name));
    if (!name) { decref(entry); goto failed; }
    PyTuple_SetItem(entry, 0, name);
    for (int j = 1; j < 4; ++j) {
      PyObject* number = PyInt_FromLong(j == 1 ? column->type : j == 2 ? column->size : column->offset);
      if (!number) { decref(entry); goto failed; }
      PyTuple_SetItem(entry, j, number);
    }
    PyTuple_SetItem(columns, i, entry);
  }
  answer = PyTuple_New(6);
  if (!answer) goto failed;
  PyTuple_SetItem(answer, 0, columns); columns = NULL;
  const int metadata[5] = {data_length, objects, total_length, null_start, object_start};
  for (int i = 0; i < 5; ++i) {
    PyObject* number = PyInt_FromLong(metadata[i]);
    if (!number) goto failed;
    PyTuple_SetItem(answer, i + 1, number);
  }
  free(rows); return answer;
failed:
  free(rows); decref(kind); decref(tuple_type); decref(columns); decref(answer); return NULL;
}

// Source-port descriptor protocols over the named Python wrapper's own state.
// Shipped3396210: Keys2fa940, Index2faa80, Size2fa6e0, SequenceGet2fb0f0.
// Public C API only; no access to a PyObject/Blue type's memory layout.
static PyObject* descriptor_keys(PyObject* self, PyObject* unused) {
  PyObject* columns = PyObject_GetAttrString(self, "_columns"); if (!columns) return NULL;
  Py_ssize_t count = PyTuple_Size(columns); if (count < 0) { decref(columns); return NULL; }
  PyObject* answer = PyList_New(count); if (!answer) { decref(columns); return NULL; }
  for (Py_ssize_t i = 0; i < count; ++i) {
    PyObject* row = PyTuple_GetItem(columns, i), *name = row ? PyTuple_GetItem(row, 0) : NULL;
    char* text; Py_ssize_t length;
    if (!name || PyString_AsStringAndSize(name, &text, &length) != 0) { decref(columns); decref(answer); return NULL; }
    PyObject* copy = PyString_FromStringAndSize(text, (Py_ssize_t)strlen(text));
    if (!copy) { decref(columns); decref(answer); return NULL; }
    PyList_SetItem(answer, i, copy);
  }
  decref(columns); return answer;
}
static PyObject* descriptor_index(PyObject* self, PyObject* key) {
  // A captured bound method must enforce the same boundary as its property.
  PyObject* setting = PyObject_GetAttrString(self, "_setting"); if (!setting) return NULL;
  int active = PyObject_IsTrue(setting); decref(setting); if (active < 0) return NULL;
  if (active) {
    PyObject* name = PyString_FromStringAndSize("_unsafe", 7), *yes = PyBool_FromLong(1);
    if (!name || !yes) { decref(name); decref(yes); return NULL; }
    int status = PyObject_SetAttr(self, name, yes); decref(name); decref(yes);
    if (status < 0) return NULL;
    PyObject* error = PyObject_GetAttrString(self, "_domain_error"); if (!error) return NULL;
    PyErr_SetString(error, "Reentrant native column-map access is outside this capability");
    decref(error); return NULL;
  }
  PyObject* kind = PyObject_Type(key); if (!kind) return NULL;
  int is_str = PyType_IsSubtype(kind, str_type); decref(kind);
  if (!is_str) { PyErr_SetString(*exc_type, "string key required"); return NULL; }
  char* target; Py_ssize_t length;
  if (PyString_AsStringAndSize(key, &target, &length) != 0) return NULL;
  PyObject* columns = PyObject_GetAttrString(self, "_columns"); if (!columns) return NULL;
  Py_ssize_t count = PyTuple_Size(columns); if (count < 0) { decref(columns); return NULL; }
  for (Py_ssize_t i = 0; i < count; ++i) {
    PyObject* row = PyTuple_GetItem(columns, i), *name = row ? PyTuple_GetItem(row, 0) : NULL;
    char* text;
    if (!name || PyString_AsStringAndSize(name, &text, &length) != 0) { decref(columns); return NULL; }
    if (!strcmp(text, target)) { decref(columns); return PyInt_FromLong((long)i); }
  }
  decref(columns); return PyErr_Format(*exc_key, "key %s not found", target);
}
static PyObject* descriptor_size(PyObject* self, PyObject* unused) {
  PyObject* storage = PyObject_GetAttrString(self, "_storage"); if (!storage) return NULL;
  PyObject* answer = PyTuple_New(2); if (!answer) { decref(storage); return NULL; }
  for (int i = 0; i < 2; ++i) {
    PyObject* value = PyTuple_GetItem(storage, i); if (!value) { decref(storage); decref(answer); return NULL; }
    long number = PyInt_AsLong(value);
    if (number == -1 && PyErr_Occurred()) { decref(storage); decref(answer); return NULL; }
    value = PyInt_FromLong(number); if (!value) { decref(storage); decref(answer); return NULL; }
    PyTuple_SetItem(answer, i, value);
  }
  decref(storage); return answer;
}
static PyObject* descriptor_item(PyObject* self, PyObject* key) {
  Py_ssize_t index = PyNumber_AsSsize_t(key, *exc_index);
  if (index == -1 && PyErr_Occurred()) return NULL;
  PyObject* columns = PyObject_GetAttrString(self, "_columns"); if (!columns) return NULL;
  Py_ssize_t count = PyTuple_Size(columns); if (count < 0) { decref(columns); return NULL; }
  if (index < 0) index += count; // CPython bracket normalization, once.
  if (index < 0 || index >= count) { decref(columns); return PyErr_Format(*exc_index, "index %d out of range", (int)index); }
  PyObject* row = PyTuple_GetItem(columns, index), *name = row ? PyTuple_GetItem(row, 0) : NULL;
  char* text; Py_ssize_t length;
  if (!name || PyString_AsStringAndSize(name, &text, &length) != 0) { decref(columns); return NULL; }
  PyObject* answer = PyTuple_New(3); if (!answer) { decref(columns); return NULL; }
  name = PyString_InternFromString(text); if (!name) { decref(columns); decref(answer); return NULL; }
  PyTuple_SetItem(answer, 0, name);
  for (int i = 1; i < 3; ++i) {
    PyObject* value = PyTuple_GetItem(row, i); if (!value) { decref(columns); decref(answer); return NULL; }
    long number = PyInt_AsLong(value);
    if (number == -1 && PyErr_Occurred()) { decref(columns); decref(answer); return NULL; }
    value = PyInt_FromLong(number); if (!value) { decref(columns); decref(answer); return NULL; }
    PyTuple_SetItem(answer, i, value);
  }
  decref(columns); return answer;
}
static PyMethodDef descriptor_methods[] = {
  {"Keys", descriptor_keys, 4, "Source-port byte column names."},
  {"Index", descriptor_index, 8, "Source-port first byte-name index."},
  {"Size", descriptor_size, 4, "Source-port data bytes and object count."},
  {"_item", descriptor_item, 8, "Source-port normalized integer sequence access."}
};
static PyObject* descriptor_method(PyObject* self, PyObject* args) {
  PyObject* owner; int index;
  if (!PyArg_ParseTuple(args, "Oi:descriptor_method", &owner, &index)) return NULL;
  if (index < 0 || index >= 4) { PyErr_SetString(*exc_value, "Unknown source-port descriptor method"); return NULL; }
  return PyCFunction_NewEx(&descriptor_methods[index], owner, NULL);
}
#include "row_storage.h"
#include "row_indexer.h"
static PyMethodDef io_methods[] = {
  {"read", io_read, 1, "Actual synchronous Win32 atomic read."},
  {"write", io_write, 1, "Actual synchronous Win32 atomic write."},
  {"AtomicFileRead", io_read, 1, "Actual synchronous Win32 atomic read."},
  {"AtomicFileWrite", io_write, 1, "Actual synchronous Win32 atomic write."},
  {"row_descriptor_layout", row_descriptor_layout, 1, "Source-port descriptor layout; not a Blue heap type."},
  {"row_descriptor_method", descriptor_method, 1, "Bind source-port descriptor protocol to its named wrapper."},
  {"row_storage", row_storage, 8, "Allocate named row scalar bytes and owned object references."},
  {"row_get", row_get, 1, "Read source-selected native typed row cell."},
  {"row_set", row_set, 1, "Write source-selected native typed row cell."},
  {"row_index", row_index, 1, "Installed byte/int column admission."},
  {"row_sequence_size", row_sequence_size, 8, "Original InitSeq sequence size."},
  {"row_sequence_item", row_sequence_item, 1, "Original InitSeq ordered item read."},
  {"row_sequence_fast", row_sequence_fast, 8, "Original slice sequence admission."},
  {"row_warning", row_warning, 1, "Original row UserWarning and filter behavior."},
  {"row_compare", row_compare, 1, "Original Python2 cell comparison."},
  {"row_indexer", row_indexer, 1, "Bind the named row XUtil_Index source port."}
};
static int install_io(void) {
  PyObject* module = PyModule_New("_client_prefs_io"); if (!module) return 0;
  for (size_t i = 0; i < sizeof(io_methods) / sizeof(io_methods[0]); ++i) {
    PyObject* method = PyCFunction_NewEx(&io_methods[i], NULL, NULL);
    if (!method) { decref(module); return 0; }
    if (PyModule_AddObject(module, io_methods[i].name, method) != 0) { decref(method); decref(module); return 0; }
  }
  PyObject* win32 = PyModule_New("blue.win32");
  if (!win32) { decref(module); return 0; }
  for (size_t i = 0; i < sizeof(windows_errors)/sizeof(windows_errors[0]); ++i) {
    char qualified[96];
    strcpy_s(qualified, sizeof(qualified), "blue.win32.");
    strcat_s(qualified, sizeof(qualified), windows_errors[i].name);
    PyObject* exception = PyErr_NewException(qualified, *exc_windows, NULL);
    if (!exception) { decref(win32); decref(module); return 0; }
    if (PyModule_AddObject(win32, windows_errors[i].name, exception) != 0) { decref(exception); decref(win32); decref(module); return 0; }
    // Module owns each class exactly as DefineError. The VM/module registry
    // remains alive for process lifetime; no CRT-shutdown Python operations.
    windows_errors[i].exception = exception;
  }
  if (PyDict_SetItemString(PyImport_GetModuleDict(), "blue.win32", win32) != 0 ||
      PyModule_AddObject(module, "win32", win32) != 0) { decref(win32); decref(module); return 0; }
  int status = PyDict_SetItemString(PyImport_GetModuleDict(), "_client_prefs_io", module); decref(module); return status == 0;
}

static int bind_api(napi_env env, HMODULE dll) {
#define LOAD(ret, name, args) name = (name##_fn)GetProcAddress(dll, #name); if (!name) { bridge_error(env, "Required Python27 C API export missing: " #name); return 0; }
  BINDINGS(LOAD)
#undef LOAD
#define DATA(target, name) target = (PyObject*)GetProcAddress(dll, name); if (!target) { bridge_error(env, "Required Python27 object export missing: " name); return 0; }
  DATA(none_object, "_Py_NoneStruct") DATA(int_type, "PyInt_Type") DATA(long_type, "PyLong_Type")
  DATA(float_type, "PyFloat_Type") DATA(bool_type, "PyBool_Type") DATA(str_type, "PyString_Type") DATA(unicode_type, "PyUnicode_Type")
  DATA(list_type, "PyList_Type") DATA(dict_type, "PyDict_Type")
#undef DATA
#define EXC(target, name) target = (PyObject**)GetProcAddress(dll, name); if (!target) { bridge_error(env, "Required Python27 exception export missing: " name); return 0; }
  EXC(exc_type, "PyExc_TypeError") EXC(exc_value, "PyExc_ValueError") EXC(exc_runtime, "PyExc_RuntimeError")
  EXC(exc_io, "PyExc_IOError") EXC(exc_memory, "PyExc_MemoryError")
  EXC(exc_windows, "PyExc_WindowsError")
  EXC(exc_key, "PyExc_KeyError") EXC(exc_index, "PyExc_IndexError")
  EXC(exc_warning, "PyExc_UserWarning")
#undef EXC
  if (!prefs_log_bind(dll, log_owner_guard)) { bridge_error(env, "Required Python27 logging C API export missing."); return 0; }
  if (!prefs_timer_bind(dll, log_owner_guard)) { bridge_error(env, "Required Python27 tasklet timer C API export missing."); return 0; }
  return 1;
}
static napi_value initialize(napi_env env, napi_callback_info info) {
  napi_value argv[3]; size_t length; char16_t* path; char *bootstrap = NULL; void* modules; Scope scope = {0}; PyObject *raw = NULL, *name = NULL, *answer = NULL;
  if (!arguments(env, info, 3, argv)) return NULL;
  if (initialized || closed) return bridge_error(env, "This addon already owns its interpreter; use run/getGlobal, not reinitialization.");
  if (!ok(env, napi_get_value_string_utf16(env, argv[0], NULL, 0, &length))) return NULL;
  path = (char16_t*)calloc(length + 1, sizeof(char16_t)); if (!path) return bridge_error(env, "DLL path allocation failed.");
  if (!ok(env, napi_get_value_string_utf16(env, argv[0], path, length + 1, &length))) { free(path); return NULL; }
  for (size_t i = 0; i < length; ++i) if (!path[i]) { free(path); return bridge_error(env, "Embedded NUL in DLL path."); }
  if (!(length >= 3 && path[1] == ':' && (path[2] == '\\' || path[2] == '/')) && !(length >= 2 && path[0] == '\\' && path[1] == '\\')) { free(path); return bridge_error(env, "Python27 DLL path must be absolute."); }
  bool is_buffer = false;
  if (!ok(env, napi_is_buffer(env, argv[1], &is_buffer)) || !is_buffer) { free(path); return bridge_error(env, "Original module index must be a Buffer."); }
  if (!ok(env, napi_get_buffer_info(env, argv[1], &modules, &length))) { free(path); return NULL; }
  bootstrap = utf8(env, argv[2]); if (!bootstrap) { free(path); return NULL; }
  python_dll = LoadLibraryExW((wchar_t*)path, NULL, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS); free(path);
  if (!python_dll) { free(bootstrap); return bridge_error(env, "The selected Python27 DLL could not be loaded."); }
  if (!bind_api(env, python_dll)) { free(bootstrap); return NULL; }
  if (Py_IsInitialized()) { free(bootstrap); return bridge_error(env, "Refusing a foreign already-initialized Python interpreter."); }
  const char* flags[] = {"Py_NoSiteFlag", "Py_IgnoreEnvironmentFlag", "Py_DontWriteBytecodeFlag"};
  for (size_t i = 0; i < 3; ++i) { int* flag = (int*)GetProcAddress(python_dll, flags[i]); if (!flag) { free(bootstrap); return bridge_error(env, "Required Python27 initialization flag missing."); } *flag = 1; }
  owner_env = env; owner_thread = GetCurrentThreadId(); entered = 1;
  Py_InitializeEx(0); PyEval_InitThreads(); initialized = 1; scope.active = 1; scope.initial = 1;
  // Only the original owner may use this VM. It remains alive until OS exit.
  if (!ok(env, napi_add_env_cleanup_hook(env, env_cleanup, NULL))) { free(bootstrap); return finish(&scope, NULL); }
  globals = PyDict_New();
  if (!globals || PyDict_SetItemString(globals, "__builtins__", PyEval_GetBuiltins()) != 0) { free(bootstrap); return result(env, &scope, NULL); }
  name = PyString_FromStringAndSize("__client_prefs_host__", 21);
  if (!name || PyDict_SetItemString(globals, "__name__", name) != 0) { decref(name); free(bootstrap); return result(env, &scope, NULL); } decref(name);
  raw = PyString_FromStringAndSize((const char*)modules, (Py_ssize_t)length);
  if (!raw || PyDict_SetItemString(globals, "_CLIENT_MODULES_RAW", raw) != 0) { decref(raw); free(bootstrap); return result(env, &scope, NULL); } decref(raw);
  if (!install_io()) { free(bootstrap); return result(env, &scope, NULL); }
  answer = PyRun_StringFlags(bootstrap, 257 /* Py_file_input */, globals, globals, NULL); free(bootstrap);
  return result(env, &scope, answer);
}
static napi_value run(napi_env env, napi_callback_info info) {
  napi_value argv[1]; Scope scope; char* source; PyObject* answer;
  if (!arguments(env, info, 1, argv) || !begin(env, &scope)) return NULL;
  source = utf8(env, argv[0]); if (!source) return finish(&scope, NULL);
  answer = PyRun_StringFlags(source, 257, globals, globals, NULL); free(source); return result(env, &scope, answer);
}
static napi_value logging_backend(napi_env env, napi_callback_info info) {
  napi_value argv[1]; Scope scope;
  if (!arguments(env, info, 1, argv) || !begin(env, &scope)) return NULL;
  return result(env, &scope, prefs_log_create(env, argv[0]));
}
static napi_value wallclock_backend(napi_env env, napi_callback_info info) {
  napi_value argv[1]; Scope scope;
  if (!arguments(env, info, 1, argv) || !begin(env, &scope)) return NULL;
  return result(env, &scope, prefs_wallclock_create(env, argv[0]));
}
static napi_value tasklet_timer_backend(napi_env env, napi_callback_info info) {
  napi_value argv[1]; Scope scope;
  if (!arguments(env, info, 1, argv) || !begin(env, &scope)) return NULL;
  return result(env, &scope, prefs_timer_create(env, argv[0]));
}
static napi_value get_global(napi_env env, napi_callback_info info) {
  napi_value argv[1]; Scope scope; PyObject *name, *answer;
  if (!arguments(env, info, 1, argv) || !begin(env, &scope)) return NULL;
  name = unicode_value(env, argv[0]); if (!name) return result(env, &scope, NULL);
  answer = PyObject_GetItem(globals, name); decref(name); return result(env, &scope, answer);
}
static napi_value value(napi_env env, napi_callback_info info) {
  napi_value argv[2]; Scope scope; char* kind; PyObject* answer = NULL; napi_valuetype type;
  if (!arguments(env, info, 2, argv) || !begin(env, &scope)) return NULL;
  kind = utf8(env, argv[0]); if (!kind) return finish(&scope, NULL);
  if (!strcmp(kind, "none") || !strcmp(kind, "NoneType")) answer = new_none();
  else if (!strcmp(kind, "unicode")) answer = unicode_value(env, argv[1]);
  else if (!strcmp(kind, "bytes") || !strcmp(kind, "str")) {
    bool yes = false; void* bytes; size_t length;
    if (!ok(env, napi_is_buffer(env, argv[1], &yes))) goto done;
    if (!yes) { bridge_error(env, "Byte str requires a Buffer."); goto done; }
    if (!ok(env, napi_get_buffer_info(env, argv[1], &bytes, &length))) goto done;
    answer = PyString_FromStringAndSize((const char*)bytes, (Py_ssize_t)length);
  } else if (!strcmp(kind, "long")) {
    char* decimal = utf8(env, argv[1]); if (!decimal) goto done;
    size_t start = decimal[0] == '-' || decimal[0] == '+' ? 1 : 0, i = start;
    while (decimal[i] >= '0' && decimal[i] <= '9') i++;
    if (i == start || decimal[i]) { free(decimal); bridge_error(env, "PyLong requires a decimal integer string."); goto done; }
    answer = PyLong_FromString(decimal, NULL, 10); free(decimal);
  } else if (!strcmp(kind, "bool")) {
    bool boolean;
    if (!ok(env, napi_typeof(env, argv[1], &type))) goto done;
    if (type != napi_boolean) { bridge_error(env, "PyBool requires a boolean."); goto done; }
    if (!ok(env, napi_get_value_bool(env, argv[1], &boolean))) goto done;
    answer = PyBool_FromLong(boolean ? 1 : 0);
  } else if (!strcmp(kind, "int") || !strcmp(kind, "float")) {
    double number;
    if (!ok(env, napi_typeof(env, argv[1], &type))) goto done;
    if (type != napi_number) { bridge_error(env, "Python numeric construction requires an explicit Number."); goto done; }
    if (!ok(env, napi_get_value_double(env, argv[1], &number))) goto done;
    if (!strcmp(kind, "float")) answer = PyFloat_FromDouble(number);
    else {
      if (!isfinite(number) || number < -2147483648.0 || number > 2147483647.0 || number != (double)(int32_t)number) { bridge_error(env, "PyInt requires an exact signed32 integer."); goto done; }
      answer = PyInt_FromLong((long)number);
    }
  } else bridge_error(env, "Unknown explicit Python value kind.");
done:
  free(kind);
  if (!answer) { bool throwing = false; napi_is_exception_pending(env, &throwing); if (throwing) return finish(&scope, NULL); }
  return result(env, &scope, answer);
}
static napi_value call(napi_env env, napi_callback_info info) {
  napi_value argv[2], element; Scope scope; Handle *function, *item; PyObject *tuple, *answer; bool array; uint32_t length;
  if (!arguments(env, info, 2, argv) || !begin(env, &scope)) return NULL;
  function = handle(env, argv[0], 0); if (!function) return finish(&scope, NULL);
  if (!ok(env, napi_is_array(env, argv[1], &array))) return finish(&scope, NULL);
  if (!array) return finish(&scope, bridge_error(env, "Python call arguments require an array of handles."));
  if (!ok(env, napi_get_array_length(env, argv[1], &length))) return finish(&scope, NULL);
  tuple = PyTuple_New((Py_ssize_t)length); if (!tuple) return result(env, &scope, NULL);
  for (uint32_t i = 0; i < length; ++i) {
    if (!ok(env, napi_get_element(env, argv[1], i, &element)) || !(item = handle(env, element, 0))) { decref(tuple); return finish(&scope, NULL); }
    Py_IncRef(item->object);
    if (PyTuple_SetItem(tuple, (Py_ssize_t)i, item->object) != 0) { decref(tuple); return result(env, &scope, NULL); }
  }
  answer = PyObject_CallObject(function->object, tuple); decref(tuple); return result(env, &scope, answer);
}
static napi_value get_attr(napi_env env, napi_callback_info info) {
  napi_value argv[2]; Scope scope; Handle* object; PyObject *name, *answer;
  if (!arguments(env, info, 2, argv) || !begin(env, &scope)) return NULL;
  object = handle(env, argv[0], 0); if (!object) return finish(&scope, NULL);
  name = unicode_value(env, argv[1]); if (!name) return result(env, &scope, NULL);
  answer = PyObject_GetAttr(object->object, name); decref(name); return result(env, &scope, answer);
}
static napi_value set_attr(napi_env env, napi_callback_info info) {
  napi_value argv[3]; Scope scope; Handle *object, *replacement; PyObject* name; int status;
  if (!arguments(env, info, 3, argv) || !begin(env, &scope)) return NULL;
  object = handle(env, argv[0], 0); if (!object) return finish(&scope, NULL);
  name = unicode_value(env, argv[1]); if (!name) return result(env, &scope, NULL);
  replacement = handle(env, argv[2], 0); if (!replacement) { decref(name); return finish(&scope, NULL); }
  status = PyObject_SetAttr(object->object, name, replacement->object); decref(name);
  return status == 0 ? finish(&scope, js_null(env)) : result(env, &scope, NULL);
}
static napi_value get_item(napi_env env, napi_callback_info info) {
  napi_value argv[2]; Scope scope; Handle *object, *key;
  if (!arguments(env, info, 2, argv) || !begin(env, &scope)) return NULL;
  object = handle(env, argv[0], 0); key = object ? handle(env, argv[1], 0) : NULL;
  if (!key) return finish(&scope, NULL);
  return result(env, &scope, PyObject_GetItem(object->object, key->object));
}
static napi_value set_item(napi_env env, napi_callback_info info) {
  napi_value argv[3]; Scope scope; Handle *object, *key, *replacement;
  if (!arguments(env, info, 3, argv) || !begin(env, &scope)) return NULL;
  object = handle(env, argv[0], 0); key = object ? handle(env, argv[1], 0) : NULL; replacement = key ? handle(env, argv[2], 0) : NULL;
  if (!replacement) return finish(&scope, NULL);
  return PyObject_SetItem(object->object, key->object, replacement->object) == 0 ? finish(&scope, js_null(env)) : result(env, &scope, NULL);
}
static napi_value truth(napi_env env, napi_callback_info info) {
  napi_value argv[1]; Scope scope; Handle* object; int yes;
  if (!arguments(env, info, 1, argv) || !begin(env, &scope)) return NULL;
  object = handle(env, argv[0], 0); if (!object) return finish(&scope, NULL);
  yes = PyObject_IsTrue(object->object); return yes < 0 ? result(env, &scope, NULL) : finish(&scope, js_bool(env, yes));
}
static napi_value identity(napi_env env, napi_callback_info info) {
  napi_value argv[1], answer; Scope scope; Handle* object;
  if (!arguments(env, info, 1, argv) || !begin(env, &scope)) return NULL;
  object = handle(env, argv[0], 0); if (!object) return finish(&scope, NULL);
  if (!ok(env, napi_create_bigint_uint64(env, (uint64_t)(uintptr_t)object->object, &answer))) return finish(&scope, NULL);
  return finish(&scope, answer);
}
static napi_value dispose(napi_env env, napi_callback_info info) {
  napi_value argv[1]; Scope scope; Handle* object;
  if (!arguments(env, info, 1, argv) || !begin(env, &scope)) return NULL;
  object = handle(env, argv[0], 1); if (!object) return finish(&scope, NULL);
  if (!object->disposed && object->object) { PyObject* held = object->object; object->object = NULL; object->disposed = 1; decref(held); }
  return finish(&scope, js_null(env));
}
static napi_value long_js(napi_env env, PyObject* object) {
  PyObject* decimal = PyObject_Str(object); char* data; Py_ssize_t length; napi_value answer = NULL;
  if (!decimal) return NULL;
  if (PyString_AsStringAndSize(decimal, &data, &length) != 0) { decref(decimal); return NULL; }
  size_t capacity = (size_t)length / 9 + 2, used = 1; uint32_t* limbs = (uint32_t*)calloc(capacity, sizeof(uint32_t));
  if (!limbs) { decref(decimal); return bridge_error(env, "BigInt conversion allocation failed."); }
  int sign = length > 0 && data[0] == '-';
  for (Py_ssize_t i = sign; i < length; ++i) {
    if (data[i] < '0' || data[i] > '9') { free(limbs); decref(decimal); return bridge_error(env, "Unexpected native PyLong decimal output."); }
    uint64_t carry = (uint64_t)(data[i] - '0');
    for (size_t j = 0; j < used; ++j) { uint64_t next = (uint64_t)limbs[j] * 10 + carry; limbs[j] = (uint32_t)next; carry = next >> 32; }
    if (carry) limbs[used++] = (uint32_t)carry;
  }
  size_t word_count = (used + 1) / 2; uint64_t* words = (uint64_t*)calloc(word_count, sizeof(uint64_t));
  if (!words) { free(limbs); decref(decimal); return bridge_error(env, "BigInt word allocation failed."); }
  for (size_t i = 0; i < used; ++i) words[i / 2] |= (uint64_t)limbs[i] << ((i & 1) * 32);
  ok(env, napi_create_bigint_words(env, sign, word_count, words, &answer)); free(words); free(limbs); decref(decimal); return answer;
}
static napi_value describe(napi_env env, napi_callback_info info) {
  napi_value argv[1], answer, kind_value, scalar_value = NULL; Scope scope; Handle* object; PyObject* type; const char* kind = "opaque";
  if (!arguments(env, info, 1, argv) || !begin(env, &scope)) return NULL;
  object = handle(env, argv[0], 0); if (!object) return finish(&scope, NULL);
  type = PyObject_Type(object->object); if (!type) return result(env, &scope, NULL);
  if (object->object == none_object) { kind = "NoneType"; scalar_value = js_null(env); }
  else if (type == bool_type) { kind = "bool"; scalar_value = js_bool(env, PyObject_IsTrue(object->object)); }
  else if (type == int_type) { kind = "int"; long number = PyInt_AsLong(object->object); if (!PyErr_Occurred()) ok(env, napi_create_int32(env, (int32_t)number, &scalar_value)); }
  else if (type == long_type) { kind = "long"; scalar_value = long_js(env, object->object); }
  else if (type == float_type) { kind = "float"; double number = PyFloat_AsDouble(object->object); if (!PyErr_Occurred()) ok(env, napi_create_double(env, number, &scalar_value)); }
  else if (type == str_type) { char* bytes; Py_ssize_t length; kind = "str"; if (PyString_AsStringAndSize(object->object, &bytes, &length) == 0) ok(env, napi_create_buffer_copy(env, (size_t)length, bytes, NULL, &scalar_value)); }
  else if (type == unicode_type) { kind = "unicode"; scalar_value = unicode_js(env, object->object); }
  decref(type);
  if (PyErr_Occurred()) return result(env, &scope, NULL);
  bool throwing = false; napi_is_exception_pending(env, &throwing); if (throwing) return finish(&scope, NULL);
  if (!ok(env, napi_create_object(env, &answer)) || !ok(env, napi_create_string_utf8(env, kind, NAPI_AUTO_LENGTH, &kind_value)) || !ok(env, napi_set_named_property(env, answer, "kind", kind_value))) return finish(&scope, NULL);
  if (scalar_value && !ok(env, napi_set_named_property(env, answer, "value", scalar_value))) return finish(&scope, NULL);
  return finish(&scope, answer);
}
static napi_value init(napi_env env, napi_value exports) {
  napi_property_descriptor methods[] = {
    {"initialize",NULL,initialize,NULL,NULL,NULL,napi_default,NULL}, {"run",NULL,run,NULL,NULL,NULL,napi_default,NULL},
    {"getGlobal",NULL,get_global,NULL,NULL,NULL,napi_default,NULL}, {"value",NULL,value,NULL,NULL,NULL,napi_default,NULL},
    {"call",NULL,call,NULL,NULL,NULL,napi_default,NULL}, {"getAttr",NULL,get_attr,NULL,NULL,NULL,napi_default,NULL},
    {"setAttr",NULL,set_attr,NULL,NULL,NULL,napi_default,NULL}, {"getItem",NULL,get_item,NULL,NULL,NULL,napi_default,NULL},
    {"setItem",NULL,set_item,NULL,NULL,NULL,napi_default,NULL}, {"truth",NULL,truth,NULL,NULL,NULL,napi_default,NULL},
    {"describe",NULL,describe,NULL,NULL,NULL,napi_default,NULL}, {"identity",NULL,identity,NULL,NULL,NULL,napi_default,NULL},
    {"dispose",NULL,dispose,NULL,NULL,NULL,napi_default,NULL}
    ,{"loggingBackend",NULL,logging_backend,NULL,NULL,NULL,napi_default,NULL}
    ,{"wallclockBackend",NULL,wallclock_backend,NULL,NULL,NULL,napi_default,NULL}
    ,{"taskletTimerBackend",NULL,tasklet_timer_backend,NULL,NULL,NULL,napi_default,NULL}
  };
  return ok(env, napi_define_properties(env, exports, sizeof(methods)/sizeof(methods[0]), methods)) ? exports : NULL;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
