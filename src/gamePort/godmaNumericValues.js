"use strict";

const { decodedFieldRecord } = require("./clientGodmaFreshness");

// Numeric RefreshItemAttributes1686-1736 and ApplyAttributeChange2526-2581.
// Cached numeric value/charge state. A native caller supplies GetAttribute for
// notice comparison; definitions, effect rows, metadata and nodes live outside.
function createGodmaNumericValues({ fieldsOf, number, clock, now, chargeValue, chargedPairs, lastChange, isRelevant = null, attributeKey = id => id, attributeEntries = entries => entries, numberKind = () => undefined, readAttribute = null, readAttributeRecord = null, evaluateCharge = null, floatDivide = null, scaleReal = null, nativeStore = null }) {
  if (nativeStore) {
    function captured(scope) {
      const selected = scope ?? nativeStore.capture();
      selected.assertCurrent();
      return selected;
    }
    function backend(scope) {
      const owner = nativeStore.get();
      if (!owner) throw new Error("Original Godma numeric storage requires explicit asynchronous preparation.");
      return owner.forManager(captured(scope), { now, attributeKey, readAttributeRecord });
    }
    // Configured pilots allocate NONE of the legacy maps below. Captures are
    // passed through nested getters, never kept in mutable global scope.
    return {
      refresh: (item, info, update, scope, rawItem) => backend(scope).refresh(item, info, update, rawItem),
      change: (item, attribute, time, amount, kind, mappings, raw, scope) => backend(scope).change(item, attribute, time, amount, kind, mappings, raw),
      record: (item, attribute, at, scope) => backend(scope).record(item, attribute, at),
      scalarRecord: (item, attribute, scope) => backend(scope).scalarRecord(item, attribute),
      defaultRecord: (item, attribute, scope) => backend(scope).defaultRecord(item, attribute),
      value: (item, attribute, at, scope) => backend(scope).value(item, attribute, at),
      chargeInputs: (item, attribute, scope) => backend(scope).chargeInputs(item, attribute),
      has: (item, scope) => backend(scope).has(item),
      drop(ids, scope) {
        const items = [...ids];
        if (!items.length) return;
        if (nativeStore.get()) return backend(scope).drop(items);
        // PurgeEntry can precede any value refresh/static preparation. Its
        // already-constructed native dicts need no arithmetic capability.
        const selected = captured(scope);
        for (const item of items) for (const name of ["attributesByItemAttribute", "chargedAttributesByItemAttribute"]) {
          selected.assertCurrent();
          const values = selected.manager.getAttr(name), key = BigInt(item);
          if (values.getAttr("__contains__").call(key).truth()) values.getAttr("__delitem__").call(key);
        }
      },
      clear(scope) {
        if (nativeStore.get()) return backend(scope).clear();
        // Cold teardown before any numeric publication still owns the actual
        // constructed empty stores; it does not require static-data readiness.
        const manager = captured(scope).manager;
        manager.getAttr("attributesByItemAttribute").getAttr("clear").call();
        manager.getAttr("chargedAttributesByItemAttribute").getAttr("clear").call();
      },
    };
  }
  const attributes = new Map(), charged = new Map();
  // Python retains the numeric class when assigning a decoded value. Keep its
  // immutable source record beside the primitive, before normalization/copying.
  const kinds = new Map(), chargedInputs = new Map();
  const cell = (value, kind) => Object.freeze({ value, kind });
  // Python numeric truth keeps NaN true; JavaScript Boolean(NaN) is false.
  // Preserve the legacy reader while admitting native numeric operands.
  const chargeOperandPresent = value => readAttributeRecord && typeof value === "number" ? value !== 0 : Boolean(value);
  // Native caches are name-keyed: distinct installed IDs can share a name.
  // Freshness remains keyed by the incoming ID, before this mapping.
  const namedPairs = () => new Map([...chargedPairs].map(([id, pair]) => [attributeKey(id), pair.map(attributeKey)]));
  function mappings(prepared) {
    if (prepared) return prepared;
    // Only raw readers use the supplied legacy relationships. Native pilots
    // instead read the original manager's direct/max/tau dictionaries.
    const pairs = namedPairs(), byMax = new Map(), byTau = new Map();
    for (const [name, [tau, cap]] of pairs) {
      if (!byMax.has(cap)) byMax.set(cap, []);
      if (!byTau.has(tau)) byTau.set(tau, []);
      byMax.get(cap).push(name); byTau.get(tau).push(name);
    }
    return {
      has: name => pairs.has(name), get: name => pairs.get(name), part: (name, index) => pairs.get(name)[index],
      hasMax: name => byMax.has(name), byMax: name => byMax.get(name),
      hasTau: name => byTau.has(name), byTau: name => byTau.get(name),
    };
  }
  // Python int/long/float/bool equality also covers numeric wire aliases.
  function equal(a, b) {
    if (typeof a === "boolean") a = Number(a);
    if (typeof b === "boolean") b = Number(b);
    if (typeof a === "bigint" && typeof b === "number") return Number.isInteger(b) && a === BigInt(b);
    if (typeof b === "bigint" && typeof a === "number") return Number.isInteger(a) && b === BigInt(a);
    return a === b;
  }
  function value(itemID, attributeID, at) {
    return read(itemID, attributeKey(attributeID), at);
  }
  function chargedRecord(itemID, name, at) {
    const state = charged.get(itemID)?.get(name);
    if (!state) return undefined;
    if (!evaluateCharge) return cell(chargeValue(...state, at === undefined ? now() : at), undefined);
    const inputs = chargedInputs.get(itemID).get(name);
    return evaluateCharge(inputs.amount, state[1], inputs.tau, inputs.capacity, at === undefined || at === null ? now : at);
  }
  function read(itemID, name, at) {
    return charged.get(itemID)?.has(name) ? chargedRecord(itemID, name, at).value : attributes.get(itemID)?.get(name);
  }
  function record(itemID, name, at) {
    // The native evaluator supplies a derived class, never an operand opcode.
    if (charged.get(itemID)?.has(name)) return chargedRecord(itemID, name, at);
    const values = attributes.get(itemID);
    return values?.has(name) ? cell(values.get(name), kinds.get(itemID)?.get(name)) : undefined;
  }
  function createCharged(itemID, name, amount, time, pairs, kind) {
    const [tau, cap] = pairs.get(name);
    let rechargeTime, capacity, tauValue;
    if (readAttributeRecord) {
      rechargeTime = readAttributeRecord(itemID, tau);
      // Native CreateCharged1731 divides before even reading capacity. None
      // raises here, leaving any previous tuple and input snapshot intact.
      if (!["number", "bigint", "boolean"].includes(typeof rechargeTime.value)) throw new TypeError("Recharge time is not a Python numeric value.");
      tauValue = Number(rechargeTime.value) / 5.0;
      capacity = readAttributeRecord(itemID, cap);
      // Amount and capacity are raw Python operands, including explicit None.
      charged.get(itemID).set(name, [amount, time, tauValue, capacity.value]);
    } else {
      rechargeTime = record(itemID, tau);
      capacity = record(itemID, cap);
      tauValue = Number(rechargeTime?.value) / 5.0;
      charged.get(itemID).set(name, [Number(amount), time, tauValue, Number(capacity?.value)]);
    }
    if (!chargedInputs.has(itemID)) chargedInputs.set(itemID, new Map());
    // Preserve the raw recharge operand, before /5.0, separately from the
    // derived tau. These records do not claim a kind for the computed result.
    chargedInputs.get(itemID).set(name, Object.freeze({ amount: cell(amount, kind), rechargeTime, capacity, tau: cell(tauValue, readAttributeRecord ? Object.freeze({ kind: "real", source: "godma-tau-division" }) : undefined) }));
  }
  function refresh(itemID, info, doUpdate, freshness = null, rawItem = { value: itemID }, chargeMappings = null) {
    const fields = fieldsOf(info);
    // Native reads both timestamps before iterating/mutating the dictionary.
    if (!fields.has("time") || !fields.has("wallclockTime")) throw new TypeError("Godma numeric refresh requires time and wallclockTime.");
    const time = clock(fields.get("time")) ?? now(), wallclock = clock(fields.get("wallclockTime"));
    const given = fields.get("attributes");
    if (!given || !Array.isArray(given.entries)) throw new TypeError("Godma numeric refresh requires an attribute dictionary.");
    const values = doUpdate ? attributes.get(itemID) ?? new Map() : new Map();
    const valueKinds = doUpdate ? kinds.get(itemID) ?? new Map() : new Map();
    const rawWallclock = isRelevant ? decodedFieldRecord(info, "wallclockTime") : null;
    const incoming = given.entries.map(pair => [pair[0], pair[1], numberKind(pair, 1), numberKind(pair, 0)]);
    for (const [attributeID, amount, kind, idKind] of attributeEntries(incoming)) {
      const id = number(attributeID);
      if (isRelevant) {
        if (!isRelevant(freshness, rawItem, { value: attributeID, kind: idKind }, rawWallclock)) continue;
      } else {
        const last = lastChange.get(`${itemID}:${id}`);
        if (wallclock && last !== undefined && last > wallclock) continue;
      }
      values.set(attributeKey(id), amount);
      valueKinds.set(attributeKey(id), kind);
    }
    attributes.set(itemID, values);
    kinds.set(itemID, valueKinds);
    // UpdateAttribute never clears old charged tuples. Even a stale value's
    // retained charge is recreated with this snapshot's time when tau/cap exist.
    const pairs = mappings(chargeMappings);
    for (const [id, amount] of values) {
      if (!pairs.has(id)) continue;
      if (!charged.has(itemID)) charged.set(itemID, new Map());
      if (chargeOperandPresent(values.get(pairs.part(id, 0))) && chargeOperandPresent(values.get(pairs.part(id, 1)))) createCharged(itemID, id, amount, time, pairs, valueKinds.get(id));
    }
  }
  function change(itemID, attributeID, time, amount, kind, chargeMappings = null) {
    const values = attributes.get(itemID);
    if (!values) return false;
    const name = attributeKey(attributeID), pairs = mappings(chargeMappings);
    // ApplyAttributeChange2536 reads GetAttribute, including its default on
    // an uncached name, before deciding that the incoming value is redundant.
    const old = readAttribute ? readAttribute(itemID, attributeID) : read(itemID, name);
    if (equal(old, amount)) return false;
    values.set(name, amount);
    if (!kinds.has(itemID)) kinds.set(itemID, new Map());
    kinds.get(itemID).set(name, kind);
    if (pairs.has(name)) {
      if (!charged.has(itemID)) charged.set(itemID, new Map());
      createCharged(itemID, name, amount, time, pairs, kind);
    }
    else if (pairs.hasMax(name)) {
      for (const id of pairs.byMax(name)) {
        // Native max initialization is also conditional on this OUTER
        // dictionary existing; scalar tau/cap values alone do not admit it.
        if (!charged.has(itemID)) continue;
        if (charged.get(itemID)?.has(id)) {
          if (evaluateCharge) {
            let current = readAttributeRecord(itemID, id);
            // Native computes float(new)/old even when charge != old.
            const ratio = floatDivide(cell(amount, kind), cell(old, undefined));
            if (equal(current.value, old)) current = scaleReal(current, ratio);
            if (current.value > amount) current = cell(amount, kind);
            createCharged(itemID, id, current.value, time, pairs, current.kind);
          } else {
            let amountNow = read(itemID, id);
            if (equal(amountNow, old)) amountNow *= Number(amount) / Number(old);
            if (amountNow > amount) amountNow = amount;
            createCharged(itemID, id, amountNow, time, pairs);
          }
          break;
        } else if (chargeOperandPresent(values.get(pairs.part(id, 0))) && chargeOperandPresent(values.get(pairs.part(id, 1)))) {
          // The original dictionary subscription raises for a missing charge
          // scalar, rather than manufacturing an undefined/None operand.
          if (!values.has(id)) { const error = new Error(`Missing charged attribute ${String(id)}.`); error.name = "KeyError"; error.key = id; throw error; }
          createCharged(itemID, id, values.get(id), time, pairs, kinds.get(itemID)?.get(id));
          break;
        }
      }
    } else if (pairs.hasTau(name)) {
      for (const id of pairs.byTau(name)) {
        if (!charged.get(itemID)?.has(id)) continue;
        const current = readAttributeRecord ? readAttributeRecord(itemID, id) : record(itemID, id);
        createCharged(itemID, id, current.value, time, pairs, current.kind);
        break;
      }
    }
    return true;
  }
  return {
    refresh, change, value,
    record: (itemID, attributeID, at) => record(itemID, attributeKey(attributeID), at),
    chargeInputs: (itemID, attributeID) => chargedInputs.get(itemID)?.get(attributeKey(attributeID)),
    has: itemID => attributes.has(itemID),
    drop(ids) { for (const id of ids) { attributes.delete(id); charged.delete(id); kinds.delete(id); chargedInputs.delete(id); } },
    clear() { attributes.clear(); charged.clear(); kinds.clear(); chargedInputs.clear(); },
  };
}

module.exports = { createGodmaNumericValues };
