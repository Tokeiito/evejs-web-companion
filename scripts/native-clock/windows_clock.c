// Windows primitive bindings for core/CcpTime.cpp. Source-derived last-QPC
// behavior: Copyright (c) 2025 CCP Games, MIT; see
// ../../src/gamePort/clientClock-LICENSE.txt. No Blue engine is loaded.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <node_api.h>
#include <stdint.h>
#include <stdlib.h>

typedef struct { LARGE_INTEGER last; } Clock;
static const napi_type_tag clock_tag = { 0x688045e2c29b4c0bull, 0x856cce32a3a1217aull };
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
static napi_value init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    {"create", NULL, create, NULL, NULL, NULL, napi_default, NULL},
    {"timestamp", NULL, timestamp, NULL, NULL, NULL, napi_default, NULL},
    {"frequency", NULL, frequency, NULL, NULL, NULL, napi_default, NULL},
    {"ticks", NULL, ticks, NULL, NULL, NULL, napi_default, NULL},
    {"utc", NULL, utc, NULL, NULL, NULL, napi_default, NULL}
  };
  if (napi_define_properties(env, exports, sizeof(properties)/sizeof(properties[0]), properties) != napi_ok) return failure(env);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
