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

// --- Faction / character / agent name resolvers (goal R7c) -----------------
// The names-everywhere UI pass resolves every raw ID to a name. Corp / alliance
// / type / station / system already had resolvers; factions, characters, and
// agents did not. These read the same read-only gameStore reference tables
// (factions.records, the characterID-keyed characters table, and the
// agentAuthority roster whose `ownerName` is the agent's name). NPC/unknown IDs
// return null so the batch route can report a definitive "unknown" (the client
// then keeps the raw ID) — see resolveNames.

function getFaction(factionID) {
  const numericFactionID = Number(factionID) || 0;
  if (!numericFactionID) {
    return null;
  }
  return buildIndex("factions", "records", "factionID").get(numericFactionID) || null;
}

function getFactionName(factionID) {
  const numericFactionID = Number(factionID) || 0;
  if (!numericFactionID) {
    return null;
  }
  const entry = getFaction(numericFactionID);
  return entry ? getLocalizedName(entry, `Faction ${numericFactionID}`) : `Faction ${numericFactionID}`;
}

// The characters table is keyed by characterID at the top level (no `records`
// bucket, and the entries carry `characterName` but not `characterID`), so the
// index takes the object key as the ID.
function getCharactersByID() {
  const cacheKey = "characters:byID";
  if (caches.has(cacheKey)) {
    return caches.get(cacheKey);
  }
  const table = readStaticTable("characters");
  const bucket = table.characters || table.records || table;
  const index = new Map();
  for (const [key, entry] of Object.entries(bucket)) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const id = Number(entry.characterID) || Number(key) || 0;
    if (id > 0) {
      index.set(id, entry);
    }
  }
  caches.set(cacheKey, index);
  return index;
}

function getCharacter(characterID) {
  const numericCharacterID = Number(characterID) || 0;
  if (!numericCharacterID) {
    return null;
  }
  return getCharactersByID().get(numericCharacterID) || null;
}

function getCharacterName(characterID) {
  const numericCharacterID = Number(characterID) || 0;
  if (!numericCharacterID) {
    return null;
  }
  const entry = getCharacter(numericCharacterID);
  // No fallback echo: an unknown character (an NPC or another player not in the
  // local table) returns null so callers keep whatever live name they have or
  // the raw ID.
  return entry ? String(entry.characterName || entry.name || `Character ${numericCharacterID}`) : null;
}

