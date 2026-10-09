"use strict";

// The parts of CPython 2.7 that decide what the retail client's packets hold.
//
// The retail client is Python (Stackless 2.7.1, 64-bit Windows). When it sends a
// dict, the entries go out in the dict's own iteration order, and that order is
// a product of CPython's string hash and its open-addressing table. To send the
// same entries in the same order we have to reproduce both.
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

/** Two keys are the same dict key: 5 and 5L are, 5 and "5" are not. */
const sameKey = (a, b) => (typeof a === "string" || typeof b === "string" ? a === b : BigInt(a) === BigInt(b));

/** lookdict: the slot holding `key`, or the empty slot it would go in. No deletions. */
function findSlot(table, hash, key) {
  const mask = BigInt(table.length - 1);
  // `perturb` is a size_t: a negative hash is sign-extended to 64 bits, then unsigned.
  let perturb = BigInt.asUintN(64, BigInt(hash));
  let index = perturb & mask;
  for (;;) {
    const entry = table[Number(index)];
    if (entry === undefined || (entry.hash === hash && sameKey(entry.key, key))) return Number(index);
    index = BigInt.asUintN(64, index * 5n + perturb + 1n) & mask;
    perturb >>= PERTURB_SHIFT;
  }
}

/** dictresize: the smallest power of two above `minimumUsed`, refilled in slot order. */
function resized(table, minimumUsed) {
  let size = MIN_TABLE_SIZE;
  while (size <= minimumUsed) size *= 2;
  const next = new Array(size);
  for (const entry of table) {
    if (entry !== undefined) next[findSlot(next, entry.hash, entry.key)] = entry;
  }
  return next;
}

/**
 * A CPython 2.7 dict, as far as its key order goes. Keys only; no deletions.
 */
class Dict {
  constructor() {
    this.table = new Array(MIN_TABLE_SIZE);
    this.used = 0;
  }

  /**
   * A dict display, `{k1: v, k2: v, ...}`: BUILD_MAP allocates the table for
   * the number of entries written when there are more than five.
   */
  static literal(keys) {
    const dict = new Dict();
    if (keys.length > 5) dict.table = resized(dict.table, keys.length);
    for (const key of keys) dict.set(key);
    return dict;
  }

  _insert(key, hash) {
    const slot = findSlot(this.table, hash, key);
    if (this.table[slot] === undefined) this.used += 1;
    this.table[slot] = { key, hash };
  }

  /** d[key] = value: PyDict_SetItem, which grows the table when it is two-thirds full. */
  set(key) {
    const before = this.used;
    this._insert(key, hashKey(key));
    if (this.used > before && this.used * 3 >= this.table.length * 2) {
      this.table = resized(this.table, (this.used > 50000 ? 2 : 4) * this.used);
    }
    return this;
  }

  /**
   * d.copy(), and so copy.copy(d): PyDict_Merge into a new dict. One resize up
   * front if it will be needed, then the entries in the source's slot order,
   * with no growth check as they go in.
   *
   * ⚠ The resize is to FOUR times the entry count in the client's interpreter
   * (measured: a 6-entry copy has 32 slots, an 8-entry one 64). Reading the
   * CPython source from memory says two; the interpreter says four.
   */
  copy() {
    const copy = new Dict();
    if (this.used === 0) return copy;
    if (this.used * 3 >= copy.table.length * 2) copy.table = resized(copy.table, this.used * 4);
    for (const entry of this.table) {
      if (entry !== undefined) copy._insert(entry.key, entry.hash);
    }
    return copy;
  }

  /** The keys in iteration order: slot order. */
  keys() {
    return this.table.filter((entry) => entry !== undefined).map((entry) => entry.key);
  }
}

/**
 * The order CPython 2.7 iterates a dict built by inserting `keys` in order.
 *
 * `presized` is the number of entries a dict LITERAL was written with. Pass 0
 * for a dict that began empty (`{}`, `dict()`).
 */
function dictOrder(keys, { presized = 0 } = {}) {
  if (presized > 5) return Dict.literal(keys).keys();
  const dict = new Dict();
  for (const key of keys) dict.set(key);
  return dict.keys();
}

/** `entries` ([key, value] pairs in insertion order) in CPython 2.7 iteration order. */
function orderEntries(entries, options) {
  const byKey = new Map(entries.map((entry) => [entry[0], entry]));
  return dictOrder(entries.map(([key]) => key), options).map((key) => byKey.get(key));
}

/**
 * The order a remote call's keywords go out in, given the order they were
 * written at the call site: `thing.Method(a, first=1, second=2)`.
 *
 * Every step below makes a new dict, and a new dict can order two keys that
 * want the same slot differently, so the steps have to be the client's own:
 *
 *   via "function"  A remote SERVICE's method is a plain function
 *                   (MachoServiceConnection.__getattr__ returns a closure). The
 *                   interpreter fills its **kwargs in the order written.
 *   via "object"    A BOUND OBJECT's method is an object with __call__
 *                   (MachoObjectCallWrapper). The interpreter first collects
 *                   the keywords by popping its stack, LAST one first, and then
 *                   fills __call__'s **kwargs from that dict's order.
 *
 * Either way the GPCS layer then copies the dict (copy.copy) and adds
 * machoVersion. `hops` is for a path with further **keywords functions in it;
 * the client's own two paths have none.
 */
function keywordOrder(written, { via = "function", hops = 0, added = ["machoVersion"] } = {}) {
  let dict = new Dict();
  if (via === "object") {
    const collected = new Dict();
    for (const key of [...written].reverse()) collected.set(key);
    for (const key of collected.keys()) dict.set(key);
  } else {
    for (const key of written) dict.set(key);
  }
  for (let hop = 0; hop < hops; hop += 1) {
    const next = new Dict();
    for (const key of dict.keys()) next.set(key);
    dict = next;
  }
  const sent = dict.copy();
  for (const key of added) sent.set(key);
  return sent.keys();
}

/** moniker.py Bind's localKeywords: what a call's keywords say to the client itself, and are not sent. */
const MONIKER_LOCAL_KEYWORDS = new Set(["machoTimeout", "noCallThrottling"]);

/**
 * The order the keywords of a call go in when the call rides along with a
 * Moniker's bind (moniker.py). MonikerCallWrap is an object with __call__, so
 * the interpreter collects them as for a bound object's method; Bind then
 * builds a new dict of them, without the client's own two. Nothing is added:
 * machoVersion goes on the bind's own keywords.
 */
function monikerKeywordOrder(written) {
  const collected = new Dict();
  for (const key of [...written].reverse()) collected.set(key);
  const keywords = new Dict();
  for (const key of collected.keys()) keywords.set(key);
  const sent = new Dict();
  for (const key of keywords.keys()) if (!MONIKER_LOCAL_KEYWORDS.has(key)) sent.set(key);
  return sent.keys();
}

module.exports = { Dict, dictOrder, hashKey, hashLong, hashString, keywordOrder, monikerKeywordOrder, orderEntries };
