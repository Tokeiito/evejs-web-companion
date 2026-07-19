// Inventory & ship bound-object reads decoded to plain rows (goal R3, "how to
// add a page"). The retail two-step (bind then bound method) runs entirely on
// the BFF, which holds the bound-object handles server-side and returns the
// raw retail-shaped List / GetCapacity results here; this module decodes them.
//
// A List answers with a packed-row list, or (when empty and flag-scoped) a
// python set wrapping an empty list; GetCapacity answers a util.KeyVal
// {capacity, used}. See docs/retail-call-inventory.md Steps 5-6 and
// docs/bridge-wire-contract.md.

import { isKeyValValue, isListValue, readKeyVal, type JsonValue } from "./wire.ts";
import type {
  CapacityInfo,
  InventoryContainerState,
  InventoryItemRow,
} from "../store/types.ts";

function toNumber(value: JsonValue | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toNumberOrNull(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Unwrap a python-set-wrapped list ({type:"object", args:[list]}) to the list. */
function unwrapRowList(result: JsonValue): JsonValue {
  if (
    typeof result === "object" &&
    result !== null &&
    !Array.isArray(result) &&
    (result as { type?: unknown }).type === "object" &&
    Array.isArray((result as { args?: unknown }).args)
  ) {
    const args = (result as { args: readonly JsonValue[] }).args;
    return args.length > 0 ? args[0]! : { type: "list", items: [] };
  }
  return result;
}

function decodeRowFields(fields: Record<string, JsonValue>): InventoryItemRow {
  const quantity = toNumber(fields.quantity);
  const stacksize = toNumber(fields.stacksize);
  return {
    itemID: toNumber(fields.itemID),
    typeID: toNumber(fields.typeID),
    groupID: toNumberOrNull(fields.groupID),
    categoryID: toNumberOrNull(fields.categoryID),
    flagID: toNumberOrNull(fields.flagID),
    quantity: quantity || stacksize,
    singleton: toNumber(fields.singleton) === 1,
  };
}

/** Decode an invbroker List result into plain rows; malformed rows are dropped. */
export function decodeInventoryRows(result: JsonValue): InventoryItemRow[] {
  const listValue = unwrapRowList(result);
  if (!isListValue(listValue)) {
    return [];
  }
  const rows: InventoryItemRow[] = [];
  for (const item of listValue.items) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      continue;
    }
    const candidate = item as { type?: unknown; fields?: unknown };
    const fields =
      candidate.type === "packedrow" &&
      typeof candidate.fields === "object" &&
      candidate.fields !== null
        ? (candidate.fields as Record<string, JsonValue>)
        : (item as Record<string, JsonValue>);
    const row = decodeRowFields(fields);
    if (row.itemID > 0) {
      rows.push(row);
    }
  }
  return rows;
}

/** Decode invbroker.GetCapacity (util.KeyVal {capacity, used}); null if malformed. */
export function decodeCapacity(result: JsonValue): CapacityInfo | null {
  if (!isKeyValValue(result)) {
    return null;
  }
  const capacity = readKeyVal(result, "capacity");
  const used = readKeyVal(result, "used");
  if (capacity === undefined && used === undefined) {
    return null;
  }
  return { capacity: toNumber(capacity), used: toNumber(used) };
}

/** Decode one container's (hangar/cargo) raw reads into store state. */
export function decodeContainer(
  list: JsonValue,
  capacity: JsonValue,
  error: string | null,
): InventoryContainerState {
  return {
    rows: list === null || list === undefined ? [] : decodeInventoryRows(list),
    capacity: capacity === null || capacity === undefined ? null : decodeCapacity(capacity),
    error,
  };
}

/** A hangar row is a boardable ship when it is a ship (category 6) and not active. */
export function isBoardableShip(
  row: InventoryItemRow,
  activeShipID: number | null,
): boolean {
  return row.categoryID === 6 && row.itemID !== activeShipID;
}
