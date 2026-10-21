/* Copyright (c) 2014 CCP ehf.
 * Selected default-inactive TaskletTimer, derived from CCP blue/src/
 * TaskletTimer.cpp/.h (MIT; src/gamePort/clientPreferences-LICENSE.txt).
 * Shipped 3396210: constructor 0x1803208b0, Enter 0x180320e40,
 * Return 0x180321460, GetCurrent 0x180320d40, warning 0x180322610.
 * Python2 differences are deliberate: PyInt flags/warning tuples, byte-str
 * no-context result, PyObject_Str(None) == 'None' in warning output.
 * No Blue engine, Python layouts, noop profile or active/frame accounting.
 */
#define WIN32_LEAN_AND_MEAN
#include "tasklet_timer.h"
#include "log_backend.h"
#include <stdint.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <math.h>
#include <limits.h>

typedef struct _object PyObject;
typedef intptr_t Py_ssize_t;
typedef PyObject* (__cdecl *PyCFunction)(PyObject*, PyObject*);
typedef void (__cdecl *PyCapsuleDestructor)(PyObject*);
typedef struct { const char* name; PyCFunction method; int flags; const char* doc; } PyMethodDef;
#define API(X) \
 X(void, Py_IncRef, (PyObject*)) \
 X(void, Py_DecRef, (PyObject*)) \
 X(int, PyArg_UnpackTuple, (PyObject*, const char*, Py_ssize_t, Py_ssize_t, ...)) \
 X(long, PyInt_AsLong, (PyObject*)) \
 X(PyObject*, PyInt_FromLong, (long)) \
 X(PyObject*, PyLong_FromLongLong, (long long)) \
 X(PyObject*, PyLong_FromUnsignedLongLong, (unsigned long long)) \
 X(PyObject*, PyBool_FromLong, (long)) \
 X(PyObject*, PyDict_New, (void)) \
 X(PyObject*, PyDict_GetItem, (PyObject*, PyObject*)) \
 X(int, PyDict_SetItem, (PyObject*, PyObject*, PyObject*)) \
 X(int, PyDict_SetItemString, (PyObject*, const char*, PyObject*)) \
 X(void, PyDict_Clear, (PyObject*)) \
 X(PyObject*, PyTuple_New, (Py_ssize_t)) \
 X(PyObject*, PyTuple_GetItem, (PyObject*, Py_ssize_t)) \
 X(int, PyTuple_SetItem, (PyObject*, Py_ssize_t, PyObject*)) \
 X(PyObject*, PyObject_Str, (PyObject*)) \
 X(PyObject*, PyString_FromString, (const char*)) \
 X(int, PyString_AsStringAndSize, (PyObject*, char**, Py_ssize_t*)) \
 X(PyObject*, PyErr_Occurred, (void)) \
 X(void, PyErr_Clear, (void)) \
 X(void, PyErr_SetString, (PyObject*, const char*)) \
 X(PyObject*, PyErr_NoMemory, (void)) \
 X(PyObject*, PyCapsule_New, (void*, const char*, PyCapsuleDestructor)) \
 X(void*, PyCapsule_GetPointer, (PyObject*, const char*)) \
 X(PyObject*, PyModule_New, (const char*)) \
 X(int, PyModule_AddObject, (PyObject*, const char*, PyObject*)) \
 X(PyObject*, PyCFunction_NewEx, (PyMethodDef*, PyObject*, PyObject*))
#define DECL(ret, name, args) static ret (__cdecl *name) args;
API(DECL)
#undef DECL

static PyObject *none_object, **runtime_error;
static int (*owner_guard)(void);
static const char* state_name = "client.tasklet_timer.inactive";
enum { HIGH_RES, FREQUENCY, THREAD_CPU, PROCESS_CPU, UTC_NOW, RAW_WARN, CALLBACKS };
typedef struct { int64_t kernel, user; } Cpu;
typedef struct {
    napi_env env;
    PyObject* callbacks[CALLBACKS];
    PyObject* context;
    PyObject* warnings;
    double inverse_frequency;
    int64_t frequency;
    int64_t last_time, last_user, last_kernel, last_switch, last_warn;
    int64_t reset_time;
    Cpu reset_thread, reset_process;
    int32_t flags;
    uint64_t warning_count;
} TimerState;

