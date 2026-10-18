"use strict";

// What the client's info window shows of a faction (infosvc.UpdateDataFaction, infoContentBase's description and
// ConstructHeaderFaction), from the static data: its name and description (characterdata.factions
// get_faction_description), its headquarters system; its member races (get_faction_races, the four empires' where it
// names none) and its settled systems and stations (get_station_system_count, get_station_count: the NPC stations its
// corporations own); its corporations (get_corporation_ids_by_faction_id) in SortFunc's order; the regions,
// constellations and solar systems it holds (factionsvc.GetFactionLocations: the map's rows with its factionID); and
// the types it holds illegal (get_contraband_types_in_faction), by name, with what carrying each costs.

/** appConst raceCaldari, raceMinmatar, raceAmarr, raceGallente: UpdateDataFaction's races where a faction names none. */
const DEFAULT_RACES = Object.freeze([1, 2, 4, 8]);

const englishOf = (value) => (value && typeof value === "object" && typeof value.en === "string" ? value.en : typeof value === "string" ? value : "");
const positive = (value) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
};
// Python 2's comparison of two unicode strings, by code point (UTF-16 code units agree for the names here).
const byCodePoint = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function createFactionInfo(staticData) {
  const table = (fileName) => staticData.buildJsonlIndex(fileName);
  let byFaction = null;

  /** Each faction's corporations, stations and the systems those stand in, made once from the NPC tables. */
  function factionHoldings() {
    if (byFaction) return byFaction;
    byFaction = new Map();
    const holdings = (factionID) => {
      if (!byFaction.has(factionID)) byFaction.set(factionID, { corporations: [], stations: new Set(), systems: new Set() });
      return byFaction.get(factionID);
    };
    const factionOfCorporation = new Map();
    for (const [corporationID, row] of table("npcCorporations.jsonl")) {
      const factionID = positive(row && row.factionID);
      if (!factionID) continue;
      factionOfCorporation.set(corporationID, factionID);
      holdings(factionID).corporations.push(corporationID);
    }
    for (const [stationID, row] of table("npcStations.jsonl")) {
      const factionID = factionOfCorporation.get(positive(row && row.ownerID));
      if (!factionID) continue;
      holdings(factionID).stations.add(stationID);
      const systemID = positive(row.solarSystemID);
      if (systemID) holdings(factionID).systems.add(systemID);
    }
    return byFaction;
  }

  const regionName = (id) => englishOf(table("mapRegions.jsonl").get(id)?.name);
  const constellationName = (id) => englishOf(table("mapConstellations.jsonl").get(id)?.name);
  const systemName = (id) => englishOf(table("mapSolarSystems.jsonl").get(id)?.name);
  const owned = (fileName, factionID) =>
    [...table(fileName)].filter(([, row]) => positive(row && row.factionID) === factionID).map(([id, row]) => [id, row]);

  /** The faction by its id, or null for an id that is no faction. */
  function factionInfo(factionID) {
    const id = positive(factionID);
    const faction = id ? table("factions.jsonl").get(id) : null;
    if (!faction) return null;
    const holdings = factionHoldings().get(id) ?? { corporations: [], stations: new Set(), systems: new Set() };
    const races = table("races.jsonl");
    const memberRaces = Array.isArray(faction.memberRaces) && faction.memberRaces.length > 0 ? faction.memberRaces : DEFAULT_RACES;
    const hqSystemID = positive(faction.solarSystemID);

    // SortFunc: by name, a leading "The " left off.
    const sortName = (name) => (name.startsWith("The ") ? name.slice(4) : name);
    const corporations = holdings.corporations
      .map((corporationID) => ({ corporationID, name: englishOf(table("npcCorporations.jsonl").get(corporationID)?.name) }))
      .sort((left, right) => byCodePoint(sortName(left.name), sortName(right.name)));

    const regions = owned("mapRegions.jsonl", id).map(([regionID]) => ({ itemID: regionID, name: regionName(regionID) }));
    const constellations = owned("mapConstellations.jsonl", id).map(([constellationID, row]) => {
      const regionID = positive(row.regionID);
      return { itemID: constellationID, name: constellationName(constellationID), regionID, regionName: regionName(regionID) };
    });
    const systems = owned("mapSolarSystems.jsonl", id).map(([systemID, row]) => {
      const constellationID = positive(row.constellationID);
      const regionID = positive(row.regionID);
      return {
        itemID: systemID,
        name: systemName(systemID),
        constellationID,
        constellationName: constellationName(constellationID),
        regionID,
        regionName: regionName(regionID),
      };
    });

    // get_contraband_types_in_faction, sorted by the type's name (evetypes.GetName).
    const illegalTypes = [];
    for (const [typeID, row] of table("contrabandTypes.jsonl")) {
      const rule = (Array.isArray(row && row.factions) ? row.factions : []).find((each) => positive(each && each._key) === id);
      if (!rule) continue;
      illegalTypes.push({
        typeID,
        name: String(staticData.getTypeName(typeID) || ""),
        standingLoss: Number(rule.standingLoss) || 0,
        confiscateMinSec: Number(rule.confiscateMinSec),
        fineByValue: Number(rule.fineByValue) || 0,
        attackMinSec: Number(rule.attackMinSec),
      });
    }
    illegalTypes.sort((left, right) => byCodePoint(left.name, right.name));

    return {
      factionID: id,
      name: englishOf(faction.name),
      description: englishOf(faction.description) || null,
      headquarters: hqSystemID ? { itemID: hqSystemID, name: systemName(hqSystemID) } : null,
      memberRaces: memberRaces.map((raceID) => ({ raceID: positive(raceID), name: englishOf(races.get(positive(raceID))?.name) })),
      settledSystems: holdings.systems.size,
      stations: holdings.stations.size,
      corporations,
      regions,
      constellations,
      systems,
      illegalTypes,
      // iter_faction_ids: every faction by its number, as the client's table holds them (its Standings tab's
      // other factions).
      factions: [...table("factions.jsonl")]
        .map(([factionID, row]) => ({ factionID, name: englishOf(row && row.name) }))
        .sort((left, right) => left.factionID - right.factionID),
    };
  }

  return { factionInfo };
}

module.exports = { createFactionInfo };