function getAgentName(agentID) {
  const numericAgentID = Number(agentID) || 0;
  if (!numericAgentID) {
    return null;
  }
  const agent = getAgentsByID().get(numericAgentID);
  return agent ? String(agent.ownerName || `Agent ${numericAgentID}`) : null;
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

// --- Agent reference data (goal R6a) ---------------------------------------
// The per-station agentMgr.GetAgents roster is unreliable for *finding* an
// agent to travel to (it returns 0 for a character re-selected directly into a
// docked station, and only lists the current station). So the Agent Finder
// lists agents from the static agentAuthority reference table, exactly the way
// the solar-system graph is served: read-only static reference data, NOT a
// gateway call and NOT gameplay SQLite. `ownerName` is the agent's name;
// station/system names resolve through getStationName / getSolarSystemName.

const AGENT_FIND_DEFAULT_LIMIT = 500;
const AGENT_FIND_MAX_LIMIT = 5000;

// A "real" mission agent of an exposed kind is the STANDARD agent of that kind's
// retail division — NOT a Paragon / career / storyline / epic / event placeholder
// that happens to share the same `missionKind` string. The static export's
// `missionKind` is right for ordinary agents but is ALSO stamped on special
// agents (e.g. "IRIS - Jita" agentID 3020034 is a Paragon agent — division 37,
// agentType 13 — yet carries missionKind "courier"), so filtering on the raw
// `missionKind` mislabels them. The finder instead classifies by
// (divisionID, agentTypeID), the retail agent-division scheme:
//   courier   → Distribution division 22, basic agent type 2  (real couriers)
//   encounter → Security division 24, basic agent type 2
//   mining    → Mining division 23, basic agent type 2
//   research  → R&D division 18, research agent type 4
// Verified against agentAuthority/data.json (10,941 agents): of 4,421
// missionKind:"courier" rows, exactly the 3,725 div-22/type-2 rows are ordinary
// distribution agents; the other 696 are career types 5/6/7/8, storyline 10,
// event 11, research-type 3 (all still division 22), plus off-division epic
// (division 25, type 12) and Paragon (division 37, type 13) — none of which are
// ordinary courier agents. Every export row is a placeholder with empty
// missionTemplateIDs (the runnable mission content lives in the mission
// runtime), so the finder can only filter to the right KIND, not the content.
const AGENT_KIND_CLASSIFICATION = Object.freeze({
  courier: Object.freeze({ divisionID: 22, agentTypeID: 2 }),
  encounter: Object.freeze({ divisionID: 24, agentTypeID: 2 }),
  mining: Object.freeze({ divisionID: 23, agentTypeID: 2 }),
  research: Object.freeze({ divisionID: 18, agentTypeID: 4 }),
});
const AGENT_STANDARD_CLASSIFICATIONS = Object.freeze(
  Object.values(AGENT_KIND_CLASSIFICATION),
);

/** True when the agent is the standard mission agent matching one classification. */
function matchesClassification(agent, spec) {
  return (
    (Number(agent && agent.divisionID) || 0) === spec.divisionID &&
    (Number(agent && agent.agentTypeID) || 0) === spec.agentTypeID
  );
}

/** True when the agent is a real mission agent of ANY exposed kind (for "all"). */
function isStandardMissionAgent(agent) {
  return AGENT_STANDARD_CLASSIFICATIONS.some((spec) => matchesClassification(agent, spec));
}

function getAgentsByID() {
  const cacheKey = "agentAuthority:agentsByID";
  if (caches.has(cacheKey)) {
    return caches.get(cacheKey);
  }
  const table = readStaticTable("agentAuthority");
  const bucket = (table && table.agentsByID) || {};
  const index = new Map();
  for (const [key, agent] of Object.entries(bucket)) {
    const id = Number(agent && agent.agentID) || Number(key) || 0;
    if (id > 0) {
      index.set(id, agent);
    }
  }
  caches.set(cacheKey, index);
  return index;
}

/**
 * The compact agent summary the finder consumes: the agent's identity plus its
 * station/system with names resolved for display. IDs stay numeric (all fit in
 * 2^53). Distance-from-current-system is computed client-side (a single BFS
 * over the map graph — goal R6a), so no distance is baked in here.
 */
function toAgentSummary(agent) {
  const stationID = Number(agent && agent.stationID) || null;
  const solarSystemID = Number(agent && agent.solarSystemID) || null;
  const agentID = Number(agent && agent.agentID) || 0;
  return {
    agentID,
    name: String((agent && agent.ownerName) || `Agent ${agentID}`),
    level: Number(agent && agent.level) || null,
    // The retail classification the finder filters on (division + agent type),
    // carried through so the wire shape is transparent/testable.
    divisionID: Number(agent && agent.divisionID) || null,
    agentTypeID: Number(agent && agent.agentTypeID) || null,
    missionKind: agent && agent.missionKind ? String(agent.missionKind) : null,
    missionTypeLabel: agent && agent.missionTypeLabel ? String(agent.missionTypeLabel) : null,
    corporationID: Number(agent && agent.corporationID) || null,
    factionID: Number(agent && agent.factionID) || null,
    stationID,
    stationName: stationID ? getStationName(stationID) : null,
    solarSystemID,
    solarSystemName: solarSystemID ? getSolarSystemName(solarSystemID) : null,
  };
}

/**
 * Find agents from the static agentAuthority table, filtered server-side and
 * capped so the ~11k-agent dataset never crosses the wire whole (goal R6a/R6b).
 * `kind` defaults to "courier" (the milestone); "all"/"any"/"" disables the
 * kind filter and returns real mission agents of any exposed kind. Agents are
 * classified by (divisionID, agentTypeID) — NOT the raw `missionKind` — so
 * Paragon / career / storyline / epic / event placeholders are never listed
 * under an ordinary kind (goal R6b, see AGENT_KIND_CLASSIFICATION). A `kind`
 * the finder does not classify returns no matches rather than mislabel. `level`
 * (1..5) is optional. The pre-cap match set is sorted deterministically by
 * (level, agentID) so the cap is stable/reproducible; the client sorts the
 * returned rows by jumps from the current system. Returns
 * `{ agents, total, capped, kind, level, limit }` where `total` is the full
 * match count before the cap.
 */
function findAgents(filters = {}) {
  const rawKind = filters.kind === undefined || filters.kind === null ? "courier" : String(filters.kind).trim().toLowerCase();
  const kind = rawKind === "all" || rawKind === "any" || rawKind === "" ? null : rawKind;
  const level = Number(filters.level) || null;
  const requestedLimit = Number(filters.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), AGENT_FIND_MAX_LIMIT)
    : AGENT_FIND_DEFAULT_LIMIT;

  // Resolve the kind to its (division, agentType) predicate. "all" (kind===null)
  // spans every real mission agent; a requested-but-unclassified kind matches
  // nothing (better an empty finder than a mislabeled special agent).
  const spec = kind === null ? null : (AGENT_KIND_CLASSIFICATION[kind] || undefined);
  const isKindMatch = kind === null
    ? isStandardMissionAgent
    : (spec === undefined ? null : (agent) => matchesClassification(agent, spec));
  if (isKindMatch === null) {
    return { agents: [], total: 0, capped: false, kind, level, limit };
  }

  const matches = [];
  for (const agent of getAgentsByID().values()) {
    if (!isKindMatch(agent)) {
      continue;
    }
    if (level !== null && (Number(agent.level) || null) !== level) {
      continue;
    }
    matches.push(agent);
  }
  matches.sort((a, b) => {
    const levelDelta = (Number(a.level) || 0) - (Number(b.level) || 0);
    if (levelDelta !== 0) {
      return levelDelta;
    }
    return (Number(a.agentID) || 0) - (Number(b.agentID) || 0);
  });

  const total = matches.length;
  const capped = total > limit;
  const agents = (capped ? matches.slice(0, limit) : matches).map(toAgentSummary);
  return { agents, total, capped, kind: kind, level, limit };
}