static PyObject* fail(const char* message) {
    PyErr_SetString(*runtime_error, message); return NULL;
}
static void decref(PyObject* value) { if (value) Py_DecRef(value); }
static PyObject* retained(PyObject* value) { Py_IncRef(value); return value; }
static int allowed(void) {
    if (owner_guard && owner_guard()) return 1;
    fail("Tasklet timer requires its active original Node owner."); return 0;
}
static int js_ok(napi_env env, napi_status status) {
    if (status == napi_ok) return 1;
    bool pending = false;
    napi_is_exception_pending(env, &pending);
    if (pending) { napi_value error; napi_get_and_clear_last_exception(env, &error); }
    fail("Tasklet timer native callback value operation failed."); return 0;
}
static int signed64(TimerState* state, napi_value value, int64_t* result) {
    napi_valuetype type; bool lossless = false;
    if (!js_ok(state->env, napi_typeof(state->env, value, &type))) return 0;
    if (type != napi_bigint) { fail("Tasklet timer sample requires a signed64 BigInt."); return 0; }
    if (!js_ok(state->env, napi_get_value_bigint_int64(state->env, value, result, &lossless))) return 0;
    if (!lossless) { fail("Tasklet timer sample is outside signed64."); return 0; }
    return 1;
}
static int scalar_sample(TimerState* state, int callback, int64_t* result) {
    napi_value value;
    return prefs_callback_invoke(state->callbacks[callback], 0, NULL, &value) && signed64(state, value, result);
}
static int cpu_sample(TimerState* state, int callback, Cpu* result) {
    napi_value value, kernel, user; bool array = false; uint32_t length;
    if (!prefs_callback_invoke(state->callbacks[callback], 0, NULL, &value)) return 0;
    if (!js_ok(state->env, napi_is_array(state->env, value, &array))) return 0;
    if (!array) { fail("Tasklet timer CPU sample requires [kernel,user]."); return 0; }
    if (!js_ok(state->env, napi_get_array_length(state->env, value, &length))) return 0;
    if (length != 2) { fail("Tasklet timer CPU sample requires exactly two values."); return 0; }
    if (!js_ok(state->env, napi_get_element(state->env, value, 0, &kernel)) ||
        !js_ok(state->env, napi_get_element(state->env, value, 1, &user))) return 0;
    return signed64(state, kernel, &result->kernel) && signed64(state, user, &result->user);
}
static int difference(int64_t a, int64_t b, int64_t* result) {
    if ((b > 0 && a < INT64_MIN + b) || (b < 0 && a > INT64_MAX + b)) {
        fail("Tasklet timer signed64 delta is outside the supported native domain."); return 0;
    }
    *result = a - b; return 1;
}
static int milliseconds(TimerState* state, int64_t now, int64_t from, int32_t* result) {
    int64_t delta = 0;
    if (from && !difference(now, from, &delta)) return 0;
    double value = (double)delta * state->inverse_frequency;
    if (!isfinite(value) || value < -2147483648.0 || value >= 2147483648.0) {
        fail("Tasklet timer millisecond cast is outside signed32."); return 0;
    }
    *result = (int32_t)value; return 1;
}

/* Actual builtin dict/key semantics, not stringified contexts. Native ignores
 * SetItem failure and continues with the pending Python error; keep that
 * observable ordering. Unchecked allocation/invalid tuple cases are bounded. */
