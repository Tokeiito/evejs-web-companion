"use strict";

// Numeric StateManager.invitems/itemsByLocationID only (godma.py UpdateItem1553-1657,
// PurgeInventories/PurgeEntries2452-2507). Attributes/effects, pending tasklets,
// tuple sublocations and clientDogmaLocation loaded nodes are separate state.
const CATEGORIES = new Set([11, 23, 40, 6, 7, 8, 18, 32, 87, 65, 66]);
const FITTING_CATEGORIES = new Set([7, 66, 8, 32]);
const LOCATION_CATEGORIES = new Set([6, 23, 65]);
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

function createGodmaInventoryRows({ rowFields, registeredLocations = () => [] }) {
  const rows = new Map();
  const itemsByLocation = new Map();

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
    if (LOCATION_CATEGORIES.has(categoryID) || groupID === 1) itemsByLocation.set(itemID, new Set());
    if (!worldLocation(locationID)) {
      const parent = itemsByLocation.get(locationID);
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

  /** Numeric no-pending-prime subset. Returned dropped IDs are PurgeEntry
   * cleanup keys, including a purged location even if it had no raw row.
   * The caller removes unregistered IDs from its own guard registry. Kept
   * location effect deactivation, tuple cleanup and capacity events are external. */
  function purge(keepList) {
    const keep = new Set([...keepList].map(key));
    const registered = new Set([...registeredLocations()].map(key));
    const dropped = new Set();
    const unregistered = new Set();
    function purgeLocation(locationID) {
      if (!registered.has(locationID) && !itemsByLocation.has(locationID)) return;
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
    }
    // Native takes a fresh keys snapshot for phase two, after phase one's
    // PurgeEntries has removed registered locations and their buckets.
    for (const locationID of [...registered]) if (!keep.has(locationID)) purgeLocation(locationID);
    for (const locationID of [...itemsByLocation.keys()]) if (!keep.has(locationID)) purgeLocation(locationID);
    return { dropped, unregistered };
  }

  return {
    update,
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
