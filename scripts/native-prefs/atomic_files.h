/* CCP Blue AtomicFileRead/Write Windows port. See clientPreferences-LICENSE.txt. */
#ifndef CLIENT_PREFS_ATOMIC_FILES_H
#define CLIENT_PREFS_ATOMIC_FILES_H

#include <stddef.h>
#include <wchar.h>
#include <windows.h>

#ifdef __cplusplus
extern "C" {
#endif

enum prefs_atomic_status {
    PREFS_ATOMIC_OK = 1,
    PREFS_ATOMIC_OS_ERROR = 0,
    PREFS_ATOMIC_SHORT_READ = -1,
    PREFS_ATOMIC_SHORT_WRITE = -2,
    PREFS_ATOMIC_NO_MEMORY = -3
};

/* Required, valid pointers are supplied by the Python wrapper. Paths are native
 * NUL-terminated UTF-16; the wrapper owns Python filename/buffer validation.
 * On read success, *out is malloc-owned (including an empty file), has *length
 * bytes, and must be freed with free() in this addon's CRT. No terminator is
 * promised. Failure leaves *out NULL and *length zero. *error is only meaningful
 * for OS_ERROR and contains the captured Win32 error, otherwise zero.
 *
 * These functions implement Windows sharing exclusion, not atomic replacement
 * or crash durability. Read uses GetFileSize(handle, NULL) exactly: low DWORD
 * 0xffffffff is rejected, and a high file-size DWORD is not inspected. Write
 * makes one DWORD-sized WriteFile call, then compares against the full length;
 * the supported real preference producer is a contiguous Python byte string.
 */
int prefs_atomic_read(const wchar_t *path, char **out, size_t *length, DWORD *error);
int prefs_atomic_write(const wchar_t *path, const char *data, size_t length, DWORD *error);

#ifdef __cplusplus
}
#endif

#endif