// --- Map location name search (goal R7a) -----------------------------------
// So a player can set a travel destination by NAME (not a raw EVE ID), the
// Travel tab searches the static solar-system + station tables by name. This is
// read-only static reference data exactly like getSolarSystemGraph / findAgents
// — NOT a gateway/bridge call. The client then reuses startRoute(id) (the R5b
// route solver + autopilot) on a chosen match. Matches carry the solar system
// so the client can annotate jumps-away from the current system.

const MAP_FIND_DEFAULT_LIMIT = 50;
const MAP_FIND_MAX_LIMIT = 200;
const MAP_FIND_MIN_QUERY = 2;

// Match quality: an exact name beats a prefix beats a substring (-1 = no match).
// So a search for "Jita" surfaces the Jita SYSTEM before "Jita IV - ..." stations.
function scoreNameMatch(lowerName, needle) {
  if (lowerName === needle) {
    return 0;
  }
  if (lowerName.startsWith(needle)) {
    return 1;
  }
  return lowerName.includes(needle) ? 2 : -1;
}

/**
 * Search the static solar-system and station tables by name (goal R7a). `q` is
 * the (trimmed, case-insensitive) query; `kind` optionally narrows to just
 * "system" or "station" (default: both). Results are ranked by match quality
 * (exact → prefix → substring), then shorter name, then alphabetically, and
 * capped (default 50 / max 200) so a broad query stays responsive. A query
 * shorter than MAP_FIND_MIN_QUERY returns nothing (no whole-table dump). Each
 * match is `{ id, name, kind, solarSystemID, solarSystemName }` — `id` is the
 * station or system ID the client hands to startRoute. Returns
 * `{ matches, total, capped, q, kind, limit }` (`total` = full match count
 * before the cap).
 */
function findMapLocations(filters = {}) {
  const q = filters.q === undefined || filters.q === null ? "" : String(filters.q).trim();
  const rawKind = filters.kind === undefined || filters.kind === null ? "" : String(filters.kind).trim().toLowerCase();
  const kind = rawKind === "system" || rawKind === "station" ? rawKind : null;
  const requestedLimit = Number(filters.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), MAP_FIND_MAX_LIMIT)
    : MAP_FIND_DEFAULT_LIMIT;
  if (q.length < MAP_FIND_MIN_QUERY) {
    return { matches: [], total: 0, capped: false, q, kind, limit };
  }

  const needle = q.toLowerCase();
  const scored = [];
  if (kind === null || kind === "system") {
    for (const system of buildIndex("solarSystems", "solarSystems", "solarSystemID").values()) {
      const name = String((system && system.solarSystemName) || "");
      const score = scoreNameMatch(name.toLowerCase(), needle);
      if (score < 0) {
        continue;
      }
      const id = Number(system && system.solarSystemID) || 0;
      scored.push({ score, name, entry: { id, name, kind: "system", solarSystemID: id, solarSystemName: name } });
    }
  }
  if (kind === null || kind === "station") {
    for (const station of buildIndex("stations", "stations", "stationID").values()) {
      const name = String((station && station.stationName) || "");
      const score = scoreNameMatch(name.toLowerCase(), needle);
      if (score < 0) {
        continue;
      }
      const id = Number(station && station.stationID) || 0;
      const solarSystemID = Number(station && station.solarSystemID) || null;
      const solarSystemName = solarSystemID
        ? getSolarSystemName(solarSystemID)
        : (station && station.solarSystemName ? String(station.solarSystemName) : null);
      scored.push({ score, name, entry: { id, name, kind: "station", solarSystemID, solarSystemName } });
    }
  }
  scored.sort((a, b) =>
    a.score - b.score ||
    a.name.length - b.name.length ||
    a.name.localeCompare(b.name) ||
    a.entry.id - b.entry.id);

  const total = scored.length;
  const capped = total > limit;
  const matches = (capped ? scored.slice(0, limit) : scored).map((s) => s.entry);
  return { matches, total, capped, q, kind, limit };
}

