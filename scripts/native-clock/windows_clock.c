// Windows primitive bindings for core/CcpTime.cpp. Source-derived last-QPC
// behavior: Copyright (c) 2025 CCP Games, MIT; see
// ../../src/gamePort/clientClock-LICENSE.txt. No Blue engine is loaded.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <node_api.h>
#include <stdint.h>
#include <stdlib.h>

typedef struct { LARGE_INTEGER last; DWORD owner_thread; napi_env owner_env; } Clock;
// Version the tag with the owner layout: older clock handles have only last.
static const napi_type_tag clock_tag = { 0x688045e2c29b4c0bull, 0xa97aa16f351d2e84ull };
static napi_value failure(napi_env env) {
  napi_throw_error(env, NULL, "Windows clock binding operation failed.");
  return NULL;
}
static napi_value integer(napi_env env, uint64_t value) {
  napi_value result;
  if (napi_create_bigint_uint64(env, value, &result) != napi_ok) return failure(env);
  return result;
}
static void finalize(napi_env env, void* data, void* hint) { free(data); }
static napi_value create(napi_env env, napi_callback_info info) {
  Clock* clock = (Clock*)calloc(1, sizeof(Clock));
  napi_value handle;
  if (!clock) return failure(env);
  clock->owner_thread = GetCurrentThreadId(); clock->owner_env = env;
  if (napi_create_external(env, clock, finalize, NULL, &handle) != napi_ok) { free(clock); return failure(env); }
  if (napi_type_tag_object(env, handle, &clock_tag) != napi_ok) return failure(env);
  return handle;
}
static napi_value timestamp(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1]; bool valid = false; Clock* clock;
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc != 1 ||
      napi_check_object_type_tag(env, argv[0], &clock_tag, &valid) != napi_ok || !valid ||
      napi_get_value_external(env, argv[0], (void**)&clock) != napi_ok) return failure(env);
  LARGE_INTEGER value;
  // EXACT CcpGetTimestamp failure/backwards policy; one owner per emulated
  // client instead of sharing the native static last across independent clients.
  if (!QueryPerformanceCounter(&value)) return integer(env, (uint64_t)clock->last.QuadPart);
  if (value.QuadPart > clock->last.QuadPart) clock->last = value;
  else value = clock->last;
  return integer(env, (uint64_t)value.QuadPart);
}
static napi_value frequency(napi_env env, napi_callback_info info) {
  LARGE_INTEGER value;
  return integer(env, QueryPerformanceFrequency(&value) ? (uint64_t)value.QuadPart : 0);
}
static napi_value ticks(napi_env env, napi_callback_info info) { return integer(env, GetTickCount64()); }
static napi_value utc(napi_env env, napi_callback_info info) {
  ULARGE_INTEGER value;
  GetSystemTimeAsFileTime((FILETIME*)&value);
  return integer(env, value.QuadPart);
}
static Clock* cpu_owner(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1]; bool valid = false; Clock* clock;
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc != 1 ||
      napi_check_object_type_tag(env, argv[0], &clock_tag, &valid) != napi_ok || !valid ||
      napi_get_value_external(env, argv[0], (void**)&clock) != napi_ok) { failure(env); return NULL; }
  if (clock->owner_thread != GetCurrentThreadId() || clock->owner_env != env) {
    napi_throw_error(env, "WINDOWS_CLOCK_OWNER", "CPU time samplers require their original Node/Windows thread owner."); return NULL;
  }
  return clock;
}
static napi_value cpu_error(napi_env env, const char* syscall, DWORD code) {
  wchar_t message[1024]; napi_value text, error, number, operation;
  DWORD length = FormatMessageW(FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS, NULL, code, 0, message, 1024, NULL);
  if (length) {
    if (napi_create_string_utf16(env, (char16_t*)message, length, &text) != napi_ok) return failure(env);
  } else if (napi_create_string_utf8(env, "Windows CPU time query failed.", NAPI_AUTO_LENGTH, &text) != napi_ok) return failure(env);
  if (napi_create_error(env, NULL, text, &error) != napi_ok ||
      napi_create_uint32(env, code, &number) != napi_ok || napi_set_named_property(env, error, "win32Code", number) != napi_ok ||
      napi_create_string_utf8(env, syscall, NAPI_AUTO_LENGTH, &operation) != napi_ok || napi_set_named_property(env, error, "syscall", operation) != napi_ok) return failure(env);
  napi_throw(env, error); return NULL;
}
static napi_value cpu_pair(napi_env env, const FILETIME* kernel, const FILETIME* user) {
  ULARGE_INTEGER kernel_value, user_value; napi_value result, kernel_js, user_js;
  kernel_value.LowPart = kernel->dwLowDateTime; kernel_value.HighPart = kernel->dwHighDateTime;
  user_value.LowPart = user->dwLowDateTime; user_value.HighPart = user->dwHighDateTime;
  if (napi_create_array_with_length(env, 2, &result) != napi_ok ||
      napi_create_bigint_int64(env, (int64_t)kernel_value.QuadPart, &kernel_js) != napi_ok ||
      napi_create_bigint_int64(env, (int64_t)user_value.QuadPart, &user_js) != napi_ok ||
      napi_set_element(env, result, 0, kernel_js) != napi_ok || napi_set_element(env, result, 1, user_js) != napi_ok) return failure(env);
  return result;
}
static napi_value thread_cpu(napi_env env, napi_callback_info info) {
  if (!cpu_owner(env, info)) return NULL;
  FILETIME created, exited, kernel, user;
  // core/CcpThread.cpp107: actual current-thread counters in100ns units.
  if (!GetThreadTimes(GetCurrentThread(), &created, &exited, &kernel, &user)) return cpu_error(env, "GetThreadTimes", GetLastError());
  return cpu_pair(env, &kernel, &user);
}
static napi_value process_cpu(napi_env env, napi_callback_info info) {
  if (!cpu_owner(env, info)) return NULL;
  FILETIME created, exited, kernel, user;
  // core/CcpProcess.cpp11: process totals, never substituted for threadCPU.
  if (!GetProcessTimes(GetCurrentProcess(), &created, &exited, &kernel, &user)) return cpu_error(env, "GetProcessTimes", GetLastError());
  return cpu_pair(env, &kernel, &user);
}
static napi_value init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    {"create", NULL, create, NULL, NULL, NULL, napi_default, NULL},
    {"timestamp", NULL, timestamp, NULL, NULL, NULL, napi_default, NULL},
    {"frequency", NULL, frequency, NULL, NULL, NULL, napi_default, NULL},
    {"ticks", NULL, ticks, NULL, NULL, NULL, napi_default, NULL},
    {"utc", NULL, utc, NULL, NULL, NULL, napi_default, NULL},
    {"threadCPU", NULL, thread_cpu, NULL, NULL, NULL, napi_default, NULL},
    {"processCPU", NULL, process_cpu, NULL, NULL, NULL, napi_default, NULL}
  };
  if (napi_define_properties(env, exports, sizeof(properties)/sizeof(properties[0]), properties) != napi_ok) return failure(env);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
