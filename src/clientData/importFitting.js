"use strict";

// ── A fitting read from text as the client reads one ─────────────────────────
//
// The fitting window's Import from Clipboard (hullAndHardwareTypeBrowser._paste_fitting_from_clipboard, 703 to 706;
// fittingSvc.ImportFittingFromClipboard, 1111 to 1138) reads the clipboard's text with shipfitting/importFittingUtil.py:
//
//   - FindShipAndFittingName: the first line "[ship, name]" (an "[Empty Low slot]" line is none): the ship's name before
//     the first comma, the fitting's after it (all of it where there is no comma);
//   - the ship's type by that name, lowered (TextToTypeIDFinder: the English names of the types of nine categories, ice
//     and two type lists, each cleaned (CleanAndStripText) and lowered);
//   - GetAllItems: each other line read (GetLineInfo): "module, charge", "type xN", or an empty slot's line; a line it
//     cannot read is one of the error lines;
//   - CreateFittingData: a module without a quantity in the next slot of its kind (its slot effect, or a subsystem's
//     slot attribute), up to the ship's count of that kind; a module's charge to the cargo, as many as the module holds
//     (capacity / the charge's volume); with a quantity, a module or subsystem to the cargo, a charge, implant, ice,
//     filament or other cargo hold type to the cargo, a drone to the drone bay, a fighter to the fighter bay.
//
// The client's failures (no ship line, a ship it does not know, nothing in the fitting, and anything its reading
// raises, as a quantity that is no whole number) are all ImportingErrorFromClipboard.
//
// This is that reading, line for line. The types are the server's static tables', the names English (a client in
// English: its localized names are none). Where two of the types share a name, the client's dict keeps the last of
// its set's order; here the set is taken as built in the order of the types' numbers (py27 dictOrder), where the
// client's is built by group: a shared name (expired accelerators, mostly) may name another of them.

const { cleanText } = require("./importMultibuy");
const { dictOrder } = require("../gamePort/py27");

const OFFLINE_INDICATOR = "/offline";
const CHARGE_SEPARATOR = ",";
const MULTIPLIER_SEPARATOR = " x";
/** emptySlotDict: an empty slot's line, lowered, and the kind of slot it holds. */
const EMPTY_SLOT = Object.freeze({
  "[empty low slot]": "flagLoSlot",
  "[empty med slot]": "flagMedSlot",
  "[empty high slot]": "flagHiSlot",
  "[empty rig slot]": "flagRigSlot",
  "[empty service slot]": "flagServiceSlot",
});
/** slotDict: dogma/const.py's slot effects (effectRigSlot, effectHiPower, effectMedPower, effectLoPower, effectServiceSlot). */
const SLOT_BY_EFFECT = new Map([[2663, "flagRigSlot"], [12, "flagHiSlot"], [13, "flagMedSlot"], [11, "flagLoSlot"], [6306, "flagServiceSlot"]]);
/** inventorycommon/const.py: each kind's first slot (getattr(invconst, '%s%s' % (slotLocation, slotIdx))). */
const FIRST_SLOT = Object.freeze({ flagLoSlot: 11, flagMedSlot: 19, flagHiSlot: 27, flagRigSlot: 92, flagServiceSlot: 164 });
const SUBSYSTEM_SLOT_FLAGS = Object.freeze([125, 126, 127, 128]);
const FLAG_CARGO = 5;
const FLAG_DRONE_BAY = 87;
const FLAG_FIGHTER_BAY = 158;
const NUM_SLOTS = 8;
const GROUP_STRATEGIC_CRUISER = 963;
const GROUP_ICE_PRODUCT = 423;
const CATEGORY_MODULE = 7;
const CATEGORY_CHARGE = 8;
const CATEGORY_DRONE = 18;
const CATEGORY_IMPLANT = 20;
const CATEGORY_SUBSYSTEM = 32;
const CATEGORY_FIGHTER = 87;
/** validCategoryIDs: ship, structure module, module, subsystem, charge, drone, fighter, structure, implant. */
const VALID_CATEGORY_IDS = Object.freeze([6, 66, 7, 32, 8, 18, 87, 65, 20]);
const TYPE_LIST_FILAMENTS = 324;
const TYPE_LIST_OTHER_CARGO_HOLD_TYPES = 518;
/** dogma/const.py: the slot attributes (attributeSubSystemSlot, RigSlots, HiSlots, MedSlots, LowSlots, ServiceSlots). */
const ATTRIBUTE_SUBSYSTEM_SLOT = 1366;
const ATTRIBUTE_RIG_SLOTS = 1137;
const ATTRIBUTE_HI_SLOTS = 14;
const ATTRIBUTE_MED_SLOTS = 13;
const ATTRIBUTE_LOW_SLOTS = 12;
const ATTRIBUTE_SERVICE_SLOTS = 2056;

