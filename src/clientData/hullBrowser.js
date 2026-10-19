"use strict";

// ── The fitting browser's hulls, from the client's own data ───────────────────
//
// The fitting window's browser lists every ship the market sells, by group and race, when no owner's fittings are
// asked for (fittingBrowser.py GetAllShipGroupsAndShipsByGroupID, 359 to 383). Its hulls are the types of the
// market's Ships group's children and of four of the starbase structures' children (FittingHullBrowserListProvider.
// _GetGroupList and _GetStructureGroups: the Engineering Complex, Citadel, Refinery and Navigation Structures groups).
// A group's types are the published types in it and in every group beneath it (marketutils.AddTypesToMarketGroups,
// quote.py 165 to 192). The special edition ships are the types of the Special Edition Ships group's children
// (PopulatedSpecialEditionShips, 543 to 551), whose groups the browser lists apart.
//
// Each hull goes with what the browser sorts and groups it by: its group (evetypes.GetGroupID), its faction
// (GetFactionID, the race by appConst.raceByFaction), its meta group (GetMetaGroupID) and its group's category
// (GetCategoryIDByGroup, by which a structure's fitting is told). A race's name is the message
// its record names (characterdata/races.py get_race_name: nameID).

const MARKET_CATEGORY_SHIPS = 4;
const MARKET_CATEGORY_STARBASE_STRUCTURES = 477;
const STRUCTURE_GROUPS = Object.freeze([2324, 2199, 2327, 2511]);
const MARKET_GROUP_SPECIAL_SHIPS = 1612;

/**
 * The browser's hulls, its special edition ships, the facts of each (and of each type asked, a fitting's hull that
 * may be no hull of the market's), and the races' names. The tables are the client's, by their rows' keys: a market
 * group's parent, a type's market group, published, group, faction and meta group, and a race's nameID.
 */
function hullBrowserData({ marketGroupParents, typeMarketGroups, typePublished, typeGroups, typeFactions, typeMetaGroups, raceNameIDs, groupCategories = {} }, askedTypeIDs = []) {
  // The published attribute as the loader prints it (a number).
  const isPublished = (key) => Boolean(Number(typePublished[key]));
  const children = new Map();
  for (const [key, parent] of Object.entries(marketGroupParents)) {
    const id = Number(key);
    const parentID = Number(parent);
    if (!children.has(parentID)) children.set(parentID, []);
    children.get(parentID).push(id);
  }
  const direct = new Map();
  for (const [key, marketGroupID] of Object.entries(typeMarketGroups)) {
    if (!isPublished(key)) continue;
    const groupID = Number(marketGroupID);
    if (!direct.has(groupID)) direct.set(groupID, []);
    direct.get(groupID).push(Number(key));
  }
  const under = new Map();
  const typesUnder = (marketGroupID) => {
    if (under.has(marketGroupID)) return under.get(marketGroupID);
    const types = new Set(direct.get(marketGroupID) ?? []);
    for (const child of children.get(marketGroupID) ?? []) for (const typeID of typesUnder(child)) types.add(typeID);
    under.set(marketGroupID, types);
    return types;
  };
  const hulls = new Set();
  for (const child of children.get(MARKET_CATEGORY_SHIPS) ?? []) for (const typeID of typesUnder(child)) hulls.add(typeID);
  for (const child of children.get(MARKET_CATEGORY_STARBASE_STRUCTURES) ?? []) {
    if (STRUCTURE_GROUPS.includes(child)) for (const typeID of typesUnder(child)) hulls.add(typeID);
  }
  const special = new Set();
  for (const child of children.get(MARKET_GROUP_SPECIAL_SHIPS) ?? []) for (const typeID of typesUnder(child)) special.add(typeID);
  const numberOrNull = (value) => (Number.isSafeInteger(Number(value)) && value !== null && value !== undefined ? Number(value) : null);
  const types = {};
  for (const typeID of new Set([...hulls, ...askedTypeIDs])) {
    const key = String(typeID);
    if (!Object.hasOwn(typeGroups, key)) {
      types[key] = null;
      continue;
    }
    types[key] = {
      groupID: numberOrNull(typeGroups[key]),
      categoryID: numberOrNull(groupCategories[String(typeGroups[key])]),
      factionID: numberOrNull(typeFactions[key]),
      metaGroupID: numberOrNull(typeMetaGroups[key]),
      published: isPublished(key),
      // evetypes.GetMarketGroupID: the type's market group (the type menu's View Market Details goes by it).
      marketGroupID: numberOrNull(typeMarketGroups[key]),
    };
  }
  const races = {};
  for (const [key, nameID] of Object.entries(raceNameIDs)) races[key] = numberOrNull(nameID);
  return {
    hullTypeIDs: [...hulls].sort((left, right) => left - right),
    specialTypeIDs: [...special].sort((left, right) => left - right),
    types,
    raceNameIDs: races,
  };
}

module.exports = { hullBrowserData };
