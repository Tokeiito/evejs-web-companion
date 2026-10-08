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
// Which modules are running is godma's too. Each item's row in GetAllInfo
// lists the effects active on it (RefreshItemEffects 1640), and the server
// reports each start and stop:
//
//   OnGodmaShipEffect(itemID, effectID, time, start, active, environment, startTime, duration, repeat, error)   (1441)
//
// A module is running when an effect of the activation, target or area kind is
// active on it; it is overloaded when one of the overload kind is. Being
// online is an effect as well, and is neither.
//
// What is loaded in a module is godma's as well. A charge in a fitted module
// is not an item with an ID of its own: it is a "sublocation", keyed by the
// tuple (shipID, flagID, typeID), and its row in GetAllInfo has no inventory
// row, only attributes, of which `quantity` is how many are loaded. Changes to
// it arrive like any other, under that tuple (godma.py 1351, 1550 on). The scan
// service finds its launcher and the probes in it this way (scanSvc.py 476 to
// 513): the first module of the launcher group that is online, and the
// sublocation at that module's flag.
//
// The ship's own health is read the same way as its capacitor
// (activeShipController.py 92 to 133), and the panel shows each rounded to
// hundredths:
//
//   shield         shieldCharge / shieldCapacity     (it recharges, like the capacitor)
//   armour         (armorHP - armorDamage) / armorHP
//   hull           (hp - damage) / hp
//
// A module's damage is its own `damage` over its `hp` (shipmodulebutton.py
// 192): heat is what does it, and nothing else tells a client.
//
// Which weapons are grouped is dogma's too, though not an attribute. GetAllInfo
// carries the ship's state, (instances, charges by flag, weapon banks, heat),
// and the client makes the third its banks when the ship becomes its own
// (clientDogmaLocation._MakeShipActive, baseDogmaLocation.SetWeaponBanks):
// {masterID: [slaveID, ...]}. After that it is told, or tells itself from the
// answer to its own call:
//
//   OnWeaponBanksChanged(shipID, banks)     the whole set, anew
//   OnWeaponGroupDestroyed(shipID, itemID)  that master's bank is gone
//
// An item that turns up after the ship was loaded is told of on its own, in
// the same form as its row in GetAllInfo (godma.py 385, 1289):
//
//   OnGodmaPrimeItem(locationID, row)
//
// which is how a charge loaded into an empty module arrives, the probes
// coming back to an empty launcher among them.
//
// Only the ship's items are kept here, and only what the panel and the scanner need.

/** dogma attribute IDs (dogma/const.py). */
const ATTRIBUTE = Object.freeze({
  IS_ONLINE: 2,
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
  QUANTITY: 805,
});
/** inventorycommon/const.py categoryModule. */
const CATEGORY_MODULE = 7;
/** godma.chargedAttributeTauCaps: a recharging attribute, the attribute that is its recharge time, and the one that is its capacity. */
const CHARGED = new Map([
  [ATTRIBUTE.CHARGE, [ATTRIBUTE.RECHARGE_RATE, ATTRIBUTE.CAPACITOR_CAPACITY]],
  [ATTRIBUTE.SHIELD_CHARGE, [ATTRIBUTE.SHIELD_RECHARGE_RATE, ATTRIBUTE.SHIELD_CAPACITY]],
]);
/** dogma/const.py: the kinds of effect. */
const EFFECT_CATEGORY = Object.freeze({ PASSIVE: 0, ACTIVATION: 1, TARGET: 2, AREA: 3, ONLINE: 4, OVERLOAD: 5 });
const RUNNING = new Set([EFFECT_CATEGORY.ACTIVATION, EFFECT_CATEGORY.TARGET, EFFECT_CATEGORY.AREA]);
/**
 * const.effectOnline. Being online is an effect too, and the static data files it under the same kind as an afterburner's;
 * godma leaves it out by name wherever it asks what is running (PurgeInventories 2459, requiredEffects).
 */
const EFFECT_ONLINE = 16;
/** godma.py 1009-1016: where things are in an effect's environment. */
const ENV_IDX_TARGET = 3;

/** dogma/const.py dgmTauConstant: the clock's units (100 ns) in a millisecond. Recharge times are in milliseconds. */
const DGM_TAU_CONSTANT = 10000;
/** The clock's zero (1601) in the Unix epoch's milliseconds. */
const FILETIME_EPOCH_MS = 11644473600000n;

