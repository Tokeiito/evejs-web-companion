/* Derived from CCP blue/src/blue.cpp AtomicFileRead/Write (MIT).
 * See src/gamePort/clientPreferences-LICENSE.txt.
 * Shipped 3396210 blue.dll: read 0x18034ac80, write 0x18034af80.
 * The write port deliberately covers the actual prefs_save single-str buffer,
 * not the shipped generic segmented Python 2 buffer protocol.
 */
#include "atomic_files.h"
#include <stdlib.h>

static HANDLE prefs_open(const wchar_t *path, DWORD access, DWORD sharing,
                         DWORD disposition, DWORD *error)
{
    HANDLE handle = INVALID_HANDLE_VALUE;
    int attempt;
    for (attempt = 0; attempt < 10; ++attempt) {
        handle = CreateFileW(path, access, sharing, NULL, disposition,
                            FILE_ATTRIBUTE_NORMAL | FILE_FLAG_SEQUENTIAL_SCAN, NULL);
        if (handle == INVALID_HANDLE_VALUE) {
            *error = GetLastError();
            if (*error == ERROR_SHARING_VIOLATION) {
                /* The original sleeps even after its tenth failed open. */
                Sleep(10);
                continue;
            }
        }
        break;
    }
    return handle;
}

int prefs_atomic_read(const wchar_t *path, char **out, size_t *length, DWORD *error)
{
    HANDLE handle;
    BY_HANDLE_FILE_INFORMATION info;
    DWORD file_size;
    DWORD read_count;
    char *buffer;

    *out = NULL;
    *length = 0;
    *error = 0;
    handle = prefs_open(path, GENERIC_READ, FILE_SHARE_READ, OPEN_EXISTING, error);
    if (handle == INVALID_HANDLE_VALUE)
        return PREFS_ATOMIC_OS_ERROR;

    file_size = GetFileSize(handle, NULL);
    if (file_size == INVALID_FILE_SIZE) {
        *error = GetLastError();
        CloseHandle(handle);
        return PREFS_ATOMIC_OS_ERROR;
    }
    if (!GetFileInformationByHandle(handle, &info)) {
        *error = GetLastError();
        CloseHandle(handle);
        return PREFS_ATOMIC_OS_ERROR;
    }

    /* malloc(0) is implementation-dependent; return a freeable empty buffer. */
    buffer = (char *)malloc(file_size ? (size_t)file_size : 1);
    if (buffer == NULL) {
        CloseHandle(handle);
        *error = 0;
        return PREFS_ATOMIC_NO_MEMORY;
    }
    if (!ReadFile(handle, buffer, file_size, &read_count, NULL)) {
        *error = GetLastError();
        CloseHandle(handle);
        free(buffer);
        return PREFS_ATOMIC_OS_ERROR;
    }
    /* Native read closes before testing the successful read's count. */
    CloseHandle(handle);
    *error = 0;
    if (read_count != file_size) {
        free(buffer);
        return PREFS_ATOMIC_SHORT_READ;
    }
    *out = buffer;
    *length = (size_t)file_size;
    return PREFS_ATOMIC_OK;
}

int prefs_atomic_write(const wchar_t *path, const char *data, size_t length, DWORD *error)
{
    HANDLE handle;
    DWORD written;

    *error = 0;
    handle = prefs_open(path, GENERIC_WRITE, 0, CREATE_ALWAYS, error);
    if (handle == INVALID_HANDLE_VALUE)
        return PREFS_ATOMIC_OS_ERROR;

    if (!WriteFile(handle, data, (DWORD)length, &written, NULL)) {
        *error = GetLastError();
        CloseHandle(handle);
        return PREFS_ATOMIC_OS_ERROR;
    }
    /* The shipped final (and actual prefs' only) segment closes first. Close
     * failure is ignored by both original implementations. No flush is added. */
    CloseHandle(handle);
    *error = 0;
    if ((size_t)written != length)
        return PREFS_ATOMIC_SHORT_WRITE;
    return PREFS_ATOMIC_OK;
}
