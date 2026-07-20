// Inventory & ship bound-object reads decoded to plain rows (goal R3, "how to
// add a page"). The retail two-step (bind then bound method) runs entirely on
// the BFF, which holds the bound-object handles server-side and returns the
// raw retail-shaped List / GetCapacity results here; this module decodes them.
//
// A List answers with a packed-row list, or (when empty and flag-scoped) a
// python set wrapping an empty list; GetCapacity answers a util.KeyVal
// {capacity, used}. See docs/retail-call-inventory.md Steps 5-6 and
// docs/bridge-wire-contract.md.

import {
  isKeyValValue,
  isListValue,
  readKeyVal,
  unwrapLong,
  type JsonValue,
} from "./wire.ts";
import type {
  CapacityInfo,
  InventoryContainerState,
  InventoryItemRow,
} from "../store/types.ts";

// Numeric fields may cross the wire as a plain number OR a retail long
// ({type:"long"} / BigInt→decimal string). Decode both so a long-encoded id or
// quantity never silently reads as 0 (a trap R4/R5 rows would otherwise inherit).
function toNumber(value: JsonValue | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const long = unwrapLong(value);
  return long === null ? 0 : Number(long);
}

function toNumberOrNull(value: JsonValue | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const long = unwrapLong(value);
  return long === null ? null : Number(long);
}

/**
 * Unwrap a python-set-wrapped list to the inner list. The empty/flag-scoped
 * List case answers with a __builtin__.set, whose real wire shape is
 * `{type:"objectex1", header:[{type:"token",value:"__builtin__.set"}, [innerList]]}`.
 * (An older `{type:"object", args:[list]}` shape is also tolerated.)
 */
function unwrapRowList(result: JsonValue): JsonValue {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    return result;
  }
  const obj = result as { type?: unknown; header?: unknown; args?: unknown };
  if (obj.type === "objectex1" && Array.isArray(obj.header)) {
    const header = obj.header as readonly JsonValue[];
    const token = header[0] as { value?: unknown } | undefined;
    if (token && token.value === "__builtin__.set" && Array.isArray(header[1])) {
      const inner = (header[1] as readonly JsonValue[])[0];
      return inner ?? { type: "list", items: [] };
    }
  }
  if (obj.type === "object" && Array.isArray(obj.args)) {
    const args = obj.args as readonly JsonValue[];
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

// --- R14 inventory depth ----------------------------------------------------

/**
 * The inventory groups whose items are containers you can open and put things
 * into. Container-ness is a purely CLIENT-side static-data question — the
 * protocol has no notion of it, and the bind for a container is byte-for-byte
 * the bind for a ship's cargo hold.
 *
 *   12   Cargo Container      (the standard/secure/giant station containers)
 *   340  Secure Cargo Container
 *   448  Audit Log Secure Container
 *   649  Freight Container
 */
const CONTAINER_GROUP_IDS = new Set([12, 340, 448, 649]);
const CATEGORY_CELESTIAL = 2;

/**
 * Is this row a container the player can open? It must be an assembled
 * (singleton) item of a container group. An UNASSEMBLED container is just
 * cargo — it stacks, and it holds nothing.
 */
export function isOpenableContainer(row: InventoryItemRow): boolean {
  if (!row.singleton) {
    return false;
  }
  if (row.groupID !== null && CONTAINER_GROUP_IDS.has(row.groupID)) {
    return true;
  }
  // Fall back to the category when a row carries no groupID: every container
  // group above sits in the Celestial category.
  return row.groupID === null && row.categoryID === CATEGORY_CELESTIAL;
}

/**
 * Can these two rows be merged into one stack? Only same-type, non-assembled
 * stacks — an assembled item is a single object, not a quantity.
 */
export function canMergeStacks(
  source: InventoryItemRow,
  destination: InventoryItemRow,
): boolean {
  return (
    source.itemID !== destination.itemID &&
    source.typeID === destination.typeID &&
    !source.singleton &&
    !destination.singleton
  );
}

/**
 * The label for a corporation hangar division. A corporation that never
 * renamed a division has no name for it, and the fallback is the plain
 * ordinal — NEVER the underlying flag number, which the browser never sees.
 */
export function divisionLabel(division: number, name: string | null): string {
  return name && name.trim() !== "" ? name : `Division ${division}`;
}
