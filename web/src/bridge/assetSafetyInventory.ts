// invControllers.AssetSafetyDeliveries1110-1134, treeData.TreeDataAssetSafety579-622,
// assetSafetySvc.GetWrapNames76-81 and invCache.AcceptPossibleRemovalTax754-777.
import type { Ask } from "./ask.ts";
import { decodeInventoryRowsChecked } from "./inventoryShip.ts";
import { readDictPairs, type JsonValue } from "./wire.ts";
import type { InventoryItemRow } from "../store/types.ts";
import { memberField } from "./corporationMemberDetails.ts";

export interface SafetyDelivery {
  readonly row: InventoryItemRow;
  readonly name: string;
}

export interface SafetyDeliveries {
  readonly characterID: number;
  readonly corporationID?: number | null;
  readonly corpRole?: string;
  readonly locationID: number;
  readonly wraps: readonly SafetyDelivery[];
  readonly error: string | null;
}

/** AssetSafetyDeliveries.IsItemHere: personal roots and own-corporation roots for Directors. */
export async function readSafetyDeliveries(ask: Ask, characterID: number, locationID: number, names: Map<number, string | null>, corporationID: number | null = null, corpRole = "0"): Promise<readonly SafetyDelivery[]> {
  const listed = await ask("invbroker", "List", [], { flag: 36 }, "hangar");
  const rows = decodeInventoryRowsChecked(listed);
  if (rows === null) throw new Error("Asset deliveries could not be read.");
  const director = /^\d+$/.test(corpRole) && (BigInt(corpRole) & 1n) !== 0n;
  const personal = rows.filter(row => (row.ownerID === characterID || director && row.ownerID === corporationID)
    && row.locationID === locationID && row.flagID === 36);
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

export const SAFETY_DIVISION_LABELS = [
  "UI/Corporations/Common/CorporateDivisionFirst", "UI/Corporations/Common/CorporateDivisionSecond",
  "UI/Corporations/Common/CorporateDivisionThird", "UI/Corporations/Common/CorporateDivisionFourth",
  "UI/Corporations/Common/CorporateDivisionFifth", "UI/Corporations/Common/CorporateDivisionSixth",
  "UI/Corporations/Common/CorporateDivisionSeventh", "UI/Inventory/GoalDeliveriesHangar",
  "UI/Inventory/CorpDeliveries", "UI/Corporations/DeliverItem/CapsuleerDeliveries",
] as const;

/** TreeDataCorpAssetSafety.GetChildren548-565: populated flags only, ordered by division ID. */
export function safetyDivisionRows(rows: readonly InventoryItemRow[], wrapID: number, corporationID: number,
  corporation: JsonValue, label: (key: string, fallback: string) => string) {
  const flags = new Map([[115, 0], [116, 1], [117, 2], [118, 3], [119, 4], [120, 5], [121, 6], [184, 14], [62, 62], [187, 187]]);
  const local = rows.filter(row => row.locationID === wrapID && row.ownerID === corporationID);
  if (local.some(row => !flags.has(row.flagID ?? -1))) throw new Error("An Asset Safety division could not be read.");
  return [...new Set(local.map(row => flags.get(row.flagID!)!))].sort((a, b) => a - b).map(divisionID => {
    let name: string | null;
    if (divisionID < 7) {
      const raw = memberField(corporation, `division${divisionID + 1}`);
      const text = raw && typeof raw === "object" && "type" in raw && raw.type === "wstring" && "value" in raw ? raw.value : raw;
      name = typeof text === "string" && text !== "" ? text : label(SAFETY_DIVISION_LABELS[divisionID]!, `Division ${divisionID + 1}`);
    } else if (divisionID === 14) name = label("UI/Inventory/GoalDeliveriesHangar", "Goal deliveries");
    else if (divisionID === 62) name = label("UI/Inventory/CorpDeliveries", "Corporation deliveries");
    // Native safety GetName raises KeyError(188). Reuse the original normal
    // CapsuleerDeliveries label for this branch instead of propagating that UI bug.
    else name = label("UI/Corporations/DeliverItem/CapsuleerDeliveries", "Capsuleer deliveries");
    return { divisionID, name, rows: local.filter(row => flags.get(row.flagID!) === divisionID) };
  });
}

/** Find the type-60 ancestor using rows already observed by this client. */
export function safetyWrapAncestor(locationID: number, cached: ReadonlyMap<number, InventoryItemRow>): number | null {
  // invCache.AcceptPossibleRemovalTax754-777 walks GetCachedItem, rather than
  // quoting the immediate container or fetching a separate safety catalogue.
  const visited = new Set<number>();
  let parent = cached.get(locationID);
  while (parent) {
    if (visited.has(parent.itemID)) throw new Error("The source container's location could not be read.");
    visited.add(parent.itemID);
    if (parent.typeID === 60) return parent.itemID;
    parent = parent.locationID === undefined ? undefined : cached.get(parent.locationID);
  }
  return null;
}

/** The native quote names complete stacks; quantity is chosen by the move afterward. */
export async function acceptSafetyRecovery(ask: Ask, wrapID: number, itemIDs: readonly number[], confirm: (tax: number) => Promise<boolean>): Promise<boolean> {
  if (!itemIDs.length) return true;
  const raw: JsonValue = await ask("invbroker", "GetPriceForItems", [itemIDs], null, wrapID);
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) throw new Error("Asset Safety did not provide a recovery price.");
  return raw === 0 || await confirm(raw);
}