const PY_INT = /^\s*[+-]?\d+\s*$/;

/** The client's reading failed: ImportingErrorFromClipboard. */
class ImportingError extends Error {}

/** textImporting.GetLines (21 to 28) with words to take out: each line, trimmed, the empty ones left out. */
function getLines(text, wordsToRemove = []) {
  let withBreaks = String(text).replace(/\n/g, "<br>").replace(/\r\n/g, "<br>");
  for (const word of wordsToRemove) withBreaks = withBreaks.split(word).join("");
  return splitAndStrip(withBreaks, "<br>");
}

/** textImporting.SplitAndStrip: the parts, trimmed, the empty ones left out. */
function splitAndStrip(text, splitOn) {
  return String(text).split(splitOn).map((part) => part.trim()).filter((part) => part.length > 0);
}

/** IsShipLine: "[...]" and not an empty slot's line. */
function isShipLine(text) {
  return text.startsWith("[") && text.endsWith("]") && !Object.hasOwn(EMPTY_SLOT, text.toLowerCase());
}

/** FindShipAndFittingName (221 to 233): the ship's name and the fitting's, or null with no ship line. */
function findShipAndFittingName(text) {
  for (const line of getLines(text, [OFFLINE_INDICATOR])) {
    if (!isShipLine(line)) continue;
    const shipInfo = line.slice(1, -1);
    const parts = splitAndStrip(shipInfo, CHARGE_SEPARATOR);
    const commaIdx = shipInfo.indexOf(CHARGE_SEPARATOR);
    return { shipName: parts[0] ?? "", fitName: shipInfo.slice(commaIdx + 1).trim() };
  }
  return null;
}

/**
 * The names the client's import finds types by (ImportFittingUtil.__init__, TextToTypeIDFinder.GetTypesByLowerName):
 * each type of the nine categories, of the ice products and of the two type lists, by its English name cleaned, trimmed
 * and lowered. `types` are the static tables' types; `listTypeIDs(listID)` a type list's types.
 */
function importTypeNames(types, listTypeIDs) {
  const listed = new Set([...(listTypeIDs(TYPE_LIST_FILAMENTS) ?? []), ...(listTypeIDs(TYPE_LIST_OTHER_CARGO_HOLD_TYPES) ?? [])]);
  const byID = new Map();
  for (const type of types) {
    if (!type || typeof type.name !== "string") continue;
    const typeID = Number(type.typeID);
    if (VALID_CATEGORY_IDS.includes(Number(type.categoryID)) || Number(type.groupID) === GROUP_ICE_PRODUCT || listed.has(typeID)) byID.set(typeID, type.name);
  }
  const names = new Map();
  for (const typeID of dictOrder([...byID.keys()].sort((left, right) => left - right))) {
    names.set(cleanText(byID.get(typeID)).trim().toLowerCase(), typeID);
  }
  return { names, listed };
}

/**
 * ImportFittingUtil.GetSlot (121 to 129): the kind of slot a type's slot effect names, else its subsystem slot (the
 * flag itself), else none.
 */
