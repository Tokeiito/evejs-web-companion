#ifndef CLIENT_PREFS_LOG_BACKEND_H
#define CLIENT_PREFS_LOG_BACKEND_H
#include <windows.h>
#include <node_api.h>
struct _object;
// Guard must confirm the original runtime owner is inside an ordinary entry.
int prefs_log_bind(HMODULE python, int (*guard)(void));
struct _object* prefs_log_create(napi_env env, napi_value factory);
void prefs_log_drain(napi_env env);
void prefs_log_close(void);
#endif
