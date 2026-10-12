import type { ActiveBookmarks } from "../bridge/bookmarks.ts";
import type { MiningOperationTarget } from "./scriptConditions.ts";

/** Existing personal bookmarks are the travel authority after a scanner site
 * disappears. Read back the coordinate bookmark; a successful write is not proof.
 * (On the game port the reading back is of what the transport keeps: the bookmark it
 * made of the park's own answer to the bookmarking, as the client makes one. Its
 * place, its system and its item are the server's word; its note is what was sent.)
 * Auto-expiry bounds orphaned bookmarks after a crash (no new persistence owner). */
export async function ensureSiteLogisticsBookmark(target: MiningOperationTarget, operationID: string, shipID: number, deps: {
  read(): Promise<ActiveBookmarks>;
  create(shipID: number, folderID: number, name: string, note: string): Promise<void>;
}): Promise<number> {
  const note = `MCC logistics ${operationID} ${target.targetKey}`;
  const matches = (all: ActiveBookmarks) => all.bookmarks.find(row => row.note === note && row.locationID === target.systemID && row.itemID === null &&
    row.x !== null && row.y !== null && row.z !== null && !!target.position &&
    Math.hypot(row.x - target.position.x, row.y - target.position.y, row.z - target.position.z) < 150_000);
  const before = await deps.read();
  const previous = matches(before);
  if (previous) return previous.bookmarkID;
  const folder = before.folders.find(row => row.isPersonal && row.isActive);
  if (!folder) throw new Error("SITE_LOGISTICS_BOOKMARK_UNAVAILABLE: no active personal bookmark folder.");
  await deps.create(shipID, folder.folderID, `MCC tail ${target.targetName}`, note);
  const verified = matches(await deps.read());
  if (!verified) throw new Error("SITE_LOGISTICS_BOOKMARK_UNCONFIRMED: remaining on site; no unverified return destination.");
  return verified.bookmarkID;
}
