"use strict";

const eveGatewayClient = require("./eveGatewayClient");
const staticData = require("./staticData");

const JITA_REGION_ID = 10000002;
const JITA_SOLAR_SYSTEM_ID = 30000142;
const JITA_4_4_STATION_ID = 60003760;

async function getMarketOverview(regionID) {
  const requestedRegionID = Number(regionID || 0) || null;
  const numericRegionID = JITA_REGION_ID;
  const marketLocation = {
    regionID: JITA_REGION_ID,
    regionName: "The Forge",
    solarSystemID: JITA_SOLAR_SYSTEM_ID,
    solarSystemName: "Jita",
    stationID: JITA_4_4_STATION_ID,
    stationName: staticData.getStationName(JITA_4_4_STATION_ID),
    stationShortName: staticData.getStationShortName(JITA_4_4_STATION_ID),
  };
  const status = {
    source: "evejs-web-gateway",
    online: false,
    error: null,
  };

  let rows = [];
  try {
    rows = await eveGatewayClient.getStationAsks(JITA_4_4_STATION_ID);
    status.online = true;
  } catch (error) {
    status.error = error.message;
    return {
      status,
      regionID: numericRegionID || null,
      requestedRegionID,
      marketLocation,
      rows: [],
      summary: {
        totalRows: 0,
        shownRows: 0,
        categoryCount: 0,
      },
    };
  }

  const normalizedRows = (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const typeID = Number(row.type_id || row.typeID || 0);
      const type = staticData.getType(typeID) || {};
      const bestAskStationID = Number(row.best_ask_station_id || row.bestAskStationID || 0) || null;
      const bestBidStationID = Number(row.best_bid_station_id || row.bestBidStationID || 0) || null;
      const marketGroupID = Number(type.marketGroupID || 0) || null;
      const marketGroupPath = marketGroupID ? staticData.getMarketGroupPath(marketGroupID) : [];
      return {
        typeID,
        typeName: staticData.getTypeName(typeID),
        iconUrl: staticData.getTypeIconUrl(typeID, 64, "icon"),
        categoryID: Number(type.categoryID || 0) || null,
        categoryName: staticData.getCategoryName(type.categoryID),
        groupID: Number(type.groupID || 0) || null,
        groupName: String(type.groupName || "Unknown"),
        marketGroupID,
        marketGroupName:
          marketGroupPath.length > 0
            ? marketGroupPath[marketGroupPath.length - 1].name
            : null,
        marketGroupPath,
        bestAskPrice: Number(row.best_ask_price || row.bestAskPrice || 0),
        bestBidPrice: Number(row.best_bid_price || row.bestBidPrice || 0),
        bestAskStationID,
        bestAskStationName: bestAskStationID ? staticData.getStationName(bestAskStationID) : null,
        bestAskStationShortName: bestAskStationID ? staticData.getStationShortName(bestAskStationID) : null,
        bestBidStationID,
        bestBidStationName: bestBidStationID ? staticData.getStationName(bestBidStationID) : null,
        bestBidStationShortName: bestBidStationID ? staticData.getStationShortName(bestBidStationID) : null,
        totalAskQuantity: Number(row.total_ask_quantity || row.totalAskQuantity || 0),
        totalBidQuantity: Number(row.total_bid_quantity || row.totalBidQuantity || 0),
      };
    })
    .filter((row) => row.typeID > 0)
    .sort((left, right) => {
      const categoryCompare = left.categoryName.localeCompare(right.categoryName);
      const groupCompare = left.groupName.localeCompare(right.groupName);
      return categoryCompare || groupCompare || left.typeName.localeCompare(right.typeName);
    });
  const categoriesByName = new Map();
  for (const row of normalizedRows) {
    const key = row.categoryName || "Unknown";
    const category = categoriesByName.get(key) || {
      categoryID: row.categoryID,
      categoryName: key,
      rowCount: 0,
    };
    category.rowCount += 1;
    categoriesByName.set(key, category);
  }
  const categories = [...categoriesByName.values()]
    .sort((left, right) => left.categoryName.localeCompare(right.categoryName));

  return {
    status,
    regionID: numericRegionID,
    requestedRegionID,
    marketLocation,
    rows: normalizedRows,
    categories,
    summary: {
      totalRows: normalizedRows.length,
      shownRows: normalizedRows.length,
      categoryCount: categories.length,
    },
  };
}

module.exports = {
  getMarketOverview,
};
