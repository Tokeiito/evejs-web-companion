"use strict";

// ── A hold's capacity, worked out as the retail client works it out ──────────
//
// The retail client never asks the server how full a hold is. Its inventory
// cache answers GetCapacity itself (eve/client/script/environment/invCache.py
// 1224), and for a ship godma does (godma.py 871):
//
//   capacity   a station's hangar: 9000000000000000.0, with nothing used. It
//              has no limit, and the client shows none for it.
//              a ship's hold: the ship's own attribute, as dogma has it now
//              (cargo is `capacity`).
//   used       the volume of each thing the hold's List answered that is in
//              that flag, each above nought, summed
//              (inventorycommon/util.py GetItemVolume):
//                assembled (a singleton)  the type's own volume
//                packaged                 the override for its type, else for
//                                         its group, else the type's own
//                a plastic wrap           -quantity / 100
//              times the stack, where the volume is not -1.
//
// The overrides are the client's own tables (src/clientData/clientConstants.js),
// handed in here: `tables` is { byGroup: Map, byType: Map, plasticWrapTypeID }.
// `typeVolume(typeID)` answers a type's own volume, or null when it is not
// known. A sum with a thing in it whose volume is not known is not known: null,
// never a sum that leaves the thing out.

/** invCache.GetCapacity for a station or an office: no limit in sight. */
const STATION_CAPACITY = 9000000000000000.0;

/** inventorycommon/util.py GetPackagedVolume. */
function packagedVolume(typeID, groupID, typeVolume, tables) {
  return tables.byType.get(typeID) ?? tables.byGroup.get(groupID) ?? typeVolume(typeID);
}

/** inventorycommon/util.py GetItemVolume: what one row of a List takes up, or null when its type's volume is not known. */
function itemVolume(item, typeVolume, tables) {
  const typeID = Number(item.typeID);
  let volume;
  if (Number(item.singleton)) {
    volume = typeID === tables.plasticWrapTypeID ? -Number(item.quantity) / 100 : typeVolume(typeID);
  } else {
    volume = packagedVolume(typeID, Number(item.groupID), typeVolume, tables);
  }
  if (volume === null || volume === undefined) return null;
  if (volume === -1) return volume;
  const stack = Number(item.stacksize);
  return volume * (stack < 0 ? 1 : stack);
}

/** What is used of the hold a flag names: godma.GetCapacity's sum over what the List answered. */
function usedVolume(rows, flag, typeVolume, tables) {
  let used = 0;
  for (const row of rows) {
    if (Number(row.flagID) !== flag) continue;
    const volume = itemVolume(row, typeVolume, tables);
    if (volume === null) return null;
    if (volume > 0) used += volume;
  }
  return used;
}

/** The Row the client makes of the two, in the shape GetCapacity's answer comes in. */
function capacityAnswer(capacity, used) {
  return { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["capacity", capacity], ["used", used]] } };
}

module.exports = { STATION_CAPACITY, capacityAnswer, itemVolume, packagedVolume, usedVolume };
