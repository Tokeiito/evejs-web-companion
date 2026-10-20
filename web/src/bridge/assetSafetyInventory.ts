// invControllers.AssetSafetyDeliveries1110-1134, treeData.TreeDataAssetSafety579-622,
// assetSafetySvc.GetWrapNames76-81 and invCache.AcceptPossibleRemovalTax754-777.
import type { Ask } from "./ask.ts";
import { decodeInventoryRowsChecked } from "./inventoryShip.ts";
import { readDictPairs, type JsonValue } from "./wire.ts";
import type { InventoryItemRow } from "../store/types.ts";

export interface SafetyDelivery {
  readonly row: InventoryItemRow;
  readonly name: string;
}

export interface SafetyDeliveries {
  readonly characterID: number;
  readonly locationID: number;
  readonly wraps: readonly SafetyDelivery[];
  readonly error: string | null;
}

/** Personal wraps delivered HERE. Corporate wraps have a separate division tree. */
export async function readSafetyDeliveries(ask: Ask, characterID: number, locationID: number, names: Map<number, string | null>): Promise<readonly SafetyDelivery[]> {
  const listed = await ask("invbroker", "List", [], { flag: 36 }, "hangar");
  const rows = decodeInventoryRowsChecked(listed);
  if (rows === null) throw new Error("Asset deliveries could not be read.");
  const personal = rows.filter(row => row.ownerID === characterID && row.locationID === locationID && row.flagID === 36);
  if (personal.some(row => row.typeID !== 60)) throw new Error("Asset deliveries contained an item that is not an Asset Safety wrap.");
  if (!personal.length) return [];
  if (personal.some(row => !names.has(row.itemID))) {
    for (const [id, name] of readDictPairs(await ask("structureAssetSafety", "GetWrapNames", [personal.map(row => row.itemID)]))) {
      if (typeof name === "string" || name === null) names.set(Number(id), name);
    }
  }
  return personal.map(row => {
    // AssetSafetySvc caches None too; AssetSafetyContainer.GetName returns ''.
    return { row, name: names.get(row.itemID) ?? "" };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** The native quote names complete stacks; quantity is chosen by the move afterward. */
export async function acceptSafetyRecovery(ask: Ask, wrapID: number, itemIDs: readonly number[], confirm: (tax: number) => Promise<boolean>): Promise<boolean> {
  if (!itemIDs.length) return true;
  const raw: JsonValue = await ask("invbroker", "GetPriceForItems", [itemIDs], null, wrapID);
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) throw new Error("Asset Safety did not provide a recovery price.");
  return raw === 0 || await confirm(raw);
}
