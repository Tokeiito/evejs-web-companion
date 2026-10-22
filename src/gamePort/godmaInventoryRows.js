"use strict";

// Numeric StateManager.invitems/itemsByLocationID only (godma.py UpdateItem1553-1657,
// PurgeInventories/PurgeEntries2452-2507). Attributes/effects, pending tasklets,
// tuple sublocations and clientDogmaLocation loaded nodes are separate state.
const CATEGORIES = new Set([11, 23, 40, 6, 7, 8, 18, 32, 87, 65, 66]);
const FITTING_CATEGORIES = new Set([7, 66, 8, 32]);
const LOCATION_CATEGORIES = new Set([6, 23, 65]);
// Original FLAGS_TO_IGNORE_ITEM_CHANGES construction; cdxgodmanoticeagent1.
const IGNORED_NOTICE_FLAGS = new Set([
  4, 5, 87, 90, 115, 116, 117, 118, 119, 120, 121, 133, 134, 135,
  136, 137, 138, 139, 140, 141, 142, 143, 148, 149, 151, 154, 155,
  158, 172, 174, 176, 177, 179, 180, 181, 182, 183, 184, 185, 186, 188,
]);
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

// Preserve long identity; normalize only exactly representable numeric aliases.
function key(value) {
  if (typeof value === "bigint") return value >= MIN_SAFE && value <= MAX_SAFE ? Number(value) : value;
  if (value === null || typeof value === "number" && Number.isSafeInteger(value)) return value;
  throw new TypeError("A numeric godma item/location key is required; route tuple rows separately.");
}

const scalar = value => typeof value === "bigint" ? key(value) : typeof value === "boolean" ? Number(value) : value;
const fittingFlag = flag => Number.isInteger(flag) && (
  flag >= 11 && flag <= 34 || flag >= 92 && flag <= 94 ||
  flag >= 125 && flag <= 128 || flag >= 164 && flag <= 171 || flag === 156
);
const worldLocation = id => id >= 30000000 && id <= 39999999 || id >= 60000000 && id <= 63999999;

