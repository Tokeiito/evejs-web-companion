"use strict";

// What the client's info window shows of a map place (infosvc.UpdateDataCelestial, infoContentBase's description and
// location trace), from the static data: a region, a constellation or a solar system by its id; its name, its own
// description (cfg's descriptionID: the regions have one), a system's security status; the places it lies in, the
// region first (GetLocationTrace); a region's constellations and a constellation's solar systems (TAB_CHILDREN); and
// the places of its own kind next to it by a stargate (map.GetNeighbors: TAB_NEIGHBORS).

/** inventorycommon/const.py typeRegion, typeConstellation, typeSolarSystem. */
const TYPE_REGION = 3;
const TYPE_CONSTELLATION = 4;
const TYPE_SOLAR_SYSTEM = 5;

function createMapLocationInfo(staticData) {
  let neighbours = null;

  /** Each system's, constellation's and region's neighbours by a stargate, made once from the stargates. */
  function neighbourSets() {
    if (neighbours) return neighbours;
    const bySystem = new Map();
    const byConstellation = new Map();
    const byRegion = new Map();
    const add = (map, from, to) => {
      if (!(from > 0) || !(to > 0) || from === to) return;
      if (!map.has(from)) map.set(from, new Set());
      map.get(from).add(to);
    };
    for (const gate of staticData.getStargates()) {
      const from = Number(gate && gate.solarSystemID) || 0;
      const to = Number(gate && gate.destinationSolarSystemID) || 0;
      if (from <= 0 || to <= 0) continue;
      add(bySystem, from, to);
      const fromSystem = staticData.getSolarSystem(from);
      const toSystem = staticData.getSolarSystem(to);
      if (!fromSystem || !toSystem) continue;
      add(byConstellation, Number(fromSystem.constellationID) || 0, Number(toSystem.constellationID) || 0);
      add(byRegion, Number(fromSystem.regionID) || 0, Number(toSystem.regionID) || 0);
    }
    neighbours = { bySystem, byConstellation, byRegion };
    return neighbours;
  }

  const security = (systemID) => {
    const system = staticData.getSolarSystem(systemID);
    const value = system ? Number(system.security) : NaN;
    return Number.isFinite(value) ? value : null;
  };
  const place = (typeID, itemID) => {
    const name = typeID === TYPE_REGION
      ? staticData.getRegionName(itemID)
      : typeID === TYPE_CONSTELLATION
        ? staticData.getConstellationName(itemID)
        : staticData.getSolarSystemName(itemID);
    return typeID === TYPE_SOLAR_SYSTEM
      ? { typeID, itemID, name, securityStatus: security(itemID) }
      : { typeID, itemID, name };
  };
  const places = (typeID, ids) => [...ids].map((id) => place(typeID, Number(id))).filter((each) => each.itemID > 0);

  /** The place by its id, or null for an id that is none of the three. */
  function mapLocationInfo(itemID) {
    const id = Number(itemID) || 0;
    if (id <= 0) return null;
    const region = staticData.getRegion(id);
    if (region) {
      const description = region.description && typeof region.description.en === "string" ? region.description.en : null;
      return {
        ...place(TYPE_REGION, id),
        description,
        parents: [],
        children: places(TYPE_CONSTELLATION, Array.isArray(region.constellationIDs) ? region.constellationIDs : []),
        neighbours: places(TYPE_REGION, neighbourSets().byRegion.get(id) ?? []),
      };
    }
    const constellation = staticData.getConstellation(id);
    if (constellation) {
      const regionID = Number(constellation.regionID) || 0;
      return {
        ...place(TYPE_CONSTELLATION, id),
        description: null,
        parents: regionID > 0 ? [place(TYPE_REGION, regionID)] : [],
        children: places(TYPE_SOLAR_SYSTEM, Array.isArray(constellation.solarSystemIDs) ? constellation.solarSystemIDs : []),
        neighbours: places(TYPE_CONSTELLATION, neighbourSets().byConstellation.get(id) ?? []),
      };
    }
    const system = staticData.getSolarSystem(id);
    if (system) {
      const regionID = Number(system.regionID) || 0;
      const constellationID = Number(system.constellationID) || 0;
      return {
        ...place(TYPE_SOLAR_SYSTEM, id),
        description: null,
        parents: [
          ...(regionID > 0 ? [place(TYPE_REGION, regionID)] : []),
          ...(constellationID > 0 ? [place(TYPE_CONSTELLATION, constellationID)] : []),
        ],
        children: [],
        neighbours: places(TYPE_SOLAR_SYSTEM, neighbourSets().bySystem.get(id) ?? []),
      };
    }
    return null;
  }

  return { mapLocationInfo };
}

module.exports = { createMapLocationInfo, TYPE_REGION, TYPE_CONSTELLATION, TYPE_SOLAR_SYSTEM };
