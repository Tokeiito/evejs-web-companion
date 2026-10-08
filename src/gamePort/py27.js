"use strict";

// The parts of CPython 2.7 that decide what the retail client's bytes look like.
//
// The retail client is Python (Stackless 2.7.1, 64-bit Windows). When it sends a
// dict, the entries go out in the dict's own iteration order, and that order is
// a product of CPython's string hash and its open-addressing table. To send the
// same bytes we have to reproduce both.
//
// Everything here is checked against the client's own python27.dll: see
// scripts/py27-oracle.py and test/gamePortPy27.test.js.
//
// ⚠ 64-bit WINDOWS, specifically. A C `long` is 32 bits there, so a hash is a
// 32-bit signed number, and any Python int above 2^31-1 is a `long` object with
// its own hash function. Neither is true of CPython 2.7 on Linux.

const PERTURB_SHIFT = 5n;
const MIN_TABLE_SIZE = 8;
const LONG_DIGIT_BITS = 30n;
const LONG_DIGIT_MASK = (1n << LONG_DIGIT_BITS) - 1n;

/** Wrap to a C `long` on 64-bit Windows: 32 bits, signed. */
function toInt32(value) {
  return Number(BigInt.asIntN(32, BigInt(value)));
}

/** hash() never returns -1; CPython keeps that for "error". */
const notMinusOne = (hash) => (hash === -1 ? -2 : hash);

/** string_hash: a byte string, given here as a JS string of latin1 code units. */
function hashString(text) {
  if (text.length === 0) return 0;
  let x = BigInt(text.charCodeAt(0)) << 7n;
  for (let index = 0; index < text.length; index += 1) {
    x = BigInt.asIntN(32, (1000003n * x) ^ BigInt(text.charCodeAt(index)));
  }
  x ^= BigInt(text.length);
  return notMinusOne(toInt32(x));
}

/** long_hash: for an integer too big to be a Python int on this platform. */
function hashLong(value) {
  let magnitude = value < 0n ? -value : value;
  const digits = [];
  while (magnitude > 0n) {
    digits.push(magnitude & LONG_DIGIT_MASK);
    magnitude >>= LONG_DIGIT_BITS;
  }
  let x = 0n; // unsigned long, 32 bits
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    x = BigInt.asUintN(32, (x >> (32n - LONG_DIGIT_BITS)) | (x << LONG_DIGIT_BITS));
    x = BigInt.asUintN(32, x + digits[index]);
    if (x < digits[index]) x += 1n;
  }
  const signed = BigInt.asIntN(32, value < 0n ? -x : x);
  return notMinusOne(Number(signed));
}

/** hash() of a dict key: a byte string or an integer. */
function hashKey(key) {
  if (typeof key === "string") return hashString(key);
  if (typeof key === "number" && Number.isInteger(key)) {
    // An int hashes to itself. Above the 32-bit range it is a long.
    return key >= -2147483648 && key <= 2147483647 ? notMinusOne(key) : hashLong(BigInt(key));
  }
  if (typeof key === "bigint") {
    return key >= -2147483648n && key <= 2147483647n ? notMinusOne(Number(key)) : hashLong(key);
  }
  throw new TypeError(`No Python 2.7 hash is implemented for a ${typeof key} key.`);
}

/** The slot CPython's lookdict settles on for a hash in a table with no deletions. */
function findSlot(table, hash) {
  const mask = BigInt(table.length - 1);
  // `perturb` is a size_t: a negative hash is sign-extended to 64 bits, then unsigned.
  let perturb = BigInt.asUintN(64, BigInt(hash));
  let index = perturb & mask;
  while (table[Number(index)] !== undefined) {
    index = BigInt.asUintN(64, index * 5n + perturb + 1n);
    perturb >>= PERTURB_SHIFT;
    index &= mask;
  }
  return Number(index);
}

function resized(table, minimumUsed) {
  let size = MIN_TABLE_SIZE;
  while (size <= minimumUsed) size *= 2;
  const next = new Array(size);
  for (const entry of table) {
    if (entry !== undefined) next[findSlot(next, entry.hash)] = entry;
  }
  return next;
}

/**
 * The order CPython 2.7 iterates a dict built by inserting `keys` in order.
 *
 * `presized` is the number of entries a dict LITERAL was written with: a
 * `{...}` display of more than five entries allocates its table up front
 * (BUILD_MAP), which changes where entries land. Pass 0 for a dict that began
 * empty (`{}`, `dict()`, keyword arguments).
 *
 * Covers insertion only. A dict that had entries deleted, or was built by
 * copy() or update() from another dict, lays itself out differently.
 */
function dictOrder(keys, { presized = 0 } = {}) {
  let table = new Array(MIN_TABLE_SIZE);
  if (presized > 5) table = resized(table, presized);
  let used = 0;
  const seen = new Set();
  for (const key of keys) {
    const identity = `${typeof key === "string" ? "s" : "i"}:${key}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const hash = hashKey(key);
    table[findSlot(table, hash)] = { key, hash };
    used += 1;
    if (used * 3 >= table.length * 2) {
      table = resized(table, (used > 50000 ? 2 : 4) * used);
    }
  }
  return table.filter((entry) => entry !== undefined).map((entry) => entry.key);
}

/** `entries` ([key, value] pairs in insertion order) in CPython 2.7 iteration order. */
function orderEntries(entries, options) {
  const byKey = new Map(entries.map((entry) => [entry[0], entry]));
  return dictOrder(entries.map(([key]) => key), options).map((key) => byKey.get(key));
}

module.exports = { dictOrder, hashKey, hashLong, hashString, orderEntries };
