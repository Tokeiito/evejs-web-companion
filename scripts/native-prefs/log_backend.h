#ifndef CLIENT_PREFS_LOG_BACKEND_H
#define CLIENT_PREFS_LOG_BACKEND_H
#include <windows.h>
#include <node_api.h>
struct _object;
// Guard must confirm the original runtime owner is inside an ordinary entry.
int prefs_log_bind(HMODULE python, int (*guard)(void));
struct _object* prefs_log_create(napi_env env, napi_value factory);
struct _object* prefs_wallclock_create(napi_env env, napi_value sampler);
// Shared real synchronous callbacks. Capsules queue NAPI release until a
// normal entry on the original owner; native consumers never own JS refs.
struct _object* prefs_callback_create(napi_env env, napi_value callback);
int prefs_callback_invoke(struct _object* capsule, size_t argc, napi_value* argv, napi_value* result);
void prefs_log_drain(napi_env env);
void prefs_log_close(void);
#endif