function createGodmaInventoryRows({ rowFields, registeredLocations = () => [], nativeStore = null, storage = null }) {
  if (nativeStore) {
    function scoped(scope) {
      const selected = scope ?? nativeStore.capture();
      selected.assertCurrent();
      const owner = nativeStore.get();
      if (!owner) throw new Error("Original Godma inventory storage requires explicit preparation.");
      return createGodmaInventoryRows({ rowFields, registeredLocations, storage: owner.forManager(selected) });
    }
    return {
      update: (row, scope) => scoped(scope).update(row),
      ensureLocation: (item, scope) => scoped(scope).ensureLocation(item),
      prime: (item, row, scope) => scoped(scope).prime(item, row),
      coldPrime: (item, row, scope) => scoped(scope).coldPrime(item, row),
      notice: (row, change, session, scope) => scoped(scope).notice(row, change, session),
      flush: (item, scope) => scoped(scope).flush(item),
      get: (item, scope) => scoped(scope).get(item),
      has: (item, scope) => scoped(scope).has(item),
      locationLoaded: (item, scope) => scoped(scope).locationLoaded(item),
      purge: (keep, scope) => scoped(scope).purge(keep),
      clear: scope => scoped(scope).clear(),
    };
  }
  const rows = storage?.rows ?? new Map();
  const itemsByLocation = storage?.itemsByLocation ?? new Map();
  const emptySet = storage?.emptySet ?? (() => new Set());

  function required(fields, name) {
    if (!fields || !Object.prototype.hasOwnProperty.call(fields, name) || fields[name] === undefined) {
      throw new TypeError(`Godma inventory row is missing ${name}.`);
    }
    return fields[name];
  }

  function update(row) {
    const fields = rowFields(row);
    // Read order is the original numeric branch; singleton is read only AFTER
    // retention and the fitting-category guard. None is not a missing field.
    const itemID = key(required(fields, "itemID"));
    const locationID = key(required(fields, "locationID"));
    required(fields, "typeID");
    const groupID = scalar(required(fields, "groupID"));
    const categoryID = scalar(required(fields, "categoryID"));
    const flagID = scalar(required(fields, "flagID"));
    if ((!CATEGORIES.has(categoryID) && groupID !== 1) ||
        flagID === 5 || flagID === 87 || flagID >= 159 && flagID <= 163 && Number.isInteger(flagID)) {
      return { accepted: false, refresh: false, doUpdate: false, itemID };
    }

    const doUpdate = rows.has(itemID);
    rows.set(itemID, row);
    if (LOCATION_CATEGORIES.has(categoryID) || groupID === 1) itemsByLocation.set(itemID, emptySet());
    if (!worldLocation(locationID)) {
      const parent = storage ? itemsByLocation.required(locationID) : itemsByLocation.get(locationID);
      // Native raises KeyError here after invitems replacement; do not create
      // a missing parent or roll back that already-retained metadata.
      if (!parent) throw new Error(`Godma location ${String(locationID)} has no membership bucket.`);
      parent.add(itemID);
    }
    if (fittingFlag(flagID) && !FITTING_CATEGORIES.has(categoryID)) {
      return { accepted: true, refresh: false, doUpdate, itemID };
    }
    const singleton = required(fields, "singleton");
    const refresh = Boolean(singleton) || categoryID === 8 && groupID !== 92;
    return { accepted: true, refresh, doUpdate, itemID };
  }

  function registeredIDs() {
    return new Set([...registeredLocations()].map(key));
  }

  function ensureLocation(locationID) {
    const id = key(locationID);
    if (!itemsByLocation.has(id)) itemsByLocation.set(id, emptySet());
  }

  // StateManager.OnGodmaPrimeItem1289: cold bucket creation is independent of
  // registered guards and attribute maps. Supplied GET-INFO stays with caller.
  function prime(locationID, row) {
    ensureLocation(locationID);
    return update(row);
  }

  /** OnItemChange1208-1270 numeric metadata only. Refresh intents are demanded
   * UpdateItem work, not successful RPC/effect execution. The caller must finish
   * that work before resolving retained scatter intents against CURRENT rows;
   * on refresh failure it must not scatter. Raw intents capture event backing
   * fields, not a complete ItemWrapper or synchronous eventbus dispatch. */
  function notice(row, changeMap, session) {
    const result = { refresh: null, scatters: [], clearChargeType: null };
    const fields = rowFields(row), incomingID = required(fields, "itemID");
    if (Array.isArray(incomingID)) return result;
    const itemID = key(incomingID);
    const locationID = key(required(fields, "locationID"));
    const change = new Map([...changeMap].map(([index, value]) => [scalar(index), value]));
    const sessionKey = name => key(required(session, name));
    if (locationID === sessionKey("structureid") && !session.controllingStructure &&
        !(change.has(3) && key(change.get(3)) === sessionKey("shipid"))) return result;
    if (change.has(4)) result.clearChargeType = itemID;
    const registered = registeredIDs();
    const flagID = scalar(required(fields, "flagID"));
    const fittingOrPilot = flag => fittingFlag(flag) || flag === 57;
    const zero = () => change.has(9) && scalar(required(fields, "stacksize")) === 0;
    function updateIntent(dontGetInfo = false) {
      const updated = update(row);
      if (updated.refresh) result.refresh = { itemID: updated.itemID, row, doUpdate: updated.doUpdate, dontGetInfo };
    }
    function retainedScatter() {
      if (rows.has(itemID)) result.scatters.push({ kind: "retained", itemID, change: changeMap });
    }
    function wasLaunching() {
      const category = scalar(required(fields, "categoryID")), oldFlag = scalar(change.get(4));
      const droneOrFighter = category === 18 && oldFlag === 87 ||
        category === 87 && oldFlag >= 159 && oldFlag <= 163 && Number.isInteger(oldFlag);
      return droneOrFighter && locationID === sessionKey("solarsystemid") &&
        locationID >= 30000000 && locationID <= 39999999 &&
        change.has(3) && key(change.get(3)) === sessionKey("shipid");
    }

    if (change.has(3) || zero()) {
      let launching = false;
      if (change.has(4)) {
        launching = wasLaunching();
        if (!(fittingOrPilot(flagID) || fittingOrPilot(scalar(change.get(4))) || launching)) return result;
      } else if (!fittingOrPilot(flagID)) return result;
      if (registered.has(locationID) && !zero()) {
        updateIntent();
        retainedScatter();
      } else if (launching) {
        updateIntent();
      } else if (rows.has(itemID)) {
        // Original indexed lookup creates a fresh wrapper each time. Assigning
        // location/flag shadows a discarded wrapper; scatter sees OLD backing.
        // cdxgodmanoticeagent1-indexed supersedes the plain-dict mutation probe.
        result.scatters.push({ kind: "raw", row: rows.get(itemID), change: changeMap, source: "backing" });
        if (!registered.has(itemID)) rows.delete(itemID);
        const oldLocationID = change.has(3) ? key(change.get(3)) : locationID;
        if (oldLocationID !== locationID) {
          itemsByLocation.get(oldLocationID)?.delete(itemID);
          itemsByLocation.get(locationID)?.add(itemID);
        }
      }
    } else if (registered.has(locationID)) {
      if (rows.has(itemID) && change.has(4) &&
          !(fittingFlag(flagID) || flagID === 7 || flagID === 61 || flagID === 88)) {
        result.scatters.push({ kind: "raw", row, change: changeMap, source: "incoming" });
        rows.delete(itemID);
        const bucket = itemsByLocation.get(locationID);
        if (storage && bucket) {
          try { bucket.remove(itemID); }
          catch (error) { error.godmaNotice = result; throw error; }
          return result;
        }
        if (bucket && !bucket.delete(itemID)) {
          const error = new Error(`Godma location ${String(locationID)} does not contain ${String(itemID)}.`);
          // Native scatters/deletes before set.remove raises. Preserve that
          // partial intent for the caller; it is not a native transport error.
          error.godmaNotice = result;
          throw error;
        }
        return result;
      }
      if (IGNORED_NOTICE_FLAGS.has(flagID)) return result;
      if (scalar(required(fields, "groupID")) === 29 &&
          key(required(fields, "ownerID")) === sessionKey("charid") &&
          (locationID === sessionKey("locationid") && flagID === 0 ||
           locationID === sessionKey("shipid") && flagID === 56)) return result;
      const dontGetInfo = change.size === 1 && change.has(9) &&
        !(required(fields, "singleton") && scalar(change.get(9)) > 0);
      updateIntent(dontGetInfo);
      retainedScatter();
    }
    return result;
  }

  function purgeLocation(locationID, registered, dropped, unregistered) {
    if (!registered.has(locationID) && !itemsByLocation.has(locationID)) return false;
    for (const [itemID, row] of rows) {
      if (key(required(rowFields(row), "locationID")) === locationID && !registered.has(itemID)) {
        rows.delete(itemID);
        dropped.add(itemID);
      }
    }
    dropped.add(locationID);
    rows.delete(locationID);
    if (registered.delete(locationID)) unregistered.add(locationID);
    itemsByLocation.delete(locationID);
    return true;
  }

  // OnGodmaFlushLocation1296 -> direct PurgeEntries, with the same explicit
  // no-pending numeric boundary as purge(). Caller performs cache/event cleanup.
  function flush(locationID) {
    const id = key(locationID), dropped = new Set(), unregistered = new Set();
    const purged = purgeLocation(id, registeredIDs(), dropped, unregistered);
    return { dropped, unregistered, capacityChanges: purged ? [id] : [] };
  }

  /** Numeric no-pending-prime subset. Returned dropped IDs are PurgeEntry
   * cleanup keys, including a purged location even if it had no raw row.
   * The caller removes unregistered IDs from its own guard registry. Kept
   * location effect deactivation, tuple cleanup and capacity events are external. */
  function purge(keepList) {
    const keep = new Set([...keepList].map(key));
    const registered = registeredIDs();
    const dropped = new Set();
    const unregistered = new Set();
    // Native takes a fresh keys snapshot for phase two, after phase one's
    // PurgeEntries has removed registered locations and their buckets.
    for (const locationID of [...registered]) if (!keep.has(locationID)) purgeLocation(locationID, registered, dropped, unregistered);
    for (const locationID of [...itemsByLocation.keys()]) if (!keep.has(locationID)) purgeLocation(locationID, registered, dropped, unregistered);
    return { dropped, unregistered };
  }

  return {
    update,
    ensureLocation,
    prime,
    coldPrime: prime,
    notice,
    flush,
    get: itemID => rows.get(key(itemID)) ?? null,
    has: itemID => rows.has(key(itemID)),
    // Native IsLocationLoaded1121 checks membership buckets, not invByID.
    locationLoaded: locationID => itemsByLocation.has(key(locationID)),
    purge,
    clear() {
      rows.clear();
      itemsByLocation.clear();
    },
  };
}

module.exports = { createGodmaInventoryRows };