function slotOf(dogma) {
  for (const effectID of (dogma && dogma.effects) || []) {
    if (SLOT_BY_EFFECT.has(Number(effectID))) return SLOT_BY_EFFECT.get(Number(effectID));
  }
  const subsystemSlot = Number(dogma && dogma.attributes ? dogma.attributes[ATTRIBUTE_SUBSYSTEM_SLOT] : 0) || 0;
  return subsystemSlot ? Math.trunc(subsystemSlot) : null;
}

/** GetSlotNumbers (131 to 145): how many slots of each kind the ship has (a strategic cruiser eight of each, and its four subsystems). */
function slotNumbers(type, dogma) {
  const attribute = (attributeID) => Number(dogma && dogma.attributes ? dogma.attributes[attributeID] : 0) || 0;
  const slots = { flagRigSlot: attribute(ATTRIBUTE_RIG_SLOTS) };
  if (type && Number(type.groupID) === GROUP_STRATEGIC_CRUISER) {
    slots.flagHiSlot = NUM_SLOTS;
    slots.flagMedSlot = NUM_SLOTS;
    slots.flagLoSlot = NUM_SLOTS;
    for (const flag of SUBSYSTEM_SLOT_FLAGS) slots[flag] = 1;
  } else {
    slots.flagHiSlot = attribute(ATTRIBUTE_HI_SLOTS);
    slots.flagMedSlot = attribute(ATTRIBUTE_MED_SLOTS);
    slots.flagLoSlot = attribute(ATTRIBUTE_LOW_SLOTS);
    slots.flagServiceSlot = attribute(ATTRIBUTE_SERVICE_SLOTS);
  }
  return slots;
}

/**
 * A fitting read from text as fittingSvc.ImportFittingFromClipboard reads one. `names` from importTypeNames;
 * `typeOf(typeID)` a type's row ({groupID, categoryID, capacity, volume}) or null; `dogmaOf(typeID)` its dogma
 * ({attributes, effects}) or null. Answers { shipTypeID, name, fitData: [[typeID, flagID, qty], ...], errorLines },
 * or { error: "ImportingErrorFromClipboard" }.
 */
function readFitting(text, { names, listed, typeOf, dogmaOf }) {
  try {
    const found = findShipAndFittingName(text);
    if (found === null) throw new ImportingError("No ship's line.");
    const typeIDOf = (name) => (name === null || name === undefined ? null : names.get(name) ?? null);
    const shipTypeID = typeIDOf(found.shipName.toLowerCase());
    if (!shipTypeID) return { error: "ImportingErrorFromClipboard" };
    const items = [];
    const errorLines = [];
    for (const line of getLines(text, [OFFLINE_INDICATOR]).filter((each) => !isShipLine(each))) {
      const info = lineInfo(line, typeIDOf, typeOf, dogmaOf);
      if (info) items.push(info);
      else errorLines.push(line);
    }
    const fitData = createFittingData(items, shipTypeID, { listed, typeOf, dogmaOf });
    if (fitData.length === 0) return { error: "ImportingErrorFromClipboard" };
    return { shipTypeID, name: found.fitName, fitData, errorLines };
  } catch {
    return { error: "ImportingErrorFromClipboard" };
  }
}

