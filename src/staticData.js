"use strict";

const fs = require("fs");
const path = require("path");
const config = require("./config");

const DATA_DIR = path.join(config.eveRoot, "_local", "gameStore", "data");
const SDE_DIR = path.join(
  config.eveRoot,
  "_local",
  "sde",
  "eve-online-static-data-3396210-jsonl",
);
const caches = new Map();
const VALID_ICON_SIZES = new Set([32, 64, 128, 256, 512, 1024]);

function readStaticTable(tableName) {
  const filePath = path.join(DATA_DIR, tableName, "data.json");
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function readJsonlTable(fileName) {
  const filePath = path.join(SDE_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function buildIndex(tableName, bucketName, idField) {
  const cacheKey = `${tableName}:${bucketName}:${idField}`;
  if (caches.has(cacheKey)) {
    return caches.get(cacheKey);
  }

  const table = readStaticTable(tableName);
  const bucket = table[bucketName] || table;
  const values = Array.isArray(bucket) ? bucket : Object.values(bucket);
  const index = new Map();
  for (const entry of values) {
    const id = Number(entry && entry[idField]);
    if (id > 0) {
      index.set(id, entry);
    }
  }
  caches.set(cacheKey, index);
  return index;
}

function buildJsonlIndex(fileName, idField = "_key") {
  const cacheKey = `jsonl:${fileName}:${idField}`;
  if (caches.has(cacheKey)) {
    return caches.get(cacheKey);
  }

  const index = new Map();
  for (const entry of readJsonlTable(fileName)) {
    const id = Number(entry && entry[idField]);
    if (id > 0) {
      index.set(id, entry);
    }
  }
  caches.set(cacheKey, index);
  return index;
}

function getType(typeID) {
  const numericTypeID = Number(typeID) || 0;
  return (
    buildIndex("itemTypes", "types", "typeID").get(numericTypeID) ||
    getSkillType(numericTypeID) ||
    null
  );
}

function getTypeName(typeID) {
  const entry = getType(typeID);
  return entry ? String(entry.name || `Type ${typeID}`) : `Type ${typeID}`;
}

function getTypeGroupName(typeID) {
  const entry = getType(typeID);
  return entry ? String(entry.groupName || "Unknown") : "Unknown";
}

function getTypeCategoryID(typeID) {
  const entry = getType(typeID);
  return entry ? Number(entry.categoryID || 0) || null : null;
}

function getTypeCategoryName(typeID) {
  return getCategoryName(getTypeCategoryID(typeID));
}

function getCategory(categoryID) {
  return buildJsonlIndex("categories.jsonl").get(Number(categoryID) || 0) || null;
}

function getCategoryName(categoryID) {
  const entry = getCategory(categoryID);
  if (!entry) {
    return categoryID ? `Category ${categoryID}` : "Unknown";
  }
  return String(
    (entry.name && (entry.name.en || entry.name.en_us)) ||
    entry.name ||
    `Category ${categoryID}`,
  );
}

function getLocalizedValue(value) {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object") {
    return (
      value.en ||
      value.en_us ||
      Object.values(value).find((entry) => typeof entry === "string") ||
      null
    );
  }
  return null;
}

function getLocalizedName(entry, fallback) {
  return String(
    getLocalizedValue(entry && entry.name) ||
    (entry && (
      entry.corporationName ||
      entry.allianceName ||
      entry.factionName ||
      entry.regionName ||
      entry.shortName ||
      entry.tickerName
    )) ||
    fallback ||
    "Unknown",
  );
}

function getRegion(regionID) {
  return buildJsonlIndex("mapRegions.jsonl").get(Number(regionID) || 0) || null;
}

function getRegionName(regionID) {
  const numericRegionID = Number(regionID) || 0;
  if (!numericRegionID) {
    return null;
  }
  const entry = getRegion(numericRegionID);
  return entry ? getLocalizedName(entry, `Region ${numericRegionID}`) : `Region ${numericRegionID}`;
}

function getCorporation(corporationID) {
  const numericCorporationID = Number(corporationID) || 0;
  if (!numericCorporationID) {
    return null;
  }
  return (
    buildIndex("corporations", "records", "corporationID").get(numericCorporationID) ||
    buildJsonlIndex("npcCorporations.jsonl").get(numericCorporationID) ||
    null
  );
}

function getCorporationName(corporationID) {
  const numericCorporationID = Number(corporationID) || 0;
  if (!numericCorporationID) {
    return null;
  }
  const entry = getCorporation(numericCorporationID);
  return entry
    ? getLocalizedName(entry, `Corporation ${numericCorporationID}`)
    : `Corporation ${numericCorporationID}`;
}

function getAlliance(allianceID) {
  const numericAllianceID = Number(allianceID) || 0;
  if (!numericAllianceID) {
    return null;
  }
  return buildIndex("alliances", "records", "allianceID").get(numericAllianceID) || null;
}

function getAllianceName(allianceID) {
  const numericAllianceID = Number(allianceID) || 0;
  if (!numericAllianceID) {
    return null;
  }
  const entry = getAlliance(numericAllianceID);
  return entry
    ? getLocalizedName(entry, `Alliance ${numericAllianceID}`)
    : `Alliance ${numericAllianceID}`;
}

function getMarketGroup(marketGroupID) {
  return buildJsonlIndex("marketGroups.jsonl").get(Number(marketGroupID) || 0) || null;
}

function getMarketGroupName(marketGroupID) {
  const entry = getMarketGroup(marketGroupID);
  return entry ? getLocalizedName(entry, `Market Group ${marketGroupID}`) : null;
}

function getMarketGroupPath(marketGroupID) {
  const pathEntries = [];
  let currentID = Number(marketGroupID) || 0;
  const seen = new Set();
  while (currentID > 0 && !seen.has(currentID)) {
    seen.add(currentID);
    const entry = getMarketGroup(currentID);
    if (!entry) {
      break;
    }
    pathEntries.unshift({
      marketGroupID: currentID,
      name: getLocalizedName(entry, `Market Group ${currentID}`),
      parentGroupID: Number(entry.parentGroupID || 0) || null,
      hasTypes: entry.hasTypes === true,
    });
    currentID = Number(entry.parentGroupID || 0) || 0;
  }
  return pathEntries;
}

function normalizeIconRequest(typeID, size = 64, variation = "icon") {
  const numericTypeID = Number(typeID) || 0;
  const numericSize = VALID_ICON_SIZES.has(Number(size))
    ? Number(size)
    : 64;
  const safeVariation = String(variation || "icon").replace(/[^a-z0-9_-]/gi, "") || "icon";
  return {
    typeID: numericTypeID,
    size: numericSize,
    variation: safeVariation,
  };
}

function getTypeIconCachePath(typeID, size = 64, variation = "icon") {
  const normalized = normalizeIconRequest(typeID, size, variation);
  return normalized.typeID > 0
    ? path.join(
      config.iconCacheDir,
      "types",
      String(normalized.size),
      normalized.variation,
      `${normalized.typeID}.png`,
    )
    : null;
}

function getLocalTypeIconUrl(typeID, size = 64, variation = "icon") {
  const normalized = normalizeIconRequest(typeID, size, variation);
  const cachePath = getTypeIconCachePath(normalized.typeID, normalized.size, normalized.variation);
  if (!cachePath || !fs.existsSync(cachePath)) {
    return null;
  }
  return `${config.iconCacheUrlPath}/types/${normalized.size}/${normalized.variation}/${normalized.typeID}.png`;
}

function getRemoteTypeIconUrl(typeID, size = 64, variation = "icon") {
  const normalized = normalizeIconRequest(typeID, size, variation);
  return normalized.typeID > 0
    ? `https://images.evetech.net/types/${normalized.typeID}/${normalized.variation}?size=${normalized.size}`
    : null;
}

function getTypeIconUrl(typeID, size = 64, variation = "icon") {
  const localUrl = getLocalTypeIconUrl(typeID, size, variation);
  if (localUrl) {
    return localUrl;
  }
  const normalized = normalizeIconRequest(typeID, size, variation);
  return normalized.typeID > 0
    ? getRemoteTypeIconUrl(normalized.typeID, normalized.size, normalized.variation)
    : null;
}

function getSkillType(typeID) {
  return buildIndex("skillTypes", "skills", "typeID").get(Number(typeID) || 0) || null;
}

function buildTypeDogmaIndex() {
  const cacheKey = "typeDogma:typesByTypeID";
  if (caches.has(cacheKey)) {
    return caches.get(cacheKey);
  }
  const table = readStaticTable("typeDogma");
  const rows = table.typesByTypeID || {};
  const index = new Map();
  for (const [typeID, entry] of Object.entries(rows)) {
    const numericTypeID = Number(typeID || (entry && entry.typeID) || 0);
    if (numericTypeID > 0) {
      index.set(numericTypeID, entry);
    }
  }
  caches.set(cacheKey, index);
  return index;
}

function getTypeDogma(typeID) {
  return buildTypeDogmaIndex().get(Number(typeID) || 0) || null;
}

function getTypeDogmaAttribute(typeID, attributeID, fallback = null) {
  const dogma = getTypeDogma(typeID);
  const attributes = dogma && dogma.attributes;
  if (!attributes || typeof attributes !== "object") {
    return fallback;
  }
  const numericAttributeID = Number(attributeID) || 0;
  if (Object.prototype.hasOwnProperty.call(attributes, String(numericAttributeID))) {
    return attributes[String(numericAttributeID)];
  }
  if (Object.prototype.hasOwnProperty.call(attributes, numericAttributeID)) {
    return attributes[numericAttributeID];
  }
  return fallback;
}

function getStation(stationID) {
  return buildIndex("stations", "stations", "stationID").get(Number(stationID) || 0) || null;
}

function getStationName(stationID) {
  const entry = getStation(stationID);
  return entry ? String(entry.stationName || `Station ${stationID}`) : `Station ${stationID}`;
}

function getStationShortName(stationID) {
  const numericStationID = Number(stationID) || 0;
  if (numericStationID === 60003760) {
    return "Jita 4-4";
  }
  return getStationName(numericStationID);
}

function getSolarSystem(solarSystemID) {
  return buildIndex("solarSystems", "solarSystems", "solarSystemID").get(Number(solarSystemID) || 0) || null;
}

function getSolarSystemName(solarSystemID) {
  const entry = getSolarSystem(solarSystemID);
  return entry ? String(entry.solarSystemName || `System ${solarSystemID}`) : `System ${solarSystemID}`;
}

// --- System-adjacency graph (goal R5b) -------------------------------------
// The browser autopilot's route solver is client-side (retail solves routes
// locally from its static map DB; there is no wire call to the game server for
// a route — roadmap §7 / G2). We serve the adjacency it needs as read-only
// static reference data, exactly as station names stay client-local.
//
// The gameStore `stargates` table is the source: each record is one DIRECTED
// edge with the gate IDs the R5a jump call wants — itemID is the source gate in
// `solarSystemID` (the autopilot warps to it and jumps through it), and
// destinationID is the gate on the far side in `destinationSolarSystemID` (the
// `toGate` of beyonce.CmdStargateJump). This mirrors what autopilot.py reads
// from `cfg.mapSolarSystemContentCache[sys].stargates` (`sg.destination`).

function getStargates() {
  const cacheKey = "stargates:list";
  if (caches.has(cacheKey)) {
    return caches.get(cacheKey);
  }
  const table = readStaticTable("stargates");
  const list = Array.isArray(table.stargates) ? table.stargates : [];
  caches.set(cacheKey, list);
  return list;
}

/**
 * The compact system-adjacency graph the browser route solver consumes:
 * `edges` is a flat array of `[fromSystemID, toSystemID, fromGateID, toGateID]`
 * tuples (one per stargate), `systems` maps each gate-connected system ID to
 * its name (for the travel-panel readout only). Cached after the first build.
 */
function getSolarSystemGraph() {
  const cacheKey = "map:solarSystemGraph";
  if (caches.has(cacheKey)) {
    return caches.get(cacheKey);
  }
  const edges = [];
  const systemIDs = new Set();
  for (const gate of getStargates()) {
    const fromSystemID = Number(gate && gate.solarSystemID) || 0;
    const toSystemID = Number(gate && gate.destinationSolarSystemID) || 0;
    const fromGateID = Number(gate && gate.itemID) || 0;
    const toGateID = Number(gate && gate.destinationID) || 0;
    if (fromSystemID <= 0 || toSystemID <= 0 || fromGateID <= 0) {
      continue;
    }
    edges.push([fromSystemID, toSystemID, fromGateID, toGateID]);
    systemIDs.add(fromSystemID);
    systemIDs.add(toSystemID);
  }
  const systems = {};
  for (const systemID of systemIDs) {
    systems[systemID] = getSolarSystemName(systemID);
  }
  const graph = { systems, edges };
  caches.set(cacheKey, graph);
  return graph;
}

function getIndustryBlueprint(blueprintTypeID) {
  return buildIndex(
    "industryBlueprints",
    "blueprintDefinitions",
    "blueprintTypeID",
  ).get(Number(blueprintTypeID) || 0) || null;
}

function getNpcIndustryFacility(facilityID) {
  return buildIndex(
    "industryFacilities",
    "npcFacilityProfiles",
    "facilityID",
  ).get(Number(facilityID) || 0) || null;
}

module.exports = {
  getAlliance,
  getAllianceName,
  getCategory,
  getCategoryName,
  getCorporation,
  getCorporationName,
  getIndustryBlueprint,
  getMarketGroup,
  getMarketGroupName,
  getMarketGroupPath,
  getNpcIndustryFacility,
  getRegion,
  getRegionName,
  getSolarSystem,
  getSolarSystemGraph,
  getSolarSystemName,
  getStargates,
  getStation,
  getStationName,
  getStationShortName,
  getLocalTypeIconUrl,
  getRemoteTypeIconUrl,
  getSkillType,
  getType,
  getTypeCategoryID,
  getTypeCategoryName,
  getTypeDogma,
  getTypeDogmaAttribute,
  getTypeGroupName,
  getTypeIconCachePath,
  getTypeIconUrl,
  getTypeName,
  normalizeIconRequest,
};
