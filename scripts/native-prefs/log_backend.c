// Local real JS logger capability for original Python logging bodies.
// No Blue type layout/engine, generic Python coercion rewrite, or parser.
#define WIN32_LEAN_AND_MEAN
#include "log_backend.h"
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

typedef struct _object PyObject;
typedef intptr_t Py_ssize_t;
typedef PyObject* (__cdecl *PyCFunction)(PyObject*, PyObject*);
typedef void (__cdecl *PyCapsuleDestructor)(PyObject*);
typedef struct { const char* name; PyCFunction method; int flags; const char* doc; } PyMethodDef;
#define API(X) \
 X(int, PyArg_ParseTuple, (PyObject*, const char*, ...)) \
 X(void, Py_IncRef, (PyObject*)) \
 X(void, Py_DecRef, (PyObject*)) \
 X(PyObject*, PyObject_Type, (PyObject*)) \
 X(int, PyType_IsSubtype, (void*, void*)) \
 X(PyObject*, PyObject_CallMethod, (PyObject*, char*, char*, ...)) \
 X(PyObject*, PyTuple_GetSlice, (PyObject*, Py_ssize_t, Py_ssize_t)) \
 X(Py_ssize_t, PyTuple_Size, (PyObject*)) \
 X(PyObject*, PyTuple_GetItem, (PyObject*, Py_ssize_t)) \
 X(int, PyString_AsStringAndSize, (PyObject*, char**, Py_ssize_t*)) \
 X(uint16_t*, PyUnicodeUCS2_AsUnicode, (PyObject*)) \
 X(Py_ssize_t, PyUnicodeUCS2_GetSize, (PyObject*)) \
 X(PyObject*, PyInt_FromLong, (long)) \
 X(PyObject*, PyErr_NoMemory, (void)) \
 X(void, PyErr_SetString, (PyObject*, const char*)) \
 X(PyObject*, PyCapsule_New, (void*, const char*, PyCapsuleDestructor)) \
 X(void*, PyCapsule_GetPointer, (PyObject*, const char*)) \
 X(PyObject*, PyModule_New, (const char*)) \
 X(int, PyModule_AddObject, (PyObject*, const char*, PyObject*)) \
 X(PyObject*, PyCFunction_NewEx, (PyMethodDef*, PyObject*, PyObject*))
#define DECL(ret, name, args) static ret (__cdecl *name) args;
API(DECL)
#undef DECL
static PyObject *none_object, *str_type, *unicode_type, **runtime_error, **type_error;
static int (*owner_guard)(void);
static int closed;
static const char* factory_name = "client.logging.factory";
static const char* channel_name = "client.logging.channel";

typedef struct Reference {
  napi_env env;
  napi_ref reference;
  struct Reference* next;
} Reference;
typedef struct { Reference js; } Factory;
typedef struct { Reference js; PyObject* factory; } Channel;
static Reference* pending;
static SRWLOCK queue_lock = SRWLOCK_INIT;