/** GetLineInfo (53 to 101): what a line names, or null where it names nothing. */
function lineInfo(line, typeIDOf, typeOf, dogmaOf) {
  const parts = splitAndStrip(line, CHARGE_SEPARATOR);
  // parts[0] of nothing raises, and the import fails.
  if (parts.length === 0) throw new ImportingError(`Nothing in: ${line}`);
  let typeName = parts[0];
  const chargeName = parts.length > 1 ? cleanText(parts[1].trim()).toLowerCase() : null;
  const qtyParts = splitAndStrip(typeName, MULTIPLIER_SEPARATOR);
  if (qtyParts.length === 0) throw new ImportingError(`Nothing in: ${line}`);
  typeName = qtyParts[0];
  const hasQty = qtyParts.length > 1;
  let numItems = 1;
  if (hasQty) {
    // int(parts[1]): what is no whole number raises, and the import fails.
    if (!PY_INT.test(qtyParts[1])) throw new ImportingError(`Not a quantity: ${qtyParts[1]}`);
    numItems = Number.parseInt(qtyParts[1], 10);
  }
  if (typeName) typeName = cleanText(typeName).toLowerCase();
  const typeID = typeIDOf(typeName);
  const chargeTypeID = typeIDOf(chargeName);
  let isEmpty = true;
  let slotLocation = null;
  if (Object.hasOwn(EMPTY_SLOT, typeName)) {
    slotLocation = EMPTY_SLOT[typeName];
  } else if (typeID) {
    isEmpty = false;
    if (!hasQty) slotLocation = slotOf(dogmaOf(typeID));
  }
  if (typeID === null && chargeTypeID === null && slotLocation === null) return null;
  const type = typeID ? typeOf(typeID) : null;
  const charge = chargeTypeID ? typeOf(chargeTypeID) : null;
  return {
    typeID,
    categoryID: type ? Number(type.categoryID) : null,
    capacity: type ? Number(type.capacity) || 0 : null,
    numItems,
    chargeTypeID,
    chargeVolume: charge ? Number(charge.volume) || 0 : null,
    slotLocation,
    isEmpty,
  };
}

/** CreateFittingData (147 to 199): the fitting's entries, the modules by slot then the cargo, the drones and the fighters. */
function createFittingData(items, shipTypeID, { listed, typeOf, dogmaOf }) {
  const fitData = [];
  const cargoByType = new Map();
  const dronesByType = new Map();
  const fightersByType = new Map();
  const add = (map, typeID, amount) => map.set(typeID, (map.get(typeID) ?? 0) + amount);
  const locationCount = new Map();
  const allowed = slotNumbers(typeOf(shipTypeID), dogmaOf(shipTypeID));
  for (const item of items) {
    const { slotLocation, typeID, categoryID, capacity } = item;
    if (slotLocation) {
      const placed = locationCount.get(slotLocation) ?? 0;
      if (placed >= (allowed[slotLocation] ?? 0)) continue;
      locationCount.set(slotLocation, placed + 1);
      if (item.isEmpty || !typeID) continue;
      const flag = categoryID === CATEGORY_SUBSYSTEM ? slotLocation : FIRST_SLOT[slotLocation] !== undefined ? FIRST_SLOT[slotLocation] + placed : null;
      fitData.push([typeID, flag, 1]);
      if (item.chargeTypeID) {
        // capacity / chargeVolume: a volume of nought raises, and the import fails.
        if (!item.chargeVolume) throw new ImportingError("A charge of no volume.");
        add(cargoByType, item.chargeTypeID, capacity / item.chargeVolume);
      }
    } else if (categoryID === CATEGORY_MODULE || categoryID === CATEGORY_SUBSYSTEM) {
      add(cargoByType, typeID, item.numItems);
      continue;
    }
    if (!typeID) continue;
    const type = typeOf(typeID);
    if (categoryID === CATEGORY_CHARGE || categoryID === CATEGORY_IMPLANT) add(cargoByType, typeID, item.numItems);
    else if (type && Number(type.groupID) === GROUP_ICE_PRODUCT) add(cargoByType, typeID, item.numItems);
    else if (categoryID === CATEGORY_DRONE) add(dronesByType, typeID, item.numItems);
    else if (categoryID === CATEGORY_FIGHTER) add(fightersByType, typeID, item.numItems);
    else if (listed.has(typeID)) add(cargoByType, typeID, item.numItems);
  }
  for (const [byType, flag] of [[cargoByType, FLAG_CARGO], [dronesByType, FLAG_DRONE_BAY], [fightersByType, FLAG_FIGHTER_BAY]]) {
    // defaultdict(int).iteritems(): the dict's own order.
    for (const typeID of dictOrder([...byType.keys()])) fitData.push([typeID, flag, Math.trunc(byType.get(typeID))]);
  }
  return fitData;
}

module.exports = { findShipAndFittingName, getLines, importTypeNames, readFitting };
