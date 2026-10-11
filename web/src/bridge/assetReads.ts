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

import type { AssetStationRow } from "../store/types.ts";
import type { Ask } from "./ask.ts";
import { decodeAssetStations } from "./personalAssets.ts";
import type { JsonValue } from "./wire.ts";

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
