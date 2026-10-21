"use strict";

// Attribute identity collections, not a loaded-node registry. CPython2.7.1
// object/set/dict/tuple/weakref sources and original execution:
// cdxattributesetsagent1. Surrogate addresses define THIS domain's traversal;
// they do not recover retail heap order. JS WeakRef collection timing is also
// a boundary, not CPython reference-counting or native unload behavior.
const { hashKey } = require("./py27");
const DUMMY = Symbol("deleted identity key");
const namedError = (name, message) => Object.assign(new Error(message), { name });
const keyError = key => Object.assign(namedError("KeyError", "Identity key not found."), { key });
const isObject = value => value !== null && (typeof value === "object" || typeof value === "function");
const active = entry => entry !== undefined && entry !== DUMMY;

function operationInteger(value) {
  if (typeof value === "boolean") return value ? 1n : 0n;
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  throw new TypeError("An outgoing operation must be an exact integer.");
}

function tupleHash(first, second) {
  let value = 0x345678n, multiplier = 1000003n, remaining = 2n;
  for (const component of [first, second]) {
    remaining -= 1n;
    value = BigInt.asIntN(32, (value ^ BigInt(component)) * multiplier);
    multiplier = BigInt.asIntN(32, multiplier + 82520n + remaining * 2n);
  }
  const result = Number(BigInt.asIntN(32, value + 97531n));
  return result === -1 ? -2 : result;
}

// Identity equality cannot run arbitrary Python rich-comparison hooks. Both
// sets and dicts use this retained probe/deletion/resize history for that scope.
class IdentityTable {
  constructor(hash, equal, iterationError) {
    this.hash = hash;
    this.equal = equal;
    this.iterationError = iterationError;
    this.table = new Array(8);
    this.used = 0;
    this.fill = 0;
  }

  slot(key, hash) {
    const mask = BigInt(this.table.length - 1);
    let perturb = BigInt.asUintN(64, BigInt(hash)), index = perturb & mask, dummy = -1;
    for (;;) {
      const at = Number(index), entry = this.table[at];
      if (entry === undefined) return dummy < 0 ? at : dummy;
      if (entry === DUMMY) { if (dummy < 0) dummy = at; }
      else if (entry.hash === hash && this.equal(entry.key, key)) return at;
      index = BigInt.asUintN(64, index * 5n + perturb + 1n) & mask;
      perturb >>= 5n;
    }
  }

  resize(minimum) {
    let size = 8;
    while (size <= minimum) size *= 2;
    const previous = this.table;
    this.table = new Array(size);
    this.fill = this.used;
    for (const entry of previous) {
      if (active(entry)) this.table[this.slot(entry.key, entry.hash)] = entry;
    }
  }

  set(key, value) {
    const hash = this.hash(key), at = this.slot(key, hash), old = this.table[at];
    if (active(old)) { old.value = value; return; }
    if (old === undefined) this.fill += 1;
    this.table[at] = { key, hash, value };
    this.used += 1;
    if (this.fill * 3 >= this.table.length * 2) this.resize(this.used * (this.used > 50000 ? 2 : 4));
  }

  entry(key) {
    const entry = this.table[this.slot(key, this.hash(key))];
    return active(entry) ? entry : undefined;
  }

  remove(key, required) {
    const at = this.slot(key, this.hash(key));
    if (!active(this.table[at])) {
      if (required) throw keyError(key);
      return;
    }
    this.table[at] = DUMMY;
    this.used -= 1;
  }

  clear() {
    // CPython2.7.1 set_clear_internal451-511: reset the SAME live set to
    // minimum storage before releasing old entries. Existing iterators keep
    // their expected size/slot position; no generation invalidation is added.
    // Python destructor/refcount reentry is outside this JS identity domain.
    this.table = new Array(8);
    this.used = this.fill = 0;
  }

