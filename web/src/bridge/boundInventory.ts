// R75 — the 8 RB-INV BOUND reads, decoded from real captured bytes
// (PLUMBING ONLY — no UI, no writes).
//
// These are the raw retail invbroker reads the client issues against the OID
// handle invbroker.MachoBindObject mints (the inventory-MANAGER moniker — the
// SAME handle TrashItems uses). GET /api/bridge/bound-inventory binds it once and
// issues all 8 off boundCall. The BFF holds the handle; the browser never sees the
// OID.
//
// ⚠ OWNERSHIP is SPLIT and was verified LIVE cross-account (Farmer 140000005 vs
// Test Two 140000002):
//   SAFE, session-scoped: ListDroneBay / ListFighterBay (void args → the session's
//     active-ship bay; a foreign shipID in args still returned Farmer's OWN drones),
//     GetAvailableTurretSlots (session ship, args ignored), GetItemDescriptor
//     (STATIC schema — no per-entity data), GetDamageForCrystals (explicit ownerID
//     guard drops foreign crystals → empty).
//   ARG-INJECTION LEAK (flagged in docs/arg-injection-leak-handoff.md, kept
//     pre-plumbed): GetItem / GetItems copy the found record's OWN owner/type/
//     location/quantity with no session check — LIVE, GetItem(Test Two's Capsule
//     itemID) returned typeID 648 / ownerID 140000002 / locationID 60000004.
//     GetContainerContents' ship/station/hangar branches ARE owner-scoped (live:
//     empty for a foreign ship/station), but its generic flagID-0-container /
//     mobile-depot branch reads listContainerItems(null, id) UNFILTERED — a static
//     leak for a foreign anchored/jettisoned container (none seeded to exercise).
// The leak is reachable via /api/bridge/call (which forwards args verbatim), NOT
// via /api/bridge/bound-inventory (this route issues session-scoped default args).
//
// ---------------------------------------------------------------------------
// WIRE SHAPES (captured LIVE 2026-07-22, Farmer 140000005, docked Perimeter 60000358):
//
//  GetContainerContents(containerID): a Rowset {type:"object",
//     name:"eve.common.script.sys.rowset.Rowset", args:dict[ header:{type:"list",
//     items:[11 col names]}, RowClass:{token util.Row}, lines:{type:"list",
//     items:[ [11 cells], … ]} ]}. Each line is a BARE ARRAY positioned against the
//     header. Farmer's docked ship → 18 fitted-module rows; his station → 5 rows.
//  GetItem(itemID): a single util.Row {type:"object", name:"util.Row",
//     args:dict[ header:[11 col names as a BARE ARRAY], line:[11 cells as a BARE
//     ARRAY] ]}. ⚠ header/line are BARE arrays here, NOT {type:"list"} wrappers.
//  GetItems([itemIDs]): {type:"list", items:[ util.Row, … ]} — each item the same
//     bare-array util.Row as GetItem. [] → an empty list.
//  ListDroneBay / ListFighterBay: {type:"list", items:[ PACKEDROW{fields:{itemID,
//     typeID, ownerID, locationID, flagID, quantity, groupID, categoryID,
//     customInfo, stacksize, singleton}}, … ]}. Farmer's drone bay → 7 rows (a stack
//     of 4 + assembled singletons, flagID 87); his fighter bay → EMPTY (frigate).
//  GetItemDescriptor(): a blue.DBRowDescriptor {type:"objectex1", header:[
//     {token "blue.DBRowDescriptor"}, [ [ [colName, typeCode], … ] ],
//     {type:"list", items:[ [virtualColName, {token}], … ]} ]} — a STATIC schema.
//  GetAvailableTurretSlots(): a BARE integer (0 for Farmer's docked frigate).
//  GetDamageForCrystals([itemIDs]): {type:"dict", entries:[[itemID, damageRatio],…]}.
//     [] → an empty dict.
//
// The 11 row fields are itemID / typeID / ownerID / locationID / flagID / quantity /
// groupID / categoryID / customInfo / stacksize / singleton. IDs (item/type/owner/
// location/flag/group/category) are kept as DATA (R7d — Number when a safe integer,
// else the EXACT decimal string; a large itemID like 9988400023309 is safe today but
// a long-wrapped one survives exact). quantity/stacksize are integer AMOUNTS (kept as
// data too — -1 is the assembled-singleton marker, never coerced to 0); singleton is
// a boolean. Carry LOCAL coercions; do NOT import from web/src/bridge/market*.ts
// (separate session).

