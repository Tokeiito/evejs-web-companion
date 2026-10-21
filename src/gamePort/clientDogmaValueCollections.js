"use strict";

// Cold-world VALUE collections, not strong object/Attribute sets or a loaded
// registry. Numeric/ASCII/tuple rules: installed Python2.7.1 Windows, py27 and
// cdxvaluecollectionsagent1; table history reuses the audited identity core.
// No None/custom-object/float/callable key hash, general update/copy-dict/pop,
// iterable constructor, snapshot keys/values/items or Python3 iterator rules.
const { types: { isPromise } } = require("node:util");
const { hashKey } = require("./py27");
const { createClientDogmaKeyTable } = require("./clientDogmaIdentity");
const { ClientDogmaConstructorPrimitiveNotReadyError } = require("./clientDogmaConstructorPrimitives");
const notReady = part => new ClientDogmaConstructorPrimitiveNotReadyError(part);
const keyError = key => Object.assign(new Error("Value key not found."), { name: "KeyError", key, args: [key] });

/** One immutable-key policy domain. bool keys are an explicit opt-in, then
 * compare/hash as 0/1 without replacing an earlier numeric key. Kind strings
 * are exact ASCII byte-string tokens supplied before use, not arbitrary text.
 * Tuples are domain-branded immutable component arrays; brands/flavor names
 * never participate in native equality or hash. No JS-array identity keys. */
function createClientDogmaValueCollections({ lockKinds = ["LoadItem"], allowBooleanKeys = false } = {}) {
  if (typeof allowBooleanKeys !== "boolean" || !Array.isArray(lockKinds) ||
    !lockKinds.every(kind => typeof kind === "string" && /^[\x00-\x7f]*$/.test(kind))) {
    throw notReady("fixed ASCII value-key policy");
  }
  const kinds = new Set(lockKinds), tuples = new WeakMap(), sets = new WeakMap();
  function numeric(key) {
    if (typeof key === "bigint" || (typeof key === "number" && Number.isSafeInteger(key))) return key;
    if (allowBooleanKeys && typeof key === "boolean") return key;
    throw notReady("exact numeric value key");
  }
  const integer = key => typeof key === "boolean" ? (key ? 1n : 0n) : BigInt(key);
  function components(key) { return key !== null && typeof key === "object" ? tuples.get(key) : undefined; }
  function prepare(key) {
    if (components(key) !== undefined) return key;
    if (typeof key === "string") {
      if (kinds.has(key)) return key;
      throw notReady("declared ASCII value key");
    }
    return numeric(key);
  }
  function hash(key) {
    const parts = components(key);
    if (parts === undefined) return hashKey(typeof key === "boolean" ? integer(key) : key);
    let value = 0x345678n, multiplier = 1000003n, remaining = parts.length;
    for (const part of parts) {
      remaining -= 1;
      value = BigInt.asIntN(32, (value ^ BigInt(hash(part))) * multiplier);
      multiplier = BigInt.asIntN(32, multiplier + 82520n + BigInt(remaining) * 2n);
    }
    const result = Number(BigInt.asIntN(32, value + 97531n));
    return result === -1 ? -2 : result;
  }
  function equal(a, b) {
    if (a === b) return true;
    const left = components(a), right = components(b);
    if (left !== undefined || right !== undefined) {
      return left !== undefined && right !== undefined && left.length === right.length && left.every((part, index) => equal(part, right[index]));
    }
    if (typeof a === "string" || typeof b === "string") return a === b;
    return integer(a) === integer(b);
  }
  function tuple(parts) {
    // Private only: public constructors below validate supported native shapes.
    const items = Object.freeze(parts), key = Object.freeze({ items });
    tuples.set(key, items);
    return key;
  }
  function item(key) {
    const parts = components(key);
    if (parts !== undefined) {
      if (parts.length !== 3) throw notReady("three-numeric DBLess item key");
      for (const part of parts) numeric(part);
      return key;
    }
    return numeric(key);
  }
  const newTable = kind => createClientDogmaKeyTable({ hash, equal, iterationError: kind === "set" ? "Set changed size during iteration" : "dictionary changed size during iteration" });
  function remove(table, key) {
    const original = prepare(key);
    try { table.remove(original, true); }
    catch (error) {
      // Adapt only this core's missing-key signal. Keep the raw caller key in
      // args; the diagnostic message is emulator text, not native strx proof.
      if (error?.name === "KeyError" && error.key === original) throw keyError(key);
      throw error;
    }
  }
  function setView(table) {
    const compatible = other => {
      const supplied = sets.get(other);
      if (supplied === undefined) throw notReady("same-domain native value set operand");
      return supplied;
    };
    const view = Object.freeze({
      add(key) { const original = prepare(key); table.set(original, original); },
      has(key) { return table.entry(prepare(key)) !== undefined; },
      remove(key) { remove(table, key); },
      discard(key) { table.remove(prepare(key), false); },
      clear() { table.clear(); },
      copy() { return setView(table.copySet()); },
      differenceUpdate(...others) { for (const other of others) table.differenceUpdate(compatible(other)); },
      get size() { return table.used; },
      [Symbol.iterator]() { return table.iterator(entry => entry.key); },
    });
    sets.set(view, table);
    return view;
  }
  function map({ defaultFactory } = {}) {
    if (defaultFactory !== undefined && typeof defaultFactory !== "function") throw notReady("value-map default factory");
    const table = newTable("map");
    const required = key => {
      const entry = table.entry(prepare(key));
      if (entry === undefined) throw keyError(key);
      return entry.value;
    };
    return Object.freeze({
      set(key, value) { table.set(prepare(key), value); },
      has(key) { return table.entry(prepare(key)) !== undefined; },
      get(key, fallback = null) { const entry = table.entry(prepare(key)); return entry === undefined ? fallback : entry.value; },
      required,
      at(key) {
        const entry = table.entry(prepare(key));
        if (entry !== undefined) return entry.value;
        if (defaultFactory === undefined) throw keyError(key);
        const value = defaultFactory(); // defaultdict, NOT keydefaultdict.
        if (isPromise(value)) throw notReady("synchronous value-map default factory");
        table.set(prepare(key), value); // Rehash/publish only after success.
        return value;
      },
      // Explicit JS loader-facade operation, NOT Python del's return shape.
      delete(key) {
        const original = prepare(key);
        if (table.entry(original) === undefined) return false;
        table.remove(original, false);
        return true;
      },
      remove(key) { remove(table, key); },
      clear() { table.clear(); },
      get size() { return table.used; },
      iterkeys() { return table.iterator(entry => entry.key); },
      itervalues() { return table.iterator(entry => entry.value); },
      iteritems() { return table.iterator(entry => [entry.key, entry.value]); },
      [Symbol.iterator]() { return table.iterator(entry => entry.key); },
    });
  }
  return Object.freeze({
    map,
    set() { return setView(newTable("set")); },
    itemKey(locationID, flagID, typeID) { return tuple([numeric(locationID), numeric(flagID), numeric(typeID)]); },
    effectKey(itemKey, effectID) { return tuple([item(itemKey), numeric(effectID)]); },
    criticalKey(kind, itemKey) {
      if (typeof kind !== "string" || !kinds.has(kind)) throw notReady("declared ASCII critical kind");
      return tuple([kind, item(itemKey)]);
    },
    tupleItems(key) { const parts = components(key); if (parts === undefined) throw notReady("branded value tuple"); return parts; },
    hashKey(key) { return hash(prepare(key)); },
  });
}

module.exports = { createClientDogmaValueCollections };
