/* Selected CCP inactive tasklet timer. See clientPreferences-LICENSE.txt. */
#ifndef CLIENT_PREFS_TASKLET_TIMER_H
#define CLIENT_PREFS_TASKLET_TIMER_H
#include <windows.h>
#include <node_api.h>
struct _object;

/* Bind exported Python 2 APIs; the guard requires the active original owner. */
int prefs_timer_bind(HMODULE python, int (*owner_guard)(void));

/* Required synchronous callbacks: highRes/frequency/utcNow -> signed64 BigInt;
 * threadCPU/processCPU -> [kernelSigned64BigInt,userSigned64BigInt];
 * rawWarn(Buffer) -> any non-Promise result. Shared callback capsules retain
 * the actual Node owner. Creation performs the real Reset sample sequence.
 * Returns a Python module with EnterTasklet, ReturnFromTasklet, GetCurrent,
 * Reset, TimesliceReset and Inspect. Only the default inactive profile exists:
 * no active/frame/scheduler/telemetry or fabricated Blue pump capabilities.
 */
struct _object* prefs_timer_create(napi_env env, napi_value options);
#endif