import {
  readRowsetRows,
  readRowField,
  readDictPairs,
  isListValue,
  unwrapLong,
  type JsonValue,
} from "./wire.ts";

// --- local coercions (do NOT import from market*.ts — separate session) -----

function asObject(value: JsonValue | undefined): Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : {};
}

/**
 * An integer field kept as DATA (R7d): a Number when it is a safe integer, else
 * its EXACT decimal string (never truncated through Number). Handles item/type/
 * owner/location/flag/group/category ids AND the integer amounts (quantity /
 * stacksize — negatives like the -1 assembled marker survive). `null` when absent.
 * Zero survives (a real flag/category), distinct from absent.
 */
export function intData(value: JsonValue | undefined): number | string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const long = unwrapLong(value);
  if (long !== null) {
    return long <= BigInt(Number.MAX_SAFE_INTEGER) && long >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(long)
      : long.toString();
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return value;
  }
  return null;
}

function stringOrNull(value: JsonValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

// --- shared inventory row ---------------------------------------------------

/**
 * One inventory row, whichever of the three wire shapes it arrived in (Rowset
 * line / util.Row / packedrow). Every id stays DATA for a future UI to resolve;
 * nothing is forced into a label.
 */
export interface InvItemRow {
  readonly itemID: number | string | null;
  readonly typeID: number | string | null;
  readonly ownerID: number | string | null;
  readonly locationID: number | string | null;
  readonly flagID: number | string | null;
  readonly quantity: number | string | null;
  readonly groupID: number | string | null;
  readonly categoryID: number | string | null;
  readonly customInfo: string | null;
  readonly stacksize: number | string | null;
  readonly singleton: boolean;
}

/** Fold a `{column: rawCell}` record (any of the three shapes) into an InvItemRow. */
function decodeInvRecord(record: Record<string, JsonValue>): InvItemRow {
  const singletonRaw = record.singleton;
  return {
    itemID: intData(record.itemID),
    typeID: intData(record.typeID),
    ownerID: intData(record.ownerID),
    locationID: intData(record.locationID),
    flagID: intData(record.flagID),
    quantity: intData(record.quantity),
    groupID: intData(record.groupID),
    categoryID: intData(record.categoryID),
    customInfo: stringOrNull(record.customInfo),
    stacksize: intData(record.stacksize),
    singleton: singletonRaw === 1 || singletonRaw === true,
  };
}

/**
 * Read a util.Row (`{type:"object", name:"util.Row", args:dict[header, line]}`)
 * into a `{column: cell}` record. ⚠ header/line arrive as BARE ARRAYS from
 * invbroker (GetItem/GetItems), but a `{type:"list"}` wrapper is tolerated too so
 * the reader never silently drops a differently-built row. `null` when the value
 * is not a util.Row.
 */
function readUtilRow(row: JsonValue | undefined): Record<string, JsonValue> | null {
  const obj = asObject(row);
  if (obj.type !== "object" || obj.name !== "util.Row") {
    return null;
  }
  const args = asObject(obj.args);
  const entries = Array.isArray(args.entries) ? (args.entries as JsonValue[]) : [];
  const byKey = (key: string): JsonValue | undefined => {
    const entry = entries.find((e) => Array.isArray(e) && e[0] === key);
    return Array.isArray(entry) ? (entry[1] as JsonValue) : undefined;
  };
  const cellsOf = (value: JsonValue | undefined): JsonValue[] =>
    Array.isArray(value) ? value : isListValue(value) ? [...value.items] : [];
  const cols = cellsOf(byKey("header"));
  const line = cellsOf(byKey("line"));
  if (cols.length === 0) {
    return null;
  }
  const record: Record<string, JsonValue> = {};
  cols.forEach((col, index) => {
    const name = typeof col === "string" ? col : String(col);
    record[name] = (line[index] ?? null) as JsonValue;
  });
  return record;
}

// --- per-read decoders ------------------------------------------------------

/** GetContainerContents — a Rowset of util.Row lines → inventory rows. */
export function decodeContainerContents(result: JsonValue | undefined): readonly InvItemRow[] {
  return readRowsetRows(result).map((record) => decodeInvRecord(record));
}

/** GetItem — a single util.Row → one inventory row (`null` when malformed). */
export function decodeGetItem(result: JsonValue | undefined): InvItemRow | null {
  const record = readUtilRow(result);
  return record ? decodeInvRecord(record) : null;
}

/** GetItems — a list of util.Rows → inventory rows (`[]` for the empty list). */
export function decodeGetItems(result: JsonValue | undefined): readonly InvItemRow[] {
  if (!isListValue(result)) {
    return [];
  }
  const rows: InvItemRow[] = [];
  for (const item of result.items) {
    const record = readUtilRow(item);
    if (record) {
      rows.push(decodeInvRecord(record));
    }
  }
  return rows;
}

/**
 * ListDroneBay / ListFighterBay — a list of PACKEDROWS → inventory rows. `[]` is a
 * legitimate empty bay (an empty fighter bay on a hull that has none reads the same
 * as one genuinely empty — the row list alone cannot tell them apart, which is why
 * this is a plain decode and the "does the hull HAVE this bay" question is not asked
 * here). A row that carries no itemID is DROPPED, not kept as a zero.
 */
export function decodeBayList(result: JsonValue | undefined): readonly InvItemRow[] {
  if (!isListValue(result)) {
    return [];
  }
  const rows: InvItemRow[] = [];
  for (const item of result.items) {
    const record: Record<string, JsonValue> = {};
    for (const key of [
      "itemID",
      "typeID",
      "ownerID",
      "locationID",
      "flagID",
      "quantity",
      "groupID",
      "categoryID",
      "customInfo",
      "stacksize",
      "singleton",
    ]) {
      record[key] = (readRowField(item, key) ?? null) as JsonValue;
    }
    const row = decodeInvRecord(record);
    if (row.itemID === null) {
      continue;
    }
    rows.push(row);
  }
  return rows;
}

/** One column of the item descriptor's schema. */
export interface InvDescriptorColumn {
  readonly name: string;
  readonly typeCode: number | string | null;
}

export interface InvItemDescriptor {
  readonly columns: readonly InvDescriptorColumn[];
  readonly virtualColumns: readonly string[];
}

/**
 * GetItemDescriptor — a STATIC blue.DBRowDescriptor. `header[1][0]` is the list of
 * `[name, typeCode]` real columns; `header[2].items` is the `[name, token]` virtual
 * columns (stacksize / singleton). No per-entity data. `null` when malformed.
 */
export function decodeItemDescriptor(result: JsonValue | undefined): InvItemDescriptor | null {
  const obj = asObject(result);
  if (obj.type !== "objectex1" || !Array.isArray(obj.header)) {
    return null;
  }
  const header = obj.header as JsonValue[];
  // header[1] wraps the columns array in a single-element list: [ [ [name,code], … ] ].
  const columnsWrapper = header[1];
  const columnsList =
    Array.isArray(columnsWrapper) && Array.isArray(columnsWrapper[0])
      ? (columnsWrapper[0] as JsonValue[])
      : [];
  const columns: InvDescriptorColumn[] = [];
  for (const col of columnsList) {
    if (Array.isArray(col) && typeof col[0] === "string") {
      columns.push({ name: col[0], typeCode: intData(col[1] as JsonValue) });
    }
  }
  const virtualColumns: string[] = [];
  const virtualWrapper = header[2];
  if (isListValue(virtualWrapper)) {
    for (const vc of virtualWrapper.items) {
      if (Array.isArray(vc) && typeof vc[0] === "string") {
        virtualColumns.push(vc[0]);
      }
    }
  }
  return { columns, virtualColumns };
}

/** GetAvailableTurretSlots — a BARE integer. `null` when not a number. */
export function decodeTurretSlots(result: JsonValue | undefined): number | null {
  const long = unwrapLong(result);
  if (long !== null) {
    const numeric = Number(long);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return typeof result === "number" && Number.isFinite(result) ? result : null;
}

/** One crystal's accumulated damage ratio (0..1). */
export interface CrystalDamage {
  readonly itemID: number | string | null;
  readonly damageRatio: number | null;
}

/**
 * GetDamageForCrystals — a dict `[itemID → damageRatio]`. The ratio is a
 * measurement (a double 0..1), kept as a Number; the itemID stays data. `[]` for
 * the empty dict (no crystals, or all foreign — the handler drops non-owned ones).
 */
export function decodeCrystalDamage(result: JsonValue | undefined): readonly CrystalDamage[] {
  return readDictPairs(result).map(([key, value]) => {
    const ratio = unwrapLong(value);
    const numeric = ratio !== null ? Number(ratio) : typeof value === "number" ? value : null;
    return {
      itemID: intData(key as JsonValue),
      damageRatio: numeric !== null && Number.isFinite(numeric) ? numeric : null,
    };
  });
}

// --- whole-envelope fold ----------------------------------------------------

export type BoundReadOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string; readonly message: string | null };

export interface BoundInventory {
  readonly characterID: number | string | null;
  readonly containerContents: BoundReadOutcome<readonly InvItemRow[]>;
  readonly item: BoundReadOutcome<InvItemRow | null>;
  readonly items: BoundReadOutcome<readonly InvItemRow[]>;
  readonly droneBay: BoundReadOutcome<readonly InvItemRow[]>;
  readonly fighterBay: BoundReadOutcome<readonly InvItemRow[]>;
  readonly descriptor: BoundReadOutcome<InvItemDescriptor | null>;
  readonly turretSlots: BoundReadOutcome<number | null>;
  readonly crystalDamage: BoundReadOutcome<readonly CrystalDamage[]>;
}

function readOutcome<T>(
  reads: Record<string, JsonValue> | undefined,
  method: string,
  decode: (result: JsonValue | undefined) => T,
): BoundReadOutcome<T> {
  const entry = asObject(reads ? (reads[method] as JsonValue) : undefined);
  if ("error" in entry && typeof entry.error === "string") {
    return { ok: false, error: entry.error, message: typeof entry.message === "string" ? entry.message : null };
  }
  return { ok: true, value: decode(entry.result as JsonValue | undefined) };
}

/**
 * Fold the whole `GET /api/bridge/bound-inventory` envelope. Each read carries its
 * OWN success/error so an empty (but legitimate) drone bay or a refused read never
 * blanks the rest — a failed read is `{ok:false}`, never a thrown exception.
 */
export function decodeBoundInventory(envelope: JsonValue | undefined): BoundInventory {
  const root = asObject(envelope);
  const reads = asObject(root.reads);
  return {
    characterID: intData(root.characterID),
    containerContents: readOutcome(reads, "GetContainerContents", decodeContainerContents),
    item: readOutcome(reads, "GetItem", decodeGetItem),
    items: readOutcome(reads, "GetItems", decodeGetItems),
    droneBay: readOutcome(reads, "ListDroneBay", decodeBayList),
    fighterBay: readOutcome(reads, "ListFighterBay", decodeBayList),
    descriptor: readOutcome(reads, "GetItemDescriptor", decodeItemDescriptor),
    turretSlots: readOutcome(reads, "GetAvailableTurretSlots", decodeTurretSlots),
    crystalDamage: readOutcome(reads, "GetDamageForCrystals", decodeCrystalDamage),
  };
}