const text = (value) => (Buffer.isBuffer(value) ? value.toString("utf8") : typeof value === "string" ? value : null);
const number = (value) => (typeof value === "bigint" ? Number(value) : typeof value === "number" ? value : null);
/** An item's ID as a key: a number when a number holds it; for a charge in a module, its tuple (ship, flag, type) as "ship/flag/type". */
const key = (value) => {
  if (Array.isArray(value)) return value.map(String).join("/");
  return typeof value === "bigint" && value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= 0n ? Number(value) : value;
};
/** An inventory row's fields by name, however the codec spells the row; null when it is not a row. */
const rowFields = (row) => {
  if (!row || typeof row !== "object") return null;
  if (row.fields && typeof row.fields === "object") return row.fields;
  if (Array.isArray(row.columns) && Array.isArray(row.values)) return Object.fromEntries(row.columns.map((column, index) => [text(column[0]) ?? column[0], row.values[index]]));
  return null;
};
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
 * refused, as godma refuses it. `now()` reads the clock. `effectCategory(effectID)`
 * says what kind an effect is, from the game's static data; without it no
 * module can be told to be running.
 */
function createPilotDogma({ characterID = null, now = filetimeNow, effectCategory = () => null } = {}) {
  /** itemID -> Map(attributeID -> value). */
  const attributes = new Map();
  /** itemID -> Map(attributeID -> [value, time, tau, capacity]). */
  const charged = new Map();
  /** "itemID:attributeID" -> the time of the last change taken for it. */
  const lastChange = new Map();
  /** itemID -> Map(effectID -> { isActive, startTime, duration, repeat, targetID }). */
  const effects = new Map();
  /** item key -> { typeID, groupID, categoryID, flagID, locationID }: what each held item is and where. A charge in a module has no group. */
  const identity = new Map();
  /** ship key -> Map(masterID -> Set(slaveID)): baseDogmaLocation.slaveModulesByMasterModule. */
  const banks = new Map();

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
      loadRow(itemID, row);
      held.push(key(itemID));
    }
    // clientDogmaLocation._MakeShipActive: the ship's state is (instances, charges by flag, weapon banks, heat),
    // and the third is the active ship's banks.
    const all = fieldsOf(allInfo);
    const shipState = all.get("shipState");
    const activeShip = all.get("activeShipID");
    if (Array.isArray(shipState) && shipState.length >= 3 && activeShip !== undefined && activeShip !== null) setWeaponBanks(activeShip, shipState[2]);
    return held;
  }

  /** baseDogmaLocation.SetWeaponBanks: a ship's banks, replacing what was held. {masterID: [slaveID, ...]}, or nothing. */
  function setWeaponBanks(shipID, data) {
    const held = new Map();
    for (const [masterID, slaves] of data && Array.isArray(data.entries) ? data.entries : []) {
      const master = key(masterID);
      if (!held.has(master)) held.set(master, new Set());
      for (const slaveID of items(slaves)) held.get(master).add(key(slaveID));
    }
    banks.set(key(shipID), held);
  }

  /** clientDogmaLocation.UngroupModule, once the server has answered with the slave it took out: a bank left empty is gone. */
  function unlinkModule(shipID, masterID, slaveID) {
    const held = banks.get(key(shipID));
    const slaves = held ? held.get(key(masterID)) : null;
    if (!slaves) return;
    slaves.delete(key(slaveID));
    if (slaves.size === 0) held.delete(key(masterID));
  }

  /** godma.UpdateItem: one item's row, as GetAllInfo lists it and as OnGodmaPrimeItem sends it. */
  function loadRow(itemID, row) {
    const fields = fieldsOf(row);
    const values = new Map();
    const given = fields.get("attributes");
    for (const [attributeID, value] of given && Array.isArray(given.entries) ? given.entries : []) values.set(number(attributeID), number(value));
    updateAttributes(itemID, values, clock(fields.get("time")) ?? now());
    // What the item is: its inventory row, or for a charge in a module the tuple it is keyed by.
    const inventory = rowFields(fields.get("invItem"));
    if (Array.isArray(itemID)) {
      identity.set(key(itemID), { typeID: number(itemID[2]), groupID: null, categoryID: null, flagID: number(itemID[1]), locationID: key(itemID[0]) });
    } else if (inventory) {
      identity.set(key(itemID), { typeID: number(inventory.typeID), groupID: number(inventory.groupID), categoryID: number(inventory.categoryID), flagID: number(inventory.flagID), locationID: key(inventory.locationID) });
    }
    // godma.RefreshItemEffects: the effects active on the item, each with when it began, how long a cycle is and how many are left.
    const active = new Map();
    const listed = fields.get("activeEffects");
    for (const [effectID, line] of listed && Array.isArray(listed.entries) ? listed.entries : []) {
      if (!Array.isArray(line)) continue;
      active.set(number(effectID), { isActive: true, startTime: clock(line[7]), duration: number(line[8]), repeat: number(line[9]), targetID: line[ENV_IDX_TARGET] ?? null });
    }
    effects.set(key(itemID), active);
  }

  /**
   * godma.OnGodmaPrimeItem(locationID, row): an item in a location that is
   * held. One for a ship that is not held is left alone.
   */
  function primeItem(args) {
    const [locationID, row] = args;
    if (!attributes.has(key(locationID))) return false;
    const itemID = fieldsOf(row).get("itemID");
    if (itemID === undefined || itemID === null) return false;
    loadRow(itemID, row);
    return true;
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
    // A charge loaded in a module is keyed by a tuple, and is changed like anything else that is held.
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
   * godma.OnGodmaShipEffect: an effect on one of the pilot's items has started
   * or stopped. One for an item that is not held is nothing, as on the client.
   */
  function shipEffect(args) {
    const [itemID, effectID, , , active, environment, startTime, duration, repeat] = args;
    const held = effects.get(key(itemID));
    if (!held) return false;
    held.set(number(effectID), {
      isActive: Boolean(active),
      startTime: clock(startTime),
      duration: number(duration),
      repeat: typeof repeat === "boolean" ? Number(repeat) : number(repeat),
      targetID: Array.isArray(environment) ? environment[ENV_IDX_TARGET] ?? null : null,
    });
    return true;
  }

  /**
   * godma.OnMultiEvent: events of several kinds, each paired with its moment.
   * They are taken a moment at a time, in order; of the attribute changes in
   * one moment only the last for each item's attribute counts
   * (BroadcastFilteredMAC), and those are applied oldest first. The same goes
   * for the effects' starts and stops (BroadcastFilteredGSF).
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
      // BroadcastFilteredGSF: sorted by time, and the last one for each item's effect is the one that is told.
      const byEffectTime = (a, b) => {
        const [x, y] = [clock(a[3]) ?? 0n, clock(b[3]) ?? 0n];
        return x < y ? -1 : x > y ? 1 : 0;
      };
      const lastEffect = new Map();
      for (const event of moments.get(moment).filter((each) => Array.isArray(each) && text(each[0]) === "OnGodmaShipEffect").sort(byEffectTime)) {
        lastEffect.set(`${event[1]}:${event[2]}`, event);
      }
      for (const event of lastEffect.values()) shipEffect(event.slice(1));
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
    if (notification.method === "OnGodmaShipEffect") {
      shipEffect(notification.args);
      return true;
    }
    if (notification.method === "OnWeaponBanksChanged") {
      if (Array.isArray(notification.args) && notification.args.length >= 1) setWeaponBanks(notification.args[0], notification.args[1]);
      return true;
    }
    if (notification.method === "OnWeaponGroupDestroyed") {
      const [shipID, masterID] = Array.isArray(notification.args) ? notification.args : [];
      const held = banks.get(key(shipID));
      if (held) held.delete(key(masterID));
      return true;
    }
    if (notification.method === "OnGodmaPrimeItem") {
      primeItem(Array.isArray(notification.args) ? notification.args : []);
      return true;
    }
    return false;
  }

  /** The held items, other than `shipID` itself, with an active effect of one of `kinds`: in ascending order. */
  function modulesWith(shipID, kinds) {
    const ship = key(shipID);
    const found = [];
    for (const [itemID, held] of effects) {
      if (itemID === ship || typeof itemID !== "number") continue;
      for (const [effectID, effect] of held) {
        if (effect.isActive && effectID !== EFFECT_ONLINE && kinds.has(effectCategory(effectID))) {
          found.push(itemID);
          break;
        }
      }
    }
    return found.sort((a, b) => a - b);
  }

  /** What is left of something as a fraction of its whole, or null when either is not known or there is no whole. */
  const fraction = (left, whole) => (left === null || whole === null || !(whole > 0) ? null : Math.min(1, Math.max(0, left / whole)));

  /**
   * How damaged each of the ship's fitted modules is, {itemID: 0..1}: its
   * damage over its hp, and only the ones that are damaged at all, so an empty
   * answer means every module is whole.
   */
  function moduleDamage(shipID, at = now()) {
    const ship = key(shipID);
    const damaged = {};
    for (const [itemID, item] of identity) {
      if (typeof itemID !== "number" || item.locationID !== ship || item.categoryID !== CATEGORY_MODULE) continue;
      const ratio = fraction(attribute(itemID, ATTRIBUTE.DAMAGE, at), attribute(itemID, ATTRIBUTE.HP, at));
      if (ratio !== null && ratio > 0) damaged[String(itemID)] = ratio;
    }
    return damaged;
  }

  /** The ship's weapon banks, {masterID: [slaveID, ...]} with the slaves in order, or null when its state was never loaded. */
  function weaponBanks(shipID) {
    const held = banks.get(key(shipID));
    if (!held) return null;
    const out = {};
    for (const [masterID, slaves] of held) {
      if (typeof masterID !== "number") continue;
      out[String(masterID)] = [...slaves].filter((slaveID) => typeof slaveID === "number" && slaveID !== masterID).sort((a, b) => a - b);
    }
    return out;
  }

  /**
   * What the ship's panel shows that the ballpark does not know: the capacitor
   * and the three kinds of health as fractions, the three capacities, and what
   * its modules are doing. Null until the ship is loaded.
   */
  function shipReadings(shipID, at = now()) {
    const id = key(shipID);
    if (!attributes.has(id)) return null;
    const capacity = attribute(id, ATTRIBUTE.CAPACITOR_CAPACITY, at);
    const charge = attribute(id, ATTRIBUTE.CHARGE, at);
    const armor = attribute(id, ATTRIBUTE.ARMOR_HP, at);
    const armorDamage = attribute(id, ATTRIBUTE.ARMOR_DAMAGE, at);
    const hull = attribute(id, ATTRIBUTE.HP, at);
    const hullDamage = attribute(id, ATTRIBUTE.DAMAGE, at);
    return {
      capacitorRatio: capacity > 0 && charge !== null ? Math.min(1, Math.max(0, charge / capacity)) : null,
      // activeShipController: what is left of each, of its whole.
      shieldRatio: fraction(attribute(id, ATTRIBUTE.SHIELD_CHARGE, at), attribute(id, ATTRIBUTE.SHIELD_CAPACITY, at)),
      armorRatio: fraction(armor === null || armorDamage === null ? null : armor - armorDamage, armor),
      hullRatio: fraction(hull === null || hullDamage === null ? null : hull - hullDamage, hull),
      shieldCapacity: attribute(id, ATTRIBUTE.SHIELD_CAPACITY, at),
      armorCapacity: attribute(id, ATTRIBUTE.ARMOR_HP, at),
      hullCapacity: attribute(id, ATTRIBUTE.HP, at),
      // Which of its modules are running, and which are overloaded.
      activeModuleIDs: modulesWith(id, RUNNING),
      overloadedModuleIDs: modulesWith(id, new Set([EFFECT_CATEGORY.OVERLOAD])),
      moduleDamage: moduleDamage(id, at),
      weaponBanks: weaponBanks(id),
    };
  }

  /**
   * scanSvc.GetProbeLauncher and GetChargesInProbeLauncher: the ship's first
   * module of `groupID` that is online (godma's module.isOnline is the
   * attribute), in the order the server listed them, and what is loaded at its
   * flag. Null when the ship has none.
   */
  function onlineModule(shipID, groupID) {
    const ship = key(shipID);
    for (const [itemID, item] of identity) {
      if (typeof itemID !== "number" || item.locationID !== ship || item.groupID !== groupID) continue;
      if (!attribute(itemID, ATTRIBUTE.IS_ONLINE)) continue;
      let charge = null;
      for (const [chargeKey, loaded] of identity) {
        if (typeof chargeKey !== "string" || loaded.locationID !== ship || loaded.flagID !== item.flagID) continue;
        const quantity = attribute(chargeKey, ATTRIBUTE.QUANTITY);
        // One that has run out is still listed until the server takes it away; it is not a charge any more.
        if (quantity > 0) charge = { typeID: loaded.typeID, quantity };
      }
      return { moduleID: itemID, typeID: item.typeID, flagID: item.flagID, charge };
    }
    return null;
  }

  return {
    attribute,
    applyAttributeChange,
    onlineModule,
    setWeaponBanks,
    unlinkModule,
    weaponBanks,
    /** What is known of one effect on one item, or null. */
    effect: (itemID, effectID) => effects.get(key(itemID))?.get(effectID) ?? null,
    feed,
    loadAllInfo,
    multiEvent,
    shipReadings,
    has: (itemID) => attributes.has(key(itemID)),
    clear() {
      attributes.clear();
      charged.clear();
      lastChange.clear();
      effects.clear();
      identity.clear();
      banks.clear();
    },
  };
}

module.exports = { ATTRIBUTE, CHARGED, DGM_TAU_CONSTANT, EFFECT_CATEGORY, EFFECT_ONLINE, chargeValue, createPilotDogma, filetimeNow };
