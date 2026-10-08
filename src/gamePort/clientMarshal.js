"use strict";

// The marshal encoder for what the CLIENT sends.
//
// src/gameProtocol/marshal.js is the server's codec, and its encoder writes
// what the server writes. In one respect the client writes something else, and
// the server tells the two apart:
//
//   A whole number the client holds as a Python `long` goes out as opcode 0x2f:
//   a byte count, then that many bytes of little-endian two's complement
//   (blue's WriteLong). On 64-bit Windows every integer above 2^31-1 is a long,
//   and so is anything the client made with long(): its call IDs, a bound
//   object's node ID, a timestamp.
//
//   The server's encoder has no 0x2f. It writes a large integer as an int64
//   (0x03), which the server's own DECODER reads back as a BigInt, where it
//   reads 0x2f as a plain number. So an item ID sent as int64 reaches a handler
//   as 9988400103291n instead of 9988400103291, and handlers written against
//   the retail client's numbers then compare it, look it up or JSON-print it
//   wrongly. Seen live: every read on a ship's inventory answered None, with
//   "Do not know how to serialize a BigInt" in the server's log.
//
// Everything else is the server codec's own encoding, reused: this walks the
// containers and hands every other value to it.
//
// How a value is read:
//   number, whole, within 32 bits   a Python int
//   number, whole, beyond 32 bits   a Python long (it cannot be an int there)
//   bigint                          a Python long
//   {type: "long", value}           a Python long, however small

const { marshalEncode, Op, MARSHAL_HEADER } = require("../gameProtocol/marshal");

const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;
/** The stream header the stock encoder puts in front of a value: 0x7e and a zero share count. */
const HEADER_LENGTH = 5;

function sizeEx(size) {
  if (size < 0xff) return Buffer.from([size]);
  const buffer = Buffer.alloc(5);
  buffer[0] = 0xff;
  buffer.writeUInt32LE(size, 1);
  return buffer;
}

/** A whole number as little-endian two's complement in as few bytes as hold it. Zero is no bytes. */
function longBytes(value) {
  let remaining = BigInt(value);
  const bytes = [];
  if (remaining === 0n) return bytes;
  for (;;) {
    const byte = Number(remaining & 0xffn);
    bytes.push(byte);
    remaining >>= 8n; // arithmetic: a negative number stays negative
    // Done once what is left is only the sign this byte's top bit already says.
    const negative = (byte & 0x80) !== 0;
    if ((remaining === 0n && !negative) || (remaining === -1n && negative)) return bytes;
  }
}

/** blue's WriteLong: 0x2f, a byte count, then the bytes. */
function writeLong(value, chunks) {
  const bytes = longBytes(value);
  chunks.push(Buffer.from([Op.PyVarInteger]), sizeEx(bytes.length), Buffer.from(bytes));
}

/** A value with no children, as the stock encoder writes it, without the stream header. */
const leaf = (value) => marshalEncode(value).subarray(HEADER_LENGTH);

function write(value, chunks) {
  if (typeof value === "bigint") {
    writeLong(value, chunks);
    return;
  }
  if (typeof value === "number" && Number.isInteger(value) && (value < INT32_MIN || value > INT32_MAX)) {
    writeLong(value, chunks);
    return;
  }
  if (Array.isArray(value)) {
    writeTuple(value, chunks);
    return;
  }
  if (value === null || typeof value !== "object" || Buffer.isBuffer(value)) {
    chunks.push(leaf(value));
    return;
  }
  switch (value.type) {
    case "long":
      writeLong(value.value, chunks);
      return;
    case "tuple":
      writeTuple(value.items ?? [], chunks);
      return;
    case "list": {
      const items = value.items ?? [];
      if (items.length === 0) chunks.push(Buffer.from([Op.PyEmptyList]));
      else if (items.length === 1) chunks.push(Buffer.from([Op.PyOneList]));
      else chunks.push(Buffer.from([Op.PyList]), sizeEx(items.length));
      for (const item of items) write(item, chunks);
      return;
    }
    case "dict": {
      const entries = value.entries ?? [];
      chunks.push(Buffer.from([Op.PyDict]), sizeEx(entries.length));
      // The value first, then its key.
      for (const [key, entry] of entries) {
        write(entry, chunks);
        write(key, chunks);
      }
      return;
    }
    case "object":
      chunks.push(Buffer.from([Op.PyObject]));
      write(value.name, chunks);
      write(value.args, chunks);
      return;
    case "substruct":
      chunks.push(Buffer.from([Op.PySubStruct]));
      write(value.value, chunks);
      return;
    case "substream": {
      const inner = encodeClient(value.value);
      chunks.push(Buffer.from([Op.PySubStream]), sizeEx(inner.length), inner);
      return;
    }
    default:
      // A unicode string, a byte string, a token, a real: no integers inside.
      chunks.push(leaf(value));
  }
}

function writeTuple(items, chunks) {
  if (items.length === 0) chunks.push(Buffer.from([Op.PyEmptyTuple]));
  else if (items.length === 1) chunks.push(Buffer.from([Op.PyOneTuple]));
  else if (items.length === 2) chunks.push(Buffer.from([Op.PyTwoTuple]));
  else chunks.push(Buffer.from([Op.PyTuple]), sizeEx(items.length));
  for (const item of items) write(item, chunks);
}

/** A value as the client's blue.marshal.Save writes it: a whole stream, header included. */
function encodeClient(value) {
  const chunks = [Buffer.from([MARSHAL_HEADER, 0, 0, 0, 0])];
  write(value, chunks);
  return Buffer.concat(chunks);
}

/** An explicit Python long: a value the client holds as a long however small it is. */
const long = (value) => ({ type: "long", value });

module.exports = { encodeClient, long };
