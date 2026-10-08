"use strict";

// The pilot's own ship as dogma has it: the part of the retail client's
// `godma` that the ship's panel reads.
//
// The ship's panel on the retail client (shipHud/activeShipController.py) takes
// its numbers from the godma item for the ship, not from the ballpark:
//
//   capacitor      charge / capacitorCapacity
//   shield         shieldCharge / shieldCapacity
//   armour         (armorHP - armorDamage) / armorHP
//   hull           (hp - damage) / hp
//
// Godma (eve/client/script/environment/godma.py) gets those attributes from
// the dogma location it has bound, in one call, and is then told of each change:
//
//   GetDogmaLM().GetAllInfo(primeCharacter, primeShip, primeStructure)   Prime (2399), ForcePrimeLocation (2369)
//     ProcessAllInfo -> PrimeLocation -> UpdateItem: each item's attributes, and the time they were true at
//   OnModuleAttributeChanges([(tag, ownerID, itemID, attributeID, time, new, old, ...)])   (1342)
//     ApplyAttributeChange (2526)
//   OnMultiEvent([((tag, ...), time), ...])                                              (206)
//     the same changes, bundled with other events of the same moment; the
//     ballpark's updates carry such a bundle too (michelle.DoDestinyUpdate)
//
// Two attributes are not numbers that stay put. The capacitor and the shield
// recharge by themselves, so godma keeps each as (value, when, tau, capacity)
// and works out what it is now whenever it is read (CreateChargedAttribute 1729,
// GetChargeValue 2037).
//
// Only the ship's items are kept here, and only what the panel's numbers need.
// The modules' effects (which are running) are not here yet.

/** dogma attribute IDs (dogma/const.py). */
const ATTRIBUTE = Object.freeze({
  DAMAGE: 3,
  HP: 9,
  CHARGE: 18,
  RECHARGE_RATE: 55,
  SHIELD_CAPACITY: 263,
  SHIELD_CHARGE: 264,
  ARMOR_HP: 265,
  ARMOR_DAMAGE: 266,
  SHIELD_RECHARGE_RATE: 479,
  CAPACITOR_CAPACITY: 482,
});
/** godma.chargedAttributeTauCaps: a recharging attribute, the attribute that is its recharge time, and the one that is its capacity. */
const CHARGED = new Map([
  [ATTRIBUTE.CHARGE, [ATTRIBUTE.RECHARGE_RATE, ATTRIBUTE.CAPACITOR_CAPACITY]],
  [ATTRIBUTE.SHIELD_CHARGE, [ATTRIBUTE.SHIELD_RECHARGE_RATE, ATTRIBUTE.SHIELD_CAPACITY]],
]);
/** dogma/const.py dgmTauConstant: the clock's units (100 ns) in a millisecond. Recharge times are in milliseconds. */
const DGM_TAU_CONSTANT = 10000;
/** The clock's zero (1601) in the Unix epoch's milliseconds. */
const FILETIME_EPOCH_MS = 11644473600000n;

const text = (value) => (Buffer.isBuffer(value) ? value.toString("utf8") : typeof value === "string" ? value : null);
const number = (value) => (typeof value === "bigint" ? Number(value) : typeof value === "number" ? value : null);
/** An item's ID as a key: a number when a number holds it. */
const key = (value) => (typeof value === "bigint" && value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= 0n ? Number(value) : value);
const clock = (value) => (typeof value === "bigint" ? value : typeof value === "number" && Number.isFinite(value) ? BigInt(Math.trunc(value)) : null);
const fieldsOf = (value) => {
  const dict = value && value.type === "object" ? value.args : value;
  return new Map((dict && Array.isArray(dict.entries) ? dict.entries : []).map(([name, entry]) => [text(name) ?? name, entry]));
};
const items = (value) => (Array.isArray(value) ? value : value && Array.isArray(value.items) ? value.items : []);

/** A reading of the server's clock (100 ns since 1601) from this machine's. */
const filetimeNow = (nowMs = Date.now()) => (BigInt(Math.trunc(nowMs)) + FILETIME_EPOCH_MS) * BigInt(DGM_TAU_CONSTANT);

/**
 * godma.GetChargeValue: what a recharging attribute is at `newTime`, given
 * that it was `oldVal` at `oldTime`. `tau` is the recharge time over five, in
 * milliseconds, and `Ec` the capacity. Times are the clock's (100 ns).
 */
