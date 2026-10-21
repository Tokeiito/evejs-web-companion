"use strict";

// invCacheContainer.cachedItems is a retained Python2 dict. Its List iterates
// the table, including the effects of previous deletions and resizes. Sorting
// or building a fresh dict from a Map's current keys loses that history.
const { hashKey } = require("./py27");
const DUMMY = Symbol("deleted inventory key");

// pilotInventory.itemKey encodes a fitted charge's three-integer tuple with
// slashes. Hash the original tuple, never that internal string representation.
function itemHash(key) {
  if (typeof key !== "string") return hashKey(key);
  const parts = key.split("/");
  if (parts.length !== 3 || !parts.every(part => /^-?\d+$/.test(part))) {
    throw new TypeError("An inventory key must be numeric or a charge tuple.");
  }
  let x = 0x345678n, multiplier = 1000003n, left = parts.length;
  for (const part of parts) {
    left -= 1;
    x = BigInt.asIntN(32, BigInt.asIntN(32, x ^ BigInt(hashKey(BigInt(part)))) * multiplier);
    multiplier = BigInt.asIntN(32, multiplier + 82520n + BigInt(left) * 2n);
  }
  const result = Number(BigInt.asIntN(32, x + 97531n));
  return result === -1 ? -2 : result;
}

const sameKey = (a, b) => typeof a === "string" || typeof b === "string" ? a === b : BigInt(a) === BigInt(b);

/** The Map operations used by the inventory cache, with retained CPython2 table order. */
class InventoryItems {
  constructor() {
    this.table = new Array(8);
    this.used = 0;
    this.fill = 0;
  }

  _slot(key, hash) {
    const mask = BigInt(this.table.length - 1);
    let perturb = BigInt.asUintN(64, BigInt(hash)), index = perturb & mask, firstDummy = -1;
    for (;;) {
      const at = Number(index), entry = this.table[at];
      if (entry === undefined) return firstDummy < 0 ? at : firstDummy;
      if (entry === DUMMY) { if (firstDummy < 0) firstDummy = at; }
      else if (entry.hash === hash && sameKey(entry.key, key)) return at;
      index = BigInt.asUintN(64, index * 5n + perturb + 1n) & mask;
      perturb >>= 5n;
    }
  }

  _resize(minimumUsed) {
    let size = 8;
    while (size <= minimumUsed) size *= 2;
    const previous = this.table;
    this.table = new Array(size);
    this.fill = this.used;
    for (const entry of previous) {
      if (entry !== undefined && entry !== DUMMY) this.table[this._slot(entry.key, entry.hash)] = entry;
    }
  }

  set(key, value) {
    const hash = itemHash(key), at = this._slot(key, hash), previous = this.table[at];
    if (previous !== undefined && previous !== DUMMY) {
      previous.value = value;
      return this;
    }
    if (previous === undefined) this.fill += 1;
    this.used += 1;
    this.table[at] = { key, hash, value };
    if (this.fill * 3 >= this.table.length * 2) this._resize((this.used > 50000 ? 2 : 4) * this.used);
    return this;
  }

  has(key) {
    const entry = this.table[this._slot(key, itemHash(key))];
    return entry !== undefined && entry !== DUMMY;
  }

  get(key) {
    const entry = this.table[this._slot(key, itemHash(key))];
    return entry === undefined || entry === DUMMY ? undefined : entry.value;
  }

  delete(key) {
    const at = this._slot(key, itemHash(key)), entry = this.table[at];
    if (entry === undefined || entry === DUMMY) return false;
    this.table[at] = DUMMY;
    this.used -= 1;
    return true;
  }

  *values() {
    for (const entry of this.table) if (entry !== undefined && entry !== DUMMY) yield entry.value;
  }
}

module.exports = { InventoryItems };
