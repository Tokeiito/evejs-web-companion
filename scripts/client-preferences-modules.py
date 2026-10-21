"""Capture the installed code archive for the native Python2 prefs host.

No decompiled source or client code is distributed. The immutable cache is a
local snapshot of the user's code.ccp, in the caller's ignored data directory.
The installed zipimporter reads .pyj members itself. The host verifies each
original co_filename before delegating module loading to that real importer.
"""
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import zipfile


def publish(directory, name, content):
    target = directory / name
    fd, temporary = tempfile.mkstemp(prefix="capture-", dir=directory)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(content)
        try:
            os.link(temporary, target)
        except FileExistsError:
            if target.read_bytes() != content:
                raise RuntimeError("A conflicting immutable preference module cache exists.")
    finally:
        os.unlink(temporary)
    return target


def main():
    if len(sys.argv) != 4:
        raise SystemExit("client-preferences-modules.py <code.ccp> <python27.dll> <cache root>")
    archive, dll, cache = map(Path, sys.argv[1:])
    captured = archive.read_bytes()
    archive_hash = hashlib.sha256(captured).hexdigest()
    python_hash = hashlib.sha256(dll.read_bytes()).hexdigest()
    with zipfile.ZipFile(io.BytesIO(captured)) as code:
        members = code.namelist()
        for required in ("eveprefs/__init__.pyj", "eveprefs/filebased.pyj", "eveprefs/iniformat.pyj", "encodings/cp1252.pyj"):
            if required not in members:
                raise RuntimeError("Missing installed preference dependency: " + required)
    identity = hashlib.sha256((archive_hash + python_hash + "prefs-archive-v2").encode("ascii")).hexdigest()
    directory = cache.resolve() / identity
    directory.mkdir(parents=True, exist_ok=True)
    filename = publish(directory, "code.ccp", captured)
    metadata = {
        "archiveSHA256": archive_hash, "pythonSHA256": python_hash,
        "filename": str(filename), "archiveMembers": len(members),
    }
    publish(directory, "manifest.json", json.dumps(metadata, ensure_ascii=True, sort_keys=True).encode("ascii"))
    print(json.dumps(metadata, ensure_ascii=True))


if __name__ == "__main__":
    main()