  copySet() {
    // set.copy -> make_new_set -> set_merge: one initial TWO-times-used
    // resize, then cached hashes in source slot order, without add growth.
    const copy = new IdentityTable(this.hash, this.equal, this.iterationError);
    if (this.used * 3 >= 16) copy.resize(this.used * 2);
    for (const entry of this.table) {
      if (!active(entry)) continue;
      copy.table[copy.slot(entry.key, entry.hash)] = { ...entry };
      copy.used += 1;
      copy.fill += 1;
    }
    return copy;
  }

  differenceUpdate(other) {
    if (other === this) {
      this.clear(); return;
    }
    for (const entry of other.table) {
      if (!active(entry)) continue;
      const at = this.slot(entry.key, entry.hash);
      if (active(this.table[at])) { this.table[at] = DUMMY; this.used -= 1; }
    }
    // set_difference_update_internal removes dummies once at least 1/5 of
    // the mask is dead, including the original empty/small-table cases.
    if ((this.fill - this.used) * 5 >= this.table.length - 1) this.resize(this.used * (this.used > 50000 ? 2 : 4));
  }

  iterator(project) {
    // Capture size when iter() is requested, not on the first generator next().
    let expected = this.used, position = 0, finished = false;
    return {
      [Symbol.iterator]() { return this; },
      next: () => {
        if (finished) return { done: true, value: undefined };
        if (expected !== this.used) {
          expected = -1; // Native mutation failure remains sticky.
          throw namedError("RuntimeError", this.iterationError);
        }
        while (position < this.table.length) {
          const entry = this.table[position++];
          if (active(entry)) return { done: false, value: project(entry) };
        }
        finished = true;
        return { done: true, value: undefined };
      },
    };
  }
}

class IdentityReference {
  #target;
  #hash;
  #cached;