static int update_warning(TimerState* state, PyObject* context, int32_t ms) {
    PyObject* old = PyDict_GetItem(state->warnings, context);
    long count = 1;
    if (old) {
        PyObject* item = PyTuple_GetItem(old, 0); if (!item) return -1;
        long previous = PyInt_AsLong(item);
        if (previous == -1 && PyErr_Occurred()) { PyErr_Clear(); previous = 0; }
        if (ms <= previous) return 0;
        item = PyTuple_GetItem(old, 1); if (!item) return -1;
        count = PyInt_AsLong(item);
        if (count == LONG_MAX) { fail("Tasklet warning count is outside native signed32."); return -1; }
        ++count;
    }
    PyObject* pair = PyTuple_New(2); if (!pair) return -1;
    PyObject* time_value = PyInt_FromLong(ms), *count_value = PyInt_FromLong(count);
    if (!time_value || !count_value) { decref(time_value); decref(count_value); decref(pair); return -1; }
    if (PyTuple_SetItem(pair, 0, time_value) != 0) { decref(count_value); decref(pair); return -1; }
    if (PyTuple_SetItem(pair, 1, count_value) != 0) { decref(pair); return -1; }
    PyDict_SetItem(state->warnings, context, pair); /* Source ignores status. */
    decref(pair); return 1;
}
static PyObject* warning_string(PyObject* object) {
    PyObject* text = PyObject_Str(object);
    if (!text) { PyErr_Clear(); text = PyString_FromString("<bad>"); }
    return text;
}
static int warn_slice(TimerState* state, int64_t now, const char* what, PyObject* next) {
    int32_t recent, total;
    if (!milliseconds(state, now, state->last_warn, &recent)) return 0;
    if (recent < 200) return 1;
    if (!milliseconds(state, now, state->last_switch, &total)) return 0;
    int update = update_warning(state, state->context, total);
    if (update < 0) return 0;
    if (!update) return 1;
    state->last_warn = now;

    float ratio = (float)total / 200;
    float order_float = ceilf(logf(ratio) / logf(2.0f));
    if (!isfinite(order_float) || order_float < -2147483648.0f || order_float >= 2147483648.0f) {
        fail("Tasklet timer warning order is outside native signed32."); return 0;
    }
    int order = (int)order_float;
    /* Source evaluates OLD str before NEW str; None is not special-cased in
     * shipped Python2. C-string output deliberately stops at embedded NUL. */
    PyObject* old_text = warning_string(state->context);
    if (!old_text) return 0;
    PyObject* new_text = warning_string(next);
    if (!new_text) { decref(old_text); return 0; }
    char *old_bytes, *new_bytes; Py_ssize_t ignored;
    if (PyString_AsStringAndSize(old_text, &old_bytes, &ignored) != 0 ||
        PyString_AsStringAndSize(new_text, &new_bytes, &ignored) != 0) {
        decref(new_text); decref(old_text); return 0;
    }
    const char* format = "!! timeslice {\"time\": %d, \"order\": %d, \"what\": \"%s\", \"new\": \"%s\", \"old\": \"%s\"}";
    /* SimpleJson appends in this order and does not escape quotes/backslashes.
     * This is deliberately not a general JSON serializer. */
    int required = snprintf(NULL, 0, format, total, order, what, new_bytes, old_bytes);
    if (required < 0) { decref(new_text); decref(old_text); fail("Tasklet warning byte formatting is outside the supported domain."); return 0; }
    char* message = (char*)malloc((size_t)required + 1);
    if (!message) { decref(new_text); decref(old_text); PyErr_NoMemory(); return 0; }
    snprintf(message, (size_t)required + 1, format, total, order, what, new_bytes, old_bytes);
    napi_value bytes, result;
    int ok = js_ok(state->env, napi_create_buffer_copy(state->env, (size_t)required, message, NULL, &bytes));
    if (ok) ok = prefs_callback_invoke(state->callbacks[RAW_WARN], 1, &bytes, &result);
    free(message);
    if (ok) ++state->warning_count; /* Native stats increment follows dispatch. */
    decref(new_text); decref(old_text); return ok;
}
static int timeslice_reset(TimerState* state) {
    int64_t now; if (!scalar_sample(state, HIGH_RES, &now)) return 0;
    state->last_switch = state->last_warn = now; return 1;
}
static int reset(TimerState* state) {
    int64_t now; Cpu captured;
    if (!scalar_sample(state, HIGH_RES, &now) || !cpu_sample(state, THREAD_CPU, &captured)) return 0;
    /* There are no active frames, interned frame keys, telemetry or static
     * frame stats in this explicitly inactive owner. Real warning keys clear. */
    PyDict_Clear(state->warnings);
    if (!cpu_sample(state, THREAD_CPU, &state->reset_thread) ||
        !cpu_sample(state, PROCESS_CPU, &state->reset_process) ||
        !scalar_sample(state, UTC_NOW, &state->reset_time)) return 0;
    state->last_time = now; state->last_kernel = captured.kernel; state->last_user = captured.user;
    state->last_switch = state->last_warn = now;
    return 1;
}
static TimerState* timer(PyObject* self) {
    if (!allowed()) return NULL;
    return (TimerState*)PyCapsule_GetPointer(self, state_name);
}
static PyObject* enter(PyObject* self, PyObject* args) {
    TimerState* state = timer(self); PyObject *context, *flags = NULL; long value = 0;
    if (!state || !PyArg_UnpackTuple(args, "EnterTasklet", 1, 2, &context, &flags)) return NULL;
    if (flags) { value = PyInt_AsLong(flags); if (value == -1 && PyErr_Occurred()) return NULL; }
    state->flags = (int32_t)value;
    int64_t now;
    if (!scalar_sample(state, HIGH_RES, &now) || !warn_slice(state, now, "entering", context)) return NULL;
    PyObject* old = retained(state->context);
    Py_IncRef(context); decref(state->context); state->context = context;
    return old;
}
static PyObject* leave(PyObject* self, PyObject* args) {
    TimerState* state = timer(self); PyObject* context;
    if (!state || !PyArg_UnpackTuple(args, "ReturnFromTasklet", 1, 1, &context)) return NULL;
    if (state->flags) { if (!timeslice_reset(state)) return NULL; state->flags = 0; }
    int64_t now;
    if (!scalar_sample(state, HIGH_RES, &now) || !warn_slice(state, now, "returning to", context)) return NULL;
    Py_IncRef(context); decref(state->context); state->context = context;
    return retained(none_object);
}
static PyObject* current(PyObject* self, PyObject* args) {
    if (!timer(self) || !PyArg_UnpackTuple(args, "GetCurrent", 0, 0)) return NULL;
    return PyString_FromString("<NO CONTEXT>");
}
static PyObject* reset_method(PyObject* self, PyObject* args) {
    TimerState* state = timer(self);
    if (!state || !PyArg_UnpackTuple(args, "Reset", 0, 0) || !reset(state)) return NULL;
    return retained(none_object);
}
static PyObject* slice_method(PyObject* self, PyObject* args) {
    TimerState* state = timer(self);
    if (!state || !PyArg_UnpackTuple(args, "TimesliceReset", 0, 0) || !timeslice_reset(state)) return NULL;
    return retained(none_object);
}
static int put(PyObject* dict, const char* key, PyObject* value) {
    if (!value) return 0;
    int status = PyDict_SetItemString(dict, key, value); decref(value); return status == 0;
}
static PyObject* inspect(PyObject* self, PyObject* args) {
    TimerState* state = timer(self);
    if (!state || !PyArg_UnpackTuple(args, "Inspect", 0, 0)) return NULL;
    PyObject* dict = PyDict_New(); if (!dict) return NULL;
    if (!put(dict, "active", PyBool_FromLong(0)) || !put(dict, "timesliceWarning", PyInt_FromLong(200)) ||
        !put(dict, "context", retained(state->context)) || !put(dict, "warnings", retained(state->warnings)) ||
        !put(dict, "flags", PyInt_FromLong(state->flags)) || !put(dict, "frequency", PyLong_FromLongLong(state->frequency)) ||
        !put(dict, "lastSwitch", PyLong_FromLongLong(state->last_switch)) || !put(dict, "lastWarn", PyLong_FromLongLong(state->last_warn)) ||
        !put(dict, "lastTime", PyLong_FromLongLong(state->last_time)) || !put(dict, "lastUser", PyLong_FromLongLong(state->last_user)) ||
        !put(dict, "lastKernel", PyLong_FromLongLong(state->last_kernel)) || !put(dict, "resetTime", PyLong_FromLongLong(state->reset_time)) ||
        !put(dict, "resetThreadKernel", PyLong_FromLongLong(state->reset_thread.kernel)) ||
        !put(dict, "resetThreadUser", PyLong_FromLongLong(state->reset_thread.user)) ||
        !put(dict, "resetProcessKernel", PyLong_FromLongLong(state->reset_process.kernel)) ||
        !put(dict, "resetProcessUser", PyLong_FromLongLong(state->reset_process.user)) ||
        !put(dict, "warningCount", PyLong_FromUnsignedLongLong(state->warning_count)) ||
        !put(dict, "pumpInfo", retained(none_object))) { decref(dict); return NULL; }
    return dict;
}
static PyMethodDef methods[] = {
    {"EnterTasklet", enter, 1, "Real default-inactive context entry."},
    {"ReturnFromTasklet", leave, 1, "Real default-inactive context restoration."},
    {"GetCurrent", current, 1, "No active frame: native byte-str placeholder."},
    {"Reset", reset_method, 1, "Actual QPC, CPU and UTC reset sampling."},
    {"TimesliceReset", slice_method, 1, "Actual QPC warning-slice reset."},
    {"Inspect", inspect, 1, "Local adapter state; no Blue pump/frame readiness."}
};
static void destroy(PyObject* capsule) {
    TimerState* state = (TimerState*)PyCapsule_GetPointer(capsule, state_name);
    if (!state) return;
    for (int i = 0; i < CALLBACKS; ++i) decref(state->callbacks[i]);
    decref(state->context); decref(state->warnings); free(state);
}
int prefs_timer_bind(HMODULE python, int (*guard)(void)) {
#define LOAD(ret, name, args) name = (ret (__cdecl *) args)GetProcAddress(python, #name); if (!name) return 0;
    API(LOAD)
#undef LOAD
    none_object = (PyObject*)GetProcAddress(python, "_Py_NoneStruct");
    runtime_error = (PyObject**)GetProcAddress(python, "PyExc_RuntimeError");
    owner_guard = guard; return none_object && runtime_error && guard;
}
PyObject* prefs_timer_create(napi_env env, napi_value options) {
    static const char* names[CALLBACKS] = {"highRes", "frequency", "threadCPU", "processCPU", "utcNow", "rawWarn"};
    if (!allowed()) return NULL;
    TimerState* state = (TimerState*)calloc(1, sizeof(*state));
    if (!state) return PyErr_NoMemory();
    state->env = env;
    PyObject* capsule = PyCapsule_New(state, state_name, destroy);
    if (!capsule) { free(state); return NULL; }
    for (int i = 0; i < CALLBACKS; ++i) {
        napi_value function;
        if (!js_ok(env, napi_get_named_property(env, options, names[i], &function)) ||
            !(state->callbacks[i] = prefs_callback_create(env, function))) { decref(capsule); return NULL; }
    }
    if (!scalar_sample(state, FREQUENCY, &state->frequency)) { decref(capsule); return NULL; }
    if (state->frequency <= 0) { decref(capsule); return fail("Tasklet timer requires a positive native QPC frequency."); }
    state->inverse_frequency = 1000.0 / (double)state->frequency;
    state->context = retained(none_object); state->warnings = PyDict_New();
    if (!state->warnings || !reset(state)) { decref(capsule); return NULL; }
    PyObject* module = PyModule_New("companion.default_inactive_tasklet_timer");
    if (!module) { decref(capsule); return NULL; }
    for (size_t i = 0; i < sizeof(methods)/sizeof(methods[0]); ++i) {
        PyObject* function = PyCFunction_NewEx(&methods[i], capsule, NULL);
        if (!function) { decref(module); decref(capsule); return NULL; }
        if (PyModule_AddObject(module, methods[i].name, function) != 0) { decref(function); decref(module); decref(capsule); return NULL; }
    }
    decref(capsule); return module;
}
