"use strict";

// clientDogmaStaticSvc AttributesByTypeLookupDict12-36,
// AttributesByTypeAttribute39-43 and TypeHasAttribute54-64. This is the real
// lookup prerequisite only, NOT the whole static service/Run or dogma.data's
// merged last-wins attributes-by-ID dictionary. cdxclientstatictypeagent1.
const { types: { isPromise } } = require("node:util");
const { ClientDogmaConstructorPrimitiveNotReadyError } = require("./clientDogmaConstructorPrimitives");
const notReady = part => new ClientDogmaConstructorPrimitiveNotReadyError(part);

class ClientDogmaStaticTypeKeyError extends Error {
  constructor(key) {
    // Diagnostic text is an emulator message, not native KeyError strx.
    super("Static type lookup key not found.");
    this.name = "KeyError";
    this.key = key;
    this.args = [key];
  }
}

function numericID(key) {
  if (typeof key === "bigint" || (typeof key === "number" && Number.isSafeInteger(key))) return key;
  throw notReady("normalized numeric static type/attribute ID");
}
const sameID = (left, right) => BigInt(numericID(left)) === BigInt(numericID(right));
function member(object, name) {
  if (object === null || object === undefined || !(name in Object(object))) throw notReady(name);
  return object[name];
}
function synchronous(value, part) {
  if (isPromise(value)) throw notReady(`synchronous ${part}`);
  return value;
}
function invoke(receiver, name, args = []) {
  const method = member(receiver, name);
  if (typeof method !== "function") throw notReady(name);
  return synchronous(Reflect.apply(method, receiver, args), name);
}
function sourceValue(value) {
  if (value === undefined) throw notReady("present static source value");
  return synchronous(value, "static source value");
}

/** Required synchronous real providers: valueCollections, hasTypeAttributes,
 * typeExists, getTypeAttributes, getMass/getCapacity/getVolume. getTypeAttributes
 * supplies the ACTUAL ordered dogma.data COMPOSED array: raw typeDogma rows,
 * then physical4/38/161/162. Its own memoization is separate provider behavior.
 * It must finish composition (including physical getters/errors) before this
 * scan can return an early raw match. No empty-data substitution is provided.
 *
 * Rows have numeric attributeID and a value returned UNCHANGED. The original
 * native return is scalar; adapters may explicitly supply opaque internal
 * typed source cells instead, preserved by identity with no unwrap/wrap/kind
 * creation or wire-brand claim. Physical providers follow that SAME contract;
 * literal null alone represents native None. 0/false remain non-None values.
 *
 * errorPolicy.isKeyError(error) is demanded only when TypeHasAttribute catches
 * an error not authoritatively owned here. It must return a synchronous bool
 * using real error identity/classification, NEVER a JS name/message guess.
 * Unsupported scalar/tuple/custom keys and generic iterable/mapping rows are
 * explicit admission boundaries, not generic Python dictionary equivalence.
 */
function createClientDogmaStaticTypeLookup(providers) {
  const values = member(providers, "valueCollections");
  const newMap = () => invoke(values, "map");
  const ownError = key => new ClientDogmaStaticTypeKeyError(key);

  function rows(typeID) {
    const result = invoke(providers, "getTypeAttributes", [typeID]);
    if (!Array.isArray(result)) throw notReady("ordered composed static attribute array");
    return result;
  }
  function predicate(name, typeID) {
    const result = invoke(providers, name, [typeID]);
    if (typeof result !== "boolean") throw notReady(`boolean ${name}`);
    return result;
  }
  function view(storage, missing, extra = {}) {
    const required = key => {
      numericID(key);
      if (!storage.has(key)) throw ownError(key);
      return storage.get(key);
    };
    return Object.freeze({
      ...extra,
      set(key, value) { storage.set(numericID(key), value); },
      has(key) { return storage.has(numericID(key)); },
      get(key, fallback = null) { return storage.get(numericID(key), fallback); },
      required,
      at(key) { numericID(key); return storage.has(key) ? storage.get(key) : missing(key); },
      // JS boolean delete is a loader-style facade; remove is strict source del.
      delete(key) { return storage.delete(numericID(key)); },
      remove(key) { numericID(key); if (!storage.delete(key)) throw ownError(key); },
      clear() { storage.clear(); },
      get size() { return storage.size; },
      iterkeys() { return storage.iterkeys(); },
      itervalues() { return storage.itervalues(); },
      iteritems() { return storage.iteritems(); },
      [Symbol.iterator]() { return storage.iterkeys(); },
    });
  }
  function inner(typeID) {
    const held = newMap();
    return view(held, attributeID => {
      // No merged/by-ID snapshot and no raw-match memoization. Every miss
      // obtains/scans the actual ordered provider list and returns FIRST match.
      for (const row of rows(typeID)) {
        if (sameID(member(row, "attributeID"), attributeID)) return sourceValue(member(row, "value"));
      }
      let result = null;
      if (sameID(attributeID, 4)) result = sourceValue(invoke(providers, "getMass", [typeID]));
      else if (sameID(attributeID, 38)) result = sourceValue(invoke(providers, "getCapacity", [typeID]));
      else if (sameID(attributeID, 161)) result = sourceValue(invoke(providers, "getVolume", [typeID]));
      // Radius deliberately has no fallback. A genuine composed162 row can
      // still match above, including its actual supplied value/class.
      if (result === null) throw ownError(attributeID);
      held.set(attributeID, result);
      return result;
    }, { typeID });
  }
  const outer = newMap();
  const attributesByTypeAttribute = view(outer, typeID => {
    if (!predicate("hasTypeAttributes", typeID) && !predicate("typeExists", typeID)) throw ownError(typeID);
    return inner(typeID); // __missing__ returns it WITHOUT assigning outer.
  });
  function TypeHasAttribute(typeID, attributeID) {
    numericID(typeID); numericID(attributeID); // Explicit normalized-ID seam.
    try {
      for (const row of rows(typeID)) {
        if (sameID(member(row, "attributeID"), attributeID)) return true;
      }
      return false;
    } catch (error) {
      // The ENTIRE source get/list scan is inside the native KeyError catch.
      if (error instanceof ClientDogmaStaticTypeKeyError) return false;
      const classified = invoke(member(providers, "errorPolicy"), "isKeyError", [error]);
      if (typeof classified !== "boolean") throw notReady("boolean native KeyError classification");
      if (classified) return false;
      throw error;
    }
  }
  return Object.freeze({ attributesByTypeAttribute, TypeHasAttribute });
}

module.exports = { createClientDogmaStaticTypeLookup, ClientDogmaStaticTypeKeyError };