// Python capsule destruction may run while draining normal Python objects,
// or on another Python thread. It NEVER calls NAPI or JS: queue deletion.
static void enqueue(Reference* item) {
  AcquireSRWLockExclusive(&queue_lock); item->next = pending; pending = item; ReleaseSRWLockExclusive(&queue_lock);
}
static void factory_destroy(PyObject* capsule) {
  Factory* factory = (Factory*)PyCapsule_GetPointer(capsule, factory_name);
  if (factory) enqueue(&factory->js);
}
static void channel_destroy(PyObject* capsule) {
  Channel* channel = (Channel*)PyCapsule_GetPointer(capsule, channel_name);
  if (channel) { Py_DecRef(channel->factory); channel->factory = NULL; enqueue(&channel->js); }
}
void prefs_log_drain(napi_env env) {
  if (closed) return;
  Reference *list, *retained = NULL;
  AcquireSRWLockExclusive(&queue_lock); list = pending; pending = NULL; ReleaseSRWLockExclusive(&queue_lock);
  while (list) {
    Reference* next = list->next;
    if (list->env == env) { if (list->reference) napi_delete_reference(env, list->reference); free(list); }
    else { list->next = retained; retained = list; }
    list = next;
  }
  while (retained) { Reference* next = retained->next; enqueue(retained); retained = next; }
}
void prefs_log_close(void) { closed = 1; /* Never execute Python/NAPI during cleanup. */ }
static PyObject* fail(const char* message) { PyErr_SetString(*runtime_error, message); return NULL; }
static int allowed(void) { if (!closed && owner_guard && owner_guard()) return 1; fail("Logging requires its active original Node owner."); return 0; }
static int status(napi_env env, napi_status code) {
  if (code == napi_ok) return 1;
  bool throwing = false; napi_is_exception_pending(env, &throwing);
  if (throwing) { napi_value error; napi_get_and_clear_last_exception(env, &error); }
  fail("JavaScript logging backend callback failed."); return 0;
}
static int synchronous(napi_env env, napi_value value) {
  bool promise = false;
  if (!status(env, napi_is_promise(env, value, &promise))) return 0;
  if (promise) { fail("Logging requires a synchronous JavaScript backend."); return 0; }
  return 1;
}
static int invoke(Reference* target, const char* method, size_t argc, napi_value* argv, napi_value* result) {
  napi_value receiver, function;
  if (!status(target->env, napi_get_reference_value(target->env, target->reference, &receiver))) return 0;
  if (method) {
    if (!status(target->env, napi_get_named_property(target->env, receiver, method, &function))) return 0;
  } else {
    function = receiver;
    if (!status(target->env, napi_get_undefined(target->env, &receiver))) return 0;
  }
  if (!status(target->env, napi_call_function(target->env, receiver, function, argc, argv, result))) return 0;
  return synchronous(target->env, *result);
}
static int bytes_js(napi_env env, PyObject* value, napi_value* result) {
  char* bytes; Py_ssize_t length;
  if (PyString_AsStringAndSize(value, &bytes, &length) != 0) return 0;
  return status(env, napi_create_buffer_copy(env, (size_t)length, bytes, NULL, result));
}
static int text_kind(PyObject* value) {
  PyObject* type = PyObject_Type(value); if (!type) return 0;
  int kind = PyType_IsSubtype(type, str_type) ? 1 : PyType_IsSubtype(type, unicode_type) ? 2 : 0;
  Py_DecRef(type); return kind;
}
static int text_js(napi_env env, PyObject* value, int kind, napi_value* result) {
  if (kind == 1) return bytes_js(env, value, result);
  uint16_t* text = PyUnicodeUCS2_AsUnicode(value); if (!text) return 0;
  Py_ssize_t length = PyUnicodeUCS2_GetSize(value); if (length < 0) return 0;
  return status(env, napi_create_string_utf16(env, (char16_t*)text, (size_t)length, result));
}
static PyObject* remaining(PyObject* args, PyObject** prefix) {
  *prefix = PyTuple_GetItem(args, 0); if (!*prefix) return NULL;
  return PyTuple_GetSlice(args, 1, PyTuple_Size(args));
}
static Channel* get_channel(PyObject* capsule, PyObject* factory) {
  Channel* channel = (Channel*)PyCapsule_GetPointer(capsule, channel_name);
  if (channel && channel->factory != factory) { fail("A logging token belongs to another backend."); return NULL; }
  return channel;
}
static PyObject* create(PyObject* self, PyObject* args) {
  if (!allowed()) return NULL;
  PyObject *facility, *object;
  if (!PyArg_ParseTuple(args, "O!O!", str_type, &facility, str_type, &object)) return NULL;
  Factory* factory = (Factory*)PyCapsule_GetPointer(self, factory_name); if (!factory) return NULL;
  napi_value argv[2], result;
  if (!bytes_js(factory->js.env, facility, &argv[0]) || !bytes_js(factory->js.env, object, &argv[1]) || !invoke(&factory->js, NULL, 2, argv, &result)) return NULL;
  napi_valuetype type; napi_value null_value; bool is_null;
  if (!status(factory->js.env, napi_typeof(factory->js.env, result, &type)) || !status(factory->js.env, napi_get_null(factory->js.env, &null_value)) || !status(factory->js.env, napi_strict_equals(factory->js.env, result, null_value, &is_null))) return NULL;
  if (type != napi_object || is_null) return fail("A real JavaScript logging channel object is required.");
  Channel* channel = (Channel*)calloc(1, sizeof(*channel)); if (!channel) return PyErr_NoMemory();
  channel->js.env = factory->js.env;
  if (!status(factory->js.env, napi_create_reference(factory->js.env, result, 1, &channel->js.reference))) { free(channel); return NULL; }
  Py_IncRef(self); channel->factory = self;
  PyObject* capsule = PyCapsule_New(channel, channel_name, channel_destroy);
  if (!capsule) { Py_DecRef(self); enqueue(&channel->js); }
  return capsule;
}
static PyObject* is_open(PyObject* self, PyObject* args) {
  if (!allowed()) return NULL;
  PyObject *token, *slice = remaining(args, &token); if (!slice) return NULL;
  int flag = -1, parsed = PyArg_ParseTuple(slice, "|i", &flag); Py_DecRef(slice); if (!parsed) return NULL;
  Channel* channel = get_channel(token, self); if (!channel) return NULL;
  napi_value argument, result;
  if (!status(channel->js.env, napi_create_int32(channel->js.env, flag, &argument)) || !invoke(&channel->js, "IsOpen", 1, &argument, &result)) return NULL;
  napi_valuetype type; double number;
  if (!status(channel->js.env, napi_typeof(channel->js.env, result, &type))) return NULL;
  if (type != napi_number) return fail("IsOpen backend must return integer zero or one.");
  if (!status(channel->js.env, napi_get_value_double(channel->js.env, result, &number))) return NULL;
  if (number != 0 && number != 1) return fail("IsOpen backend must return integer zero or one.");
  return PyInt_FromLong((long)number);
}
static PyObject* log_message(PyObject* self, PyObject* args) {
  if (!allowed()) return NULL;
  PyObject *token, *text, *slice = remaining(args, &token); if (!slice) return NULL;
  int flag = 1, backstack = 0, parsed = PyArg_ParseTuple(slice, "O|ii", &text, &flag, &backstack);
  // text remains owned by the original args tuple after the slice is dropped.
  Py_DecRef(slice); if (!parsed) return NULL;
  int kind = text_kind(text);
  if (!kind) { PyErr_SetString(*type_error, "expected string or unicode object"); return NULL; }
  Channel* channel = get_channel(token, self); if (!channel) return NULL;
  napi_value argv[3], result;
  if (!text_js(channel->js.env, text, kind, &argv[0]) || !status(channel->js.env, napi_create_int32(channel->js.env, flag, &argv[1])) || !status(channel->js.env, napi_create_int32(channel->js.env, backstack, &argv[2])) || !invoke(&channel->js, "Log", 3, argv, &result)) return NULL;
  Py_IncRef(none_object); return none_object;
}
static PyObject* counter(PyObject* self, PyObject* args) {
  if (!allowed()) return NULL;
  PyObject *receiver, *text, *slice = remaining(args, &receiver); if (!slice) return NULL;
  int parsed = PyArg_ParseTuple(slice, "O", &text); Py_DecRef(slice); if (!parsed) return NULL;
  if (!text_kind(text)) { PyErr_SetString(*type_error, "expected string or unicode"); return NULL; }
  return PyObject_CallMethod(receiver, "Log", "Oi", text, 1);
}
static PyMethodDef methods[] = {
  {"create", create, 1, "Create an actual local backend channel token."},
  {"is_open", is_open, 1, "Native |i arguments after channel token."},
  {"log", log_message, 1, "Native O|ii arguments after channel token."},
  {"counter", counter, 1, "Native dynamic self.Log(text,1)."}
};
int prefs_log_bind(HMODULE python, int (*guard)(void)) {
#define LOAD(ret, name, args) name = (ret (__cdecl *) args)GetProcAddress(python, #name); if (!name) return 0;
  API(LOAD)
#undef LOAD
  none_object = (PyObject*)GetProcAddress(python, "_Py_NoneStruct");
  str_type = (PyObject*)GetProcAddress(python, "PyString_Type");
  unicode_type = (PyObject*)GetProcAddress(python, "PyUnicode_Type");
  runtime_error = (PyObject**)GetProcAddress(python, "PyExc_RuntimeError");
  type_error = (PyObject**)GetProcAddress(python, "PyExc_TypeError");
  owner_guard = guard;
  return none_object && str_type && unicode_type && runtime_error && type_error;
}
PyObject* prefs_log_create(napi_env env, napi_value callback) {
  if (!allowed()) return NULL;
  napi_valuetype type;
  if (!status(env, napi_typeof(env, callback, &type))) return NULL;
  if (type != napi_function) return fail("A synchronous real channel factory is required.");
  Factory* factory = (Factory*)calloc(1, sizeof(*factory)); if (!factory) return PyErr_NoMemory();
  factory->js.env = env;
  if (!status(env, napi_create_reference(env, callback, 1, &factory->js.reference))) { free(factory); return NULL; }
  PyObject* capsule = PyCapsule_New(factory, factory_name, factory_destroy);
  if (!capsule) { enqueue(&factory->js); return NULL; }
  PyObject* module = PyModule_New("_client_logging_backend");
  if (!module) { Py_DecRef(capsule); return NULL; }
  for (size_t i = 0; i < sizeof(methods)/sizeof(methods[0]); ++i) {
    PyObject* method = PyCFunction_NewEx(&methods[i], capsule, NULL);
    if (!method || PyModule_AddObject(module, methods[i].name, method) != 0) { if (method) Py_DecRef(method); Py_DecRef(module); Py_DecRef(capsule); return NULL; }
  }
  Py_DecRef(capsule); return module;
}
