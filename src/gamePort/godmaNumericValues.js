"use strict";

// Numeric RefreshItemAttributes1686-1736 and ApplyAttributeChange2526-2581.
// This is cached numeric value/charge state, not GetAttribute's static defaults,
// effect rows, ItemWrapper, inventory metadata or clientDogmaLocation nodes.
function createGodmaNumericValues({ fieldsOf, number, clock, now, chargeValue, chargedPairs, lastChange, attributeKey = id => id, attributeEntries = entries => entries }) {
  const attributes = new Map(), charged = new Map();
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
  function createCharged(itemID, name, amount, time, pairs) {
    const [tau, cap] = pairs.get(name);
    if (!charged.has(itemID)) charged.set(itemID, new Map());
    charged.get(itemID).set(name, [Number(amount), time, Number(read(itemID, tau)) / 5.0, Number(read(itemID, cap))]);
  }
  function refresh(itemID, info, doUpdate) {
    const fields = fieldsOf(info);
    // Native reads both timestamps before iterating/mutating the dictionary.
    if (!fields.has("time") || !fields.has("wallclockTime")) throw new TypeError("Godma numeric refresh requires time and wallclockTime.");
    const time = clock(fields.get("time")) ?? now(), wallclock = clock(fields.get("wallclockTime"));
    const given = fields.get("attributes");
    if (!given || !Array.isArray(given.entries)) throw new TypeError("Godma numeric refresh requires an attribute dictionary.");
    const values = doUpdate ? attributes.get(itemID) ?? new Map() : new Map();
    for (const [attributeID, amount] of attributeEntries(given.entries)) {
      const id = number(attributeID), last = lastChange.get(`${itemID}:${id}`);
      if (wallclock && last !== undefined && last > wallclock) continue;
      values.set(attributeKey(id), amount);
    }
    attributes.set(itemID, values);
    // UpdateAttribute never clears old charged tuples. Even a stale value's
    // retained charge is recreated with this snapshot's time when tau/cap exist.
    const pairs = namedPairs();
    for (const [id, amount] of values) {
      if (!pairs.has(id)) continue;
      if (!charged.has(itemID)) charged.set(itemID, new Map());
      const [tau, cap] = pairs.get(id);
      if (values.get(tau) && values.get(cap)) createCharged(itemID, id, amount, time, pairs);
    }
  }
  function change(itemID, attributeID, time, amount) {
    const values = attributes.get(itemID);
    if (!values) return false;
    const name = attributeKey(attributeID), pairs = namedPairs();
    const old = read(itemID, name);
    if (equal(old, amount)) return false;
    values.set(name, amount);
    if (pairs.has(name)) createCharged(itemID, name, amount, time, pairs);
    else for (const [id, [tau, cap]] of pairs) {
      if (name === cap) {
        if (charged.get(itemID)?.has(id)) {
          let amountNow = read(itemID, id);
          if (equal(amountNow, old)) amountNow *= Number(amount) / Number(old);
          if (amountNow > amount) amountNow = amount;
          createCharged(itemID, id, amountNow, time, pairs);
        } else if (values.get(tau) && values.get(cap)) createCharged(itemID, id, values.get(id), time, pairs);
      } else if (name === tau && charged.get(itemID)?.has(id)) createCharged(itemID, id, read(itemID, id), time, pairs);
    }
    return true;
  }
  return {
    refresh, change, value,
    has: itemID => attributes.has(itemID),
    drop(ids) { for (const id of ids) { attributes.delete(id); charged.delete(id); } },
    clear() { attributes.clear(); charged.clear(); },
  };
}

module.exports = { createGodmaNumericValues };