  constructor(value, hash) { this.#target = new WeakRef(value); this.#hash = hash; }
  deref() { return this.#target.deref() ?? null; }
  hash() {
    if (this.#cached !== undefined) return this.#cached;
    const value = this.deref();
    if (value === null) throw new TypeError("weak object has gone away");
    this.#cached = this.#hash(value);
    return this.#cached;
  }
}

/** Explicit world-owned domain; no singleton is created. `hash`, when supplied,
 * must give every encountered object/function its stable signed32 native hash
 * (never -1); failed reads are retryable. Otherwise addresses are allocated in
 * first-encounter order from addressStart, in16-byte steps. No real heap or
 * bound-Python-method equality is inferred from these surrogate identities. */
function createClientDogmaIdentity({ hash: suppliedHash, addressStart = 0x100000000n } = {}) {
  if (suppliedHash !== undefined && typeof suppliedHash !== "function") throw new TypeError("hash must be a function.");
  if (typeof addressStart !== "bigint" || addressStart <= 0n || addressStart >= (1n << 64n) || addressStart % 16n !== 0n) {
    throw new TypeError("addressStart must be a positive aligned unsigned64 bigint.");
  }
  const identities = new WeakMap(), references = new WeakSet(), setTables = new WeakMap();
  let nextAddress = addressStart;
  function identity(value) {
    if (!isObject(value)) throw new TypeError("An object or function identity is required.");
    let entry = identities.get(value);
    if (entry === undefined) {
      if (nextAddress >= (1n << 64n)) throw new RangeError("Surrogate identity address space exhausted.");
      entry = { address: nextAddress, hash: undefined, reference: undefined };
      nextAddress += 16n;
      identities.set(value, entry);
    }
    return entry;
  }
  function hash(value) {
    const entry = identity(value);
    if (entry.hash !== undefined) return entry.hash;
    if (suppliedHash !== undefined) {
      const given = suppliedHash(value);
      if (typeof given !== "number" || !Number.isInteger(given) || given < -2147483648 || given > 2147483647 || given === -1) {
        throw new TypeError("A supplied native hash must be signed32 and cannot be -1.");
      }
      entry.hash = given;
    } else {
      const pointer = entry.address;
      const result = Number(BigInt.asIntN(32, BigInt.asUintN(64, (pointer >> 4n) | (pointer << 60n))));
      entry.hash = result === -1 ? -2 : result;
    }
    return entry.hash;
  }
  function weak(value) {
    const entry = identity(value);
    if (entry.reference === undefined) {
      entry.reference = Object.freeze(new IdentityReference(value, hash));
      references.add(entry.reference);
    }
    return entry.reference;
  }
  function setView(table, prepare = value => value) {
    const view = Object.freeze({
      add(value) { const key = prepare(value); table.set(key, key); },
      remove(value) { table.remove(prepare(value), true); },
      discard(value) { table.remove(prepare(value), false); },
      clear() { table.clear(); },
      has(value) { return table.entry(prepare(value)) !== undefined; },
      copy() { return setView(table.copySet(), prepare); },
      differenceUpdate(other) {
        const supplied = setTables.get(other);
        if (!supplied || supplied.hash !== table.hash || supplied.equal !== table.equal) {
          throw new TypeError("A compatible set from this identity domain is required.");
        }
        table.differenceUpdate(supplied);
      },
      get size() { return table.used; },
      [Symbol.iterator]() { return table.iterator(entry => entry.key); },
    });
    setTables.set(view, table);
    return view;
  }
  function pair(value) {
    if (!isObject(value) || !references.has(value.reference)) throw new TypeError("An outgoing reference from this identity domain is required.");
    operationInteger(value.operation);
    return Object.freeze({ operation: value.operation, reference: value.reference });
  }
  function callback(key) {
    if (typeof key !== "function") throw new TypeError("A callback function identity is required.");
    return key;
  }
  function modifier(value) {
    if (!isObject(value) || !isObject(value.attribute)) throw new TypeError("A strong modifier attribute is required.");
    operationInteger(value.operation);
    return Object.freeze({ operation: value.operation, attribute: value.attribute });
  }
  const sameIdentity = (a, b) => a === b;
  const modifierHash = key => tupleHash(hashKey(operationInteger(key.operation)), hash(key.attribute));
  const sameModifier = (a, b) => operationInteger(a.operation) === operationInteger(b.operation) && a.attribute === b.attribute;
  const outgoingHash = key => tupleHash(hashKey(operationInteger(key.operation)), key.reference.hash());
  const sameOutgoing = (a, b) => operationInteger(a.operation) === operationInteger(b.operation) && a.reference === b.reference;
  return Object.freeze({
    weak,
    strongSet() { return setView(new IdentityTable(hash, sameIdentity, "Set changed size during iteration")); },
    // Slim location/owner modifier maps hold STRONG (operation,Attribute)
    // tuples. Their tuple hashes match live weakrefs without weakening edges.
    modifierSet() { return setView(new IdentityTable(modifierHash, sameModifier, "Set changed size during iteration"), modifier); },
    outgoingSet() {
      return setView(new IdentityTable(
        outgoingHash, sameOutgoing,
        "Set changed size during iteration",
      ), pair);
    },
    callbackMap() {
      const table = new IdentityTable(hash, (a, b) => a === b, "dictionary changed size during iteration");
      return Object.freeze({
        set(key, value) { table.set(callback(key), value); },
        delete(key) { table.remove(callback(key), true); },
        has(key) { return table.entry(callback(key)) !== undefined; },
        get(key) { const entry = table.entry(callback(key)); if (entry === undefined) throw keyError(key); return entry.value; },
        get size() { return table.used; },
        [Symbol.iterator]() { return table.iterator(entry => [entry.key, entry.value]); },
      });
    },
  });
}

// Narrow shared core for separately validated VALUE-key policies. This does
// not change identity hashing/equality or imply that dict.copy == set.copy.
function createClientDogmaKeyTable({ hash, equal, iterationError }) {
  if (typeof hash !== "function" || typeof equal !== "function" || typeof iterationError !== "string") {
    throw new TypeError("A key hash/equality and iterator error policy are required.");
  }
  return new IdentityTable(hash, equal, iterationError);
}

module.exports = { createClientDogmaIdentity, createClientDogmaKeyTable };
