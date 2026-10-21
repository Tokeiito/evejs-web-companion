"use strict";

// Numeric RefreshItemAttributes1686-1736 and ApplyAttributeChange2526-2581.
// Cached numeric value/charge state. A native caller supplies GetAttribute for
// notice comparison; definitions, effect rows, metadata and nodes live outside.
function createGodmaNumericValues({ fieldsOf, number, clock, now, chargeValue, chargedPairs, lastChange, attributeKey = id => id, attributeEntries = entries => entries, numberKind = () => undefined, readAttribute = null, readAttributeRecord = null }) {
  const attributes = new Map(), charged = new Map();
  // Python retains the numeric class when assigning a decoded value. Keep its
  // immutable source record beside the primitive, before normalization/copying.
  const kinds = new Map(), chargedInputs = new Map();
  const cell = (value, kind) => Object.freeze({ value, kind });
  // Native caches are name-keyed: distinct installed IDs can share a name.
  // Freshness remains keyed by the incoming ID, before this mapping.
  const namedPairs = () => new Map([...chargedPairs].map(([id, pair]) => [attributeKey(id), pair.map(attributeKey)]));
  // Python int/long/float/bool equality also covers numeric wire aliases.
  function equal(a, b) {
    if (typeof a === "boolean") a = Number(a);
    if (typeof b === "boolean") b = Number(b);
    if (typeof a === "bigint" && typeof b === "number") return Number.isInteger(b) && a === BigInt(b);
    if (typeof b === "bigint" && typeof a === "number") return Number.isInteger(a) && b === BigInt(a);
    return a === b;
  }
  function value(itemID, attributeID, at = now()) {
    return read(itemID, attributeKey(attributeID), at);
  }
  function read(itemID, name, at = now()) {
    const state = charged.get(itemID)?.get(name);
    return state ? chargeValue(...state, at) : attributes.get(itemID)?.get(name);
  }
  function record(itemID, name, at = now()) {
    // A recharge result is derived. Its Python arithmetic/class is a separate
    // port; never label it with an earlier operand's decoded opcode.
    if (charged.get(itemID)?.has(name)) return cell(read(itemID, name, at), undefined);
    const values = attributes.get(itemID);
    return values?.has(name) ? cell(values.get(name), kinds.get(itemID)?.get(name)) : undefined;
  }
  function createCharged(itemID, name, amount, time, pairs, kind) {
    const [tau, cap] = pairs.get(name);
    if (!charged.has(itemID)) charged.set(itemID, new Map());
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
  function refresh(itemID, info, doUpdate) {
    const fields = fieldsOf(info);
    // Native reads both timestamps before iterating/mutating the dictionary.
    if (!fields.has("time") || !fields.has("wallclockTime")) throw new TypeError("Godma numeric refresh requires time and wallclockTime.");
    const time = clock(fields.get("time")) ?? now(), wallclock = clock(fields.get("wallclockTime"));
    const given = fields.get("attributes");
    if (!given || !Array.isArray(given.entries)) throw new TypeError("Godma numeric refresh requires an attribute dictionary.");
    const values = doUpdate ? attributes.get(itemID) ?? new Map() : new Map();
    const valueKinds = doUpdate ? kinds.get(itemID) ?? new Map() : new Map();
    const incoming = given.entries.map(pair => [pair[0], pair[1], numberKind(pair, 1)]);
    for (const [attributeID, amount, kind] of attributeEntries(incoming)) {
      const id = number(attributeID), last = lastChange.get(`${itemID}:${id}`);
      if (wallclock && last !== undefined && last > wallclock) continue;
      values.set(attributeKey(id), amount);
      valueKinds.set(attributeKey(id), kind);
    }
    attributes.set(itemID, values);
    kinds.set(itemID, valueKinds);
    // UpdateAttribute never clears old charged tuples. Even a stale value's
    // retained charge is recreated with this snapshot's time when tau/cap exist.
    const pairs = namedPairs();
    for (const [id, amount] of values) {
      if (!pairs.has(id)) continue;
      if (!charged.has(itemID)) charged.set(itemID, new Map());
      const [tau, cap] = pairs.get(id);
      if (values.get(tau) && values.get(cap)) createCharged(itemID, id, amount, time, pairs, valueKinds.get(id));
    }
  }
  function change(itemID, attributeID, time, amount, kind) {
    const values = attributes.get(itemID);
    if (!values) return false;
    const name = attributeKey(attributeID), pairs = namedPairs();
    // ApplyAttributeChange2536 reads GetAttribute, including its default on
    // an uncached name, before deciding that the incoming value is redundant.
    const old = readAttribute ? readAttribute(itemID, attributeID) : read(itemID, name);
    if (equal(old, amount)) return false;
    values.set(name, amount);
    if (!kinds.has(itemID)) kinds.set(itemID, new Map());
    kinds.get(itemID).set(name, kind);
    if (pairs.has(name)) createCharged(itemID, name, amount, time, pairs, kind);
    else for (const [id, [tau, cap]] of pairs) {
      if (name === cap) {
        if (charged.get(itemID)?.has(id)) {
          let amountNow = read(itemID, id);
          if (equal(amountNow, old)) amountNow *= Number(amount) / Number(old);
          if (amountNow > amount) amountNow = amount;
          createCharged(itemID, id, amountNow, time, pairs);
        } else if (values.get(tau) && values.get(cap)) createCharged(itemID, id, values.get(id), time, pairs, kinds.get(itemID)?.get(id));
      } else if (name === tau && charged.get(itemID)?.has(id)) createCharged(itemID, id, read(itemID, id), time, pairs);
    }
    return true;
  }
  return {
    refresh, change, value,
    record: (itemID, attributeID, at = now()) => record(itemID, attributeKey(attributeID), at),
    chargeInputs: (itemID, attributeID) => chargedInputs.get(itemID)?.get(attributeKey(attributeID)),
    has: itemID => attributes.has(itemID),
    drop(ids) { for (const id of ids) { attributes.delete(id); charged.delete(id); kinds.delete(id); chargedInputs.delete(id); } },
    clear() { attributes.clear(); charged.clear(); kinds.clear(); chargedInputs.clear(); },
  };
}

module.exports = { createGodmaNumericValues };