// --- Batch name resolution (goal R7c) --------------------------------------
// The names-everywhere UI pass turns raw IDs into names across every tab. So an
// inventory list of many typeIDs (or a guest list of corp IDs) resolves in ONE
// round-trip, the BFF exposes a batch resolver over the existing static
// getters. This is read-only static reference data (like findMapLocations /
// findAgents), NOT a gateway/bridge call. Each requested `{kind, id}` resolves
// to a name STRING, or null for a definitive "unknown" (an NPC/type not in the
// static tables) — the client caches null too so it never refetches, and shows
// the raw ID as its own fallback.

const NAMES_MAX_ITEMS = 500;

// The `owner` kind resolves an ownership/standing ID whose entity type is not
// known at the call site (a station owner, or a standings `fromID`, is a corp,
// faction, character, or alliance). It tries each in turn and returns the first
// that resolves, so one request covers all four.
function resolveOwnerName(id) {
  if (getCorporation(id)) {
    return getCorporationName(id);
  }
  if (getFaction(id)) {
    return getFactionName(id);
  }
  if (getCharacter(id)) {
    return getCharacterName(id);
  }
  if (getAlliance(id)) {
    return getAllianceName(id);
  }
  return null;
}

/**
 * Resolve one `{kind, id}` to a display name string, or null when the entity is
 * genuinely not in the static tables (a definitive "unknown" the caller caches
 * without refetching). The name getters that echo an ID fallback (getTypeName,
 * getStationName, ...) are guarded by their entry getter so an unknown returns
 * null rather than "Type 99999999".
 */
function resolveOneName(kind, id) {
  const numericID = Number(id) || 0;
  if (numericID <= 0) {
    return null;
  }
  switch (String(kind)) {
    case "type":
      return getType(numericID) ? getTypeName(numericID) : null;
    case "typeGroup":
      return getType(numericID) ? getTypeGroupName(numericID) : null;
    case "typeCategory":
      return getType(numericID) ? getTypeCategoryName(numericID) : null;
    case "category":
      return getCategory(numericID) ? getCategoryName(numericID) : null;
    case "corporation":
      return getCorporation(numericID) ? getCorporationName(numericID) : null;
    case "alliance":
      return getAlliance(numericID) ? getAllianceName(numericID) : null;
    case "faction":
      return getFaction(numericID) ? getFactionName(numericID) : null;
    case "character":
      return getCharacterName(numericID);
    case "agent":
      return getAgentName(numericID);
    case "station":
      return getStation(numericID) ? getStationName(numericID) : null;
    case "system":
      return getSolarSystem(numericID) ? getSolarSystemName(numericID) : null;
    case "region":
      return getRegion(numericID) ? getRegionName(numericID) : null;
    case "owner":
      return resolveOwnerName(numericID);
    default:
      return null;
  }
}

/**
 * Batch-resolve `{ items: [{kind, id}, ...] }` to `{ names: { "kind:id": name },
 * capped, limit }`. Every requested item is echoed into `names` (a resolved
 * string, or null for a definitive unknown) so the client can cache the outcome
 * for every key. Duplicate `(kind,id)` pairs resolve once. Capped at
 * NAMES_MAX_ITEMS so an oversized request never scans the whole item table.
 */
function resolveNames(input = {}) {
  const items = Array.isArray(input.items) ? input.items : [];
  const capped = items.length > NAMES_MAX_ITEMS;
  const slice = capped ? items.slice(0, NAMES_MAX_ITEMS) : items;
  const names = {};
  for (const item of slice) {
    const kind = item && item.kind !== undefined && item.kind !== null ? String(item.kind) : "";
    const id = Number(item && item.id) || 0;
    if (!kind || id <= 0) {
      continue;
    }
    const key = `${kind}:${id}`;
    if (Object.prototype.hasOwnProperty.call(names, key)) {
      continue;
    }
    names[key] = resolveOneName(kind, id);
  }
  return { names, capped, limit: NAMES_MAX_ITEMS };
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
  findAgents,
  findMapLocations,
  getAgentName,
  getAgentsByID,
  getAlliance,
  getAllianceName,
  getCategory,
  getCategoryName,
  getCharacter,
  getCharacterName,
  getCorporation,
  getCorporationName,
  getFaction,
  getFactionName,
  getIndustryBlueprint,
  resolveNames,
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
