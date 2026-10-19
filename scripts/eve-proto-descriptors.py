"""The retail client's own protobuf descriptors, as a FileDescriptorSet.

The client speaks to the public gateway in protobuf messages it generated from CCP's
eve_public protos (eveProto/generated/..._pb2.py). Each generated module carries its
.proto file's descriptor, serialized, in its FileDescriptor(serialized_pb=b'...').
This reads those bytes from the decompiled client's modules (the tree
eve.js/tools/ClientCodeGrabber/Latest), following each module's imports of other
generated modules and of google.protobuf's, and writes them as one
FileDescriptorSet, each file after the files it imports.

    python scripts/eve-proto-descriptors.py <decompiled client tree> <out .bin> <module> [<module> ...]

    <module>   a generated module's dotted name, "eveProto.generated.eve_public.public_pb2"

scripts/eve-proto-schema.js turns the set into the schema the BFF reads
(src/gamePort/eveProtoSchema.json).
"""

import ast
import os
import re
import sys

IMPORT = re.compile(r"^from (eveProto\.generated(?:\.\w+)*|google\.protobuf) import (\w+_pb2)\b", re.M)
SERIALIZED = "serialized_pb="


def module_path(tree, dotted):
    return os.path.join(tree, *dotted.split(".")) + ".py"


def serialized_descriptor(source, dotted):
    at = source.find(SERIALIZED)
    if at < 0:
        sys.exit("%s has no serialized descriptor." % dotted)
    start = at + len(SERIALIZED)
    # A bytes literal (b'...'), or a Python 2 str one ('...'), which is bytes there: each of its characters one
    # byte (the decompiler writes every other byte as an escape).
    prefix = 1 if source[start] == "b" else 0
    quote = source[start + prefix]
    if quote not in ("'", '"'):
        sys.exit("%s's descriptor is not a string literal." % dotted)
    end = start + prefix + 1
    while True:
        end = source.index(quote, end)
        backslashes = 0
        while source[end - 1 - backslashes] == "\\":
            backslashes += 1
        if backslashes % 2 == 0:
            break
        end += 1
    value = ast.literal_eval(source[start:end + 1])
    return value if isinstance(value, bytes) else value.encode("latin-1")


def collect(tree, dotted, seen, ordered):
    if dotted in seen:
        return
    seen.add(dotted)
    path = module_path(tree, dotted)
    if not os.path.isfile(path):
        sys.exit("No module at %s." % path)
    with open(path, "r", encoding="utf-8", errors="surrogateescape") as handle:
        source = handle.read()
    for package, name in IMPORT.findall(source):
        if name in ("descriptor_pb2",) and package == "google.protobuf":
            continue
        collect(tree, package + "." + name, seen, ordered)
    ordered.append((dotted, serialized_descriptor(source, dotted)))


def varint(number):
    out = bytearray()
    while True:
        byte = number & 0x7F
        number >>= 7
        if number:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


def main():
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    tree, out_path, modules = sys.argv[1], sys.argv[2], sys.argv[3:]
    seen, ordered = set(), []
    for dotted in modules:
        collect(tree, dotted, seen, ordered)
    with open(out_path, "wb") as out:
        for _dotted, descriptor in ordered:
            out.write(b"\x0a" + varint(len(descriptor)) + descriptor)
    for dotted, descriptor in ordered:
        print("%6d  %s" % (len(descriptor), dotted))


if __name__ == "__main__":
    main()
