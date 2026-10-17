// Where a pilot's things are, read by whoever wants it (the plan's Phase 6b).
//
// Until 2026-10-11 the page asked one route of the BFF (GET /api/bridge/assets), which read the pilot's flight,
// made this one call, and said beside its answer whether the pilot owned nothing.
//
// THE CALL, as the client makes it (invCache.inv5MinCacheContainer.ListStations, 827 to 836):
//
//   self.moniker.ListStations()
//
// with nothing sent, on the pilot's own global container: Moniker('charMgr', (session.charid,
// const.containerGlobal)) (invCache.py 519). Recorded on Tranquility so, three times, twice riding the bind. The
// assets window asks it as it lists the stations (assetsWindow.py 441 and 923). It answers a rowset, a row for
// each station that holds something of the pilot's: the station, its system, its type and how many items.
//
// THE OBJECT IS THE PILOT'S OWN, and the page says nothing of which: the BFF binds it for the pilot it holds
// (bridgeCallPolicy.js, PAGE_OBJECT_CALLS, "assets"). The server lists the things of the session that asks.
//
// WHAT IS KEPT. The client keeps the answer five minutes (832). The page keeps nothing: it asks each time its
// window asks.
//
// "OWNS NOTHING" IS SAID OF A ROWSET READ AND EMPTY, AND OF NOTHING ELSE. An answer that is no rowset is the
// pilot's things unread; and rows the page can make nothing of are not nothing owned either. The read fails as
// the call fails, and says so where the answer is no rowset.
//
// THE ROUTE STILL STANDS (src/server.js). Nothing of the page's asks it now.
//
// What is at one station is the second read here, below.

import type { AssetStationRow } from "../store/types.ts";
import type { Ask } from "./ask.ts";
import { decodeAssetStations } from "./personalAssets.ts";
import { isListValue, type JsonValue } from "./wire.ts";

/** The stations that hold something of the pilot's, and whether the server listed none at all. */
export interface AssetStationsRead {
  readonly stations: readonly AssetStationRow[];
  /** True only where the rowset was read and had no rows. */
  readonly ownsNothing: boolean;
}

/** The rows of a rowset as the server answered it, or null where what it answered is no rowset. */
function rowsOf(answered: JsonValue | undefined): readonly JsonValue[] | null {
  const list = (answered as { list?: unknown } | null | undefined)?.list;
  return Array.isArray(list) ? (list as readonly JsonValue[]) : null;
}

/**
 * Where the pilot's things are, as the server lists them. Fails as the call fails; and where the server's answer
 * is no rowset, which is no list of stations at all.
 */
export async function readAssetStations(ask: Ask): Promise<AssetStationsRead> {
  const answered = await ask("charMgr", "ListStations", []);
  const rows = rowsOf(answered);
  if (rows === null) {
    throw new Error("Your assets could not be read (the server did not answer with its rowset).");
  }
  return { stations: decodeAssetStations(answered), ownsNothing: rows.length === 0 };
}

// --- What is at one station (the plan's Phase 6b) ------------------------------
//
// Until 2026-10-11 the page asked one route of the BFF (GET /api/bridge/assets/station), which made this one call
// and answered each type's volume from its static data beside the items.
//
// THE CALL, as the client makes it (invCache.inv5MinCacheContainer.ListStationItems, 840 to 853):
//
//   self.moniker.ListStationItems(stationID)
//
// on the same container, with the one station (or structure). No recording has one. The assets window asks it as
// a station is opened (assetsWindow.py 745). It answers a list of the pilot's own things there, a packed row
// each. The server lists the things of the session that asks, and the station only picks among them.
//
// WHAT IS KEPT. The client keeps each station's answer five minutes (846). The page keeps nothing of it.
//
// A STATION IS EMPTY WHERE THE LIST WAS READ AND HAS NO ROWS, AND ONLY THERE. An answer that is no list is the
// station unread.
//
// WHAT EACH THING MEASURES is not the server's to say: a client has a type's volume in its own static data, and
// the page asks the BFF's (GET /api/types/volumes). The rows are handed on as they came, to be read with the
// volumes beside them (personalAssets.ts, decodeAssetItems).
//
// THE ROUTE STILL STANDS (src/server.js). Nothing of the page's asks it now.

/** What the server listed at one station, as it came, and whether it listed nothing at all. */
export interface AssetStationItemsRead {
  /** charMgr.ListStationItems' list, untouched. */
  readonly listed: JsonValue;
  /** True only where the list was read and had no rows. */
  readonly hasNoItems: boolean;
}

/**
 * What of the pilot's is at one station, as the server lists it. Nothing is asked for what is no station. Fails
 * as the call fails; and where the server's answer is no list, which is no list of things at all.
 */
// --- Everything of the pilot's, containers' contents too (the assets window's search) -------------------------
//
// THE CALL, as the client makes it (invCache.inv5MinCacheContainer.ListIncludingContainers, 878 to 889):
//
//   self.moniker.ListIncludingContainers()
//
// with nothing sent, on the same container. No recording has one. The assets window's search asks it at each search
// (assetsWindow.py 415). It answers a list of a packed row for each of the pilot's things anywhere, those in
// containers too. The client keeps it five minutes (_DeleteCachedItemsAll); so does the flow.

/** Everything of the pilot's, as the server lists it, untouched. Fails as the call fails, and where it is no list. */
export async function readAllAssets(ask: Ask): Promise<JsonValue> {
  const answered = await ask("charMgr", "ListIncludingContainers", []);
  if (!isListValue(answered)) {
    throw new Error("Your things could not be read (the server did not answer with a list).");
  }
  return answered;
}

export async function readAssetStationItems(ask: Ask, stationID: number): Promise<AssetStationItemsRead> {
  if (!Number.isSafeInteger(stationID) || stationID <= 0) {
    throw new Error("No location was named.");
  }
  const answered = await ask("charMgr", "ListStationItems", [stationID]);
  if (!isListValue(answered)) {
    throw new Error("What is stored there could not be read (the server did not answer with a list).");
  }
  return { listed: answered, hasNoItems: answered.items.length === 0 };
}