function chargeValue(oldVal, oldTime, tau, Ec, newTime) {
  if (Ec === 0) return 0;
  const sq = Math.sqrt(Math.max(oldVal / Ec, 0));
  const timePassed = Math.min(Number(oldTime - newTime), 0) / DGM_TAU_CONSTANT;
  const exp = Math.exp(timePassed / tau);
  return (1.0 + (sq - 1.0) * exp) ** 2 * Ec;
}

/**
 * `characterID` is whose items these are: a change for anyone else's is
 * refused, as godma refuses it. `now()` reads the clock.
 */
function createPilotDogma({ characterID = null, now = filetimeNow } = {}) {
  /** itemID -> Map(attributeID -> value). */
  const attributes = new Map();
  /** itemID -> Map(attributeID -> [value, time, tau, capacity]). */
  const charged = new Map();
  /** "itemID:attributeID" -> the time of the last change taken for it. */
  const lastChange = new Map();

  /** godma.GetAttribute. */
  function attribute(itemID, attributeID, at = now()) {
    const id = key(itemID);
    const recharging = charged.get(id)?.get(attributeID);
    if (recharging) return chargeValue(...recharging, at);
    return attributes.get(id)?.get(attributeID) ?? null;
  }

  /** godma.CreateChargedAttribute. */
  function createCharged(id, attributeID, value, time) {
    const [tau, cap] = CHARGED.get(attributeID);
    if (!charged.has(id)) charged.set(id, new Map());
    charged.get(id).set(attributeID, [value, time, attribute(id, tau, time) / 5.0, attribute(id, cap, time)]);
  }

  /** godma.UpdateAttribute: an item's attributes, all at once, true at `time`. */
  function updateAttributes(itemID, values, time) {
    const id = key(itemID);
    attributes.set(id, values);
    charged.delete(id);
    for (const attributeID of values.keys()) {
      if (!CHARGED.has(attributeID)) continue;
      const [tau, cap] = CHARGED.get(attributeID);
      if (values.get(tau) && values.get(cap)) createCharged(id, attributeID, values.get(attributeID), time);
    }
  }

  /**
   * godma.ProcessAllInfo, for the ship's items: what GetAllInfo answered.
   * Answers the IDs it now holds.
   */
  function loadAllInfo(allInfo) {
    const shipInfo = fieldsOf(allInfo).get("shipInfo");
    const held = [];
    for (const [itemID, row] of shipInfo && Array.isArray(shipInfo.entries) ? shipInfo.entries : []) {
      const fields = fieldsOf(row);
      const values = new Map();
      const given = fields.get("attributes");
      for (const [attributeID, value] of given && Array.isArray(given.entries) ? given.entries : []) values.set(number(attributeID), number(value));
      updateAttributes(itemID, values, clock(fields.get("time")) ?? now());
      held.push(key(itemID));
    }
    return held;
  }

  /** godma.ApplyAttributeChange. */
  function applyAttributeChange(itemID, attributeID, time, newValue) {
    const id = key(itemID);
    const values = attributes.get(id);
    if (!values) return false; // "item not found"
    const oldValue = attribute(id, attributeID);
    if (oldValue === newValue) return false; // "Reduntant update"
    values.set(attributeID, newValue);
    if (CHARGED.has(attributeID)) {
      createCharged(id, attributeID, newValue, time);
      return true;
    }
    for (const [chargeID, [tau, cap]] of CHARGED) {
      const held = charged.get(id)?.has(chargeID);
      if (attributeID === cap) {
        // The capacity changed: a charge that was full stays full, and none is ever over.
        if (held) {
          let charge = attribute(id, chargeID);
          if (charge === oldValue) charge *= newValue / oldValue;
          if (charge > newValue) charge = newValue;
          createCharged(id, chargeID, charge, time);
        } else if (values.get(tau) && values.get(cap)) {
          createCharged(id, chargeID, values.get(chargeID), time);
        }
      } else if (attributeID === tau && held) {
        // The recharge time changed: carry on from what the charge is now.
        createCharged(id, chargeID, attribute(id, chargeID), time);
      }
    }
    return true;
  }

  /**
   * godma.OnModuleAttributeChange_: one change, as it arrives inside
   * OnModuleAttributeChanges: (tag, ownerID, itemID, attributeID, time, new, old[, wallclockTime]).
   */
  function change(each) {
    const [, ownerID, itemKey, attributeID, time, newValue, , wallclock] = each;
    // A charge loaded in a module is keyed by a tuple; nothing here reads those.
    if (Array.isArray(itemKey)) return false;
    const id = key(itemKey);
    const attribute_ = number(attributeID);
    const stamp = clock(wallclock);
    // godma._IsAttributeChangeRelevant: an older change than the last one taken is dropped.
    const last = lastChange.get(`${id}:${attribute_}`);
    if (stamp && last !== undefined && last > stamp) return false;
    if (stamp) lastChange.set(`${id}:${attribute_}`, stamp);
    if (characterID !== null && number(ownerID) !== characterID && id !== characterID) return false; // not mine
    return applyAttributeChange(id, attribute_, clock(time) ?? now(), number(newValue));
  }

  /**
   * godma.OnMultiEvent: events of several kinds, each paired with its moment.
   * They are taken a moment at a time, in order; of the attribute changes in
   * one moment only the last for each item's attribute counts
   * (BroadcastFilteredMAC), and those are applied oldest first.
   */
  function multiEvent(events) {
    const moments = new Map();
    for (const pair of items(events)) {
      if (!Array.isArray(pair) || pair.length < 2) continue;
      const moment = clock(pair[pair.length - 1]) ?? 0n;
      if (!moments.has(moment)) moments.set(moment, []);
      moments.get(moment).push(pair[0]);
    }
    for (const moment of [...moments.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      const byTime = (a, b) => {
        const [x, y] = [clock(a[4]) ?? 0n, clock(b[4]) ?? 0n];
        return x < y ? -1 : x > y ? 1 : 0;
      };
      const changes = moments.get(moment).filter((event) => Array.isArray(event) && text(event[0]) === "OnModuleAttributeChange").sort(byTime);
      const last = new Map();
      for (const each of changes) last.set(`${each[1]}:${Array.isArray(each[2]) ? each[2].join("/") : each[2]}:${each[3]}`, each);
      for (const each of [...last.values()].sort(byTime)) {
        try {
          change(each);
        } catch {
          // As below: one bad change does not lose the rest.
        }
      }
    }
  }

  /** A notification from the session. True when it was dogma's. */
  function feed(notification) {
    if (notification.method === "OnMultiEvent") {
      multiEvent(notification.args[0]);
      return true;
    }
    if (notification.method === "OnModuleAttributeChanges") {
      for (const each of items(notification.args[0])) {
        try {
          change(each);
        } catch {
          // godma's ExceptionEater: one bad change does not lose the rest.
        }
      }
      return true;
    }
    if (notification.method === "OnModuleAttributeChange") {
      change(["OnModuleAttributeChange", ...notification.args]);
      return true;
    }
    return false;
  }

  /**
   * What the ship's panel shows that the ballpark does not know: the capacitor
   * as a fraction, and the three capacities. Null until the ship is loaded.
   */
  function shipReadings(shipID, at = now()) {
    const id = key(shipID);
    if (!attributes.has(id)) return null;
    const capacity = attribute(id, ATTRIBUTE.CAPACITOR_CAPACITY, at);
    const charge = attribute(id, ATTRIBUTE.CHARGE, at);
    return {
      capacitorRatio: capacity > 0 && charge !== null ? Math.min(1, Math.max(0, charge / capacity)) : null,
      shieldCapacity: attribute(id, ATTRIBUTE.SHIELD_CAPACITY, at),
      armorCapacity: attribute(id, ATTRIBUTE.ARMOR_HP, at),
      hullCapacity: attribute(id, ATTRIBUTE.HP, at),
    };
  }

  return {
    attribute,
    applyAttributeChange,
    feed,
    loadAllInfo,
    multiEvent,
    shipReadings,
    has: (itemID) => attributes.has(key(itemID)),
    clear() {
      attributes.clear();
      charged.clear();
      lastChange.clear();
    },
  };
}

module.exports = { ATTRIBUTE, CHARGED, DGM_TAU_CONSTANT, chargeValue, createPilotDogma, filetimeNow };
