"use strict";

// Numeric RefreshItemAttributes1686-1736 and ApplyAttributeChange2526-2581.
// This is cached numeric value/charge state, not GetAttribute's static defaults,
// effect rows, ItemWrapper, inventory metadata or clientDogmaLocation nodes.
function createGodmaNumericValues({ fieldsOf, number, clock, now, chargeValue, chargedPairs, lastChange }) {
  const attributes = new Map(), charged = new Map();
  // Python int/long/float/bool equality also covers numeric wire aliases.
  function equal(a, b) {
    if (typeof a === "boolean") a = Number(a);
    if (typeof b === "boolean") b = Number(b);
    if (typeof a === "bigint" && typeof b === "number") return Number.isInteger(b) && a === BigInt(b);
    if (typeof b === "bigint" && typeof a === "number") return Number.isInteger(a) && b === BigInt(a);
    return a === b;
  }
  function value(itemID, attributeID, at = now()) {
    const state = charged.get(itemID)?.get(attributeID);
    return state ? chargeValue(...state, at) : attributes.get(itemID)?.get(attributeID);
  }
  function createCharged(itemID, attributeID, amount, time) {
    const [tau, cap] = chargedPairs.get(attributeID);
    if (!charged.has(itemID)) charged.set(itemID, new Map());
    charged.get(itemID).set(attributeID, [Number(amount), time, Number(value(itemID, tau)) / 5.0, Number(value(itemID, cap))]);
  }
  function refresh(itemID, info, doUpdate) {
    const fields = fieldsOf(info);
    // Native reads both timestamps before iterating/mutating the dictionary.
    if (!fields.has("time") || !fields.has("wallclockTime")) throw new TypeError("Godma numeric refresh requires time and wallclockTime.");
    const time = clock(fields.get("time")) ?? now(), wallclock = clock(fields.get("wallclockTime"));
    const given = fields.get("attributes");
    if (!given || !Array.isArray(given.entries)) throw new TypeError("Godma numeric refresh requires an attribute dictionary.");
    const values = doUpdate ? attributes.get(itemID) ?? new Map() : new Map();
    for (const [attributeID, amount] of given.entries) {
      const id = number(attributeID), last = lastChange.get(`${itemID}:${id}`);
      if (wallclock && last !== undefined && last > wallclock) continue;
      values.set(id, amount);
    }
    attributes.set(itemID, values);
    // UpdateAttribute never clears old charged tuples. Even a stale value's
    // retained charge is recreated with this snapshot's time when tau/cap exist.
    for (const [id, amount] of values) {
      if (!chargedPairs.has(id)) continue;
      if (!charged.has(itemID)) charged.set(itemID, new Map());
      const [tau, cap] = chargedPairs.get(id);
      if (values.get(tau) && values.get(cap)) createCharged(itemID, id, amount, time);
    }
  }
  function change(itemID, attributeID, time, amount) {
    const values = attributes.get(itemID);
    if (!values) return false;
    const old = value(itemID, attributeID);
    if (equal(old, amount)) return false;
    values.set(attributeID, amount);
    if (chargedPairs.has(attributeID)) createCharged(itemID, attributeID, amount, time);
    else for (const [id, [tau, cap]] of chargedPairs) {
      if (attributeID === cap) {
        if (charged.get(itemID)?.has(id)) {
          let amountNow = value(itemID, id);
          if (equal(amountNow, old)) amountNow *= Number(amount) / Number(old);
          if (amountNow > amount) amountNow = amount;
          createCharged(itemID, id, amountNow, time);
        } else if (values.get(tau) && values.get(cap)) createCharged(itemID, id, values.get(id), time);
      } else if (attributeID === tau && charged.get(itemID)?.has(id)) createCharged(itemID, id, value(itemID, id), time);
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
