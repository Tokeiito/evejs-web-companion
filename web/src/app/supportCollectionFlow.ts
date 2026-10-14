import * as api from "./api.ts";
import type { Ask } from "../bridge/ask.ts";
import { compressItemInSpace } from "../bridge/compressionWrites.ts";
import type { JsonValue } from "../bridge/wire.ts";
import type { SupportCollectionAction, SupportCollectionReceipt } from "../nav/miningSupportCollection.ts";

/** Dispatch only; the owner must verify fresh inventories before settlement. */
export async function dispatchSupportCollectionAction(action: SupportCollectionAction, runID: string,
  scope: { readonly shipID: number; readonly solarSystemID: number }, options: api.ApiOptions, act: Ask): Promise<SupportCollectionReceipt> {
  if (action.kind === "transfer") {
    const result = await api.transferItems([action.itemID], { kind: "container", itemID: action.containerID },
      action.bay === "cargo" ? { kind: "cargo" } : { kind: "shipBay", bay: action.bay }, action.quantity, options,
      { claimRunID: runID, expectedScope: scope });
    // Claimed transfer verification accounts for splits/merges/reminted IDs.
    // The source ID need not survive in `moved`; exact local deltas follow.
    const acknowledged = result.applied && !result.declined.length && !result.notFound.length;
    return { acknowledged, ...(!acknowledged ? { reason: "collection-transfer-not-applied" } : {}) };
  }
  // The page's own call (bridge/compressionWrites.ts), held to the ship and the system the action was decided in:
  // the pilot's flight is read first, as the route read it before the call until 2026-10-14.
  const flight = (await api.getFlightStatus(options)).flight;
  const now = flight !== null && typeof flight === "object" && !Array.isArray(flight) ? flight as Record<string, JsonValue> : null;
  if (now === null || now.inSpace !== true || Number(now.shipID) !== scope.shipID || Number(now.solarSystemID) !== scope.solarSystemID) {
    throw new Error("Ship or system authority changed; reread before moving inventory.");
  }
  const result = await compressItemInSpace(act, action.itemID, action.facilityID);
  const compressed = result !== null && result !== undefined;
  return { acknowledged: compressed, compressionTuple: compressed ? result : null,
    ...(!compressed ? { reason: "collected-ore-compression-refused" } : {}) };
}
