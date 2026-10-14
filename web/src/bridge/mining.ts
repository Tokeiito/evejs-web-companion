// The R23 slice B decoders: the ship's mining holds, the survey scanner, and
// the refinery's quote.
//
// Decoder rule (docs/bridge-wire-contract.md): numeric IDs decode with
// unwrapLong — never the `typeof === "number" ? … : 0` pattern, which silently
// zeroes a {type:"long"} wrapper.
//
// The rule that matters most in this file is the difference between ZERO and
// UNKNOWN. A quantity of 0 is a real answer ("this rock is mined out", "this
// hold is empty"); an absent field is not an answer at all. Everything here
// keeps them apart, because collapsing them would put confident numbers on
// screen that nobody computed — a full belt shown as mined out, or a station's
// ISK tax shown as free.

import { unwrapLong, type JsonValue } from "./wire.ts";
import type {
  HoldCapacity,
  HoldItem,
  InventoryItemRow,
  MiningHold,
  ReprocessingQuote,
  SurveyResult,
} from "../store/types.ts";

function asObject(value: JsonValue | undefined): Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : {};
}

/** A positive game ID (long-aware), or null. */
function idOrNull(value: JsonValue | undefined): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  const long = unwrapLong(value);
  if (long === null) {
    return null;
  }
  const numeric = Number(long);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

/** A finite number, or null. Zero is a real answer and survives. */
function numberOrNull(value: JsonValue | undefined): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  const long = unwrapLong(value);
  const numeric = Number(long === null ? value : long);
  return Number.isFinite(numeric) ? numeric : null;
}

function stringOr(value: JsonValue | undefined, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function decodeHoldItems(value: JsonValue | undefined): readonly HoldItem[] | null {
  // null is "the read failed", which is NOT the same as an empty hold.
  if (!Array.isArray(value)) {
    return null;
  }
  const items: HoldItem[] = [];
  for (const entry of value as JsonValue[]) {
    const raw = asObject(entry);
    const itemID = idOrNull(raw.itemID);
    const typeID = idOrNull(raw.typeID);
    if (itemID === null || typeID === null) {
      continue;
    }
    items.push({
      itemID,
      typeID,
      // Absent decodes to null, not 0: a hold read from an older bridge that
      // does not publish these simply cannot classify, which is a different
      // thing from classifying as category zero.
      groupID: idOrNull(raw.groupID),
      categoryID: idOrNull(raw.categoryID),
      quantity: numberOrNull(raw.quantity) ?? 0,
    });
  }
  return items;
}

function decodeHoldCapacity(value: JsonValue | undefined): HoldCapacity | null {
  if (value === undefined || value === null) {
    return null;
  }
  const raw = asObject(value);
  const capacity = numberOrNull(raw.capacity);
  const used = numberOrNull(raw.used);
  return capacity === null && used === null ? null : { capacity, used };
}

/**
 * The ship's mining holds, by NAME. The retail flagIDs behind them (134 ore,
 * 135 gas, 181 ice, 182 asteroid, falling back to 5 cargo) live only on the BFF
 * and never appear here — the browser has no idea those numbers exist.
 */
export function decodeMiningHolds(raw: JsonValue | undefined): readonly MiningHold[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const holds: MiningHold[] = [];
  for (const entry of raw as JsonValue[]) {
    const value = asObject(entry);
    const key = stringOr(value.key, "");
    if (key.length === 0) {
      continue;
    }
    holds.push({
      key,
      label: stringOr(value.label, "Hold"),
      items: decodeHoldItems(value.items),
      capacity: decodeHoldCapacity(value.capacity),
      present: value.present === true,
      error: typeof value.error === "string" && value.error.length > 0 ? value.error : null,
    });
  }
  return holds;
}

/**
 * The survey scanner's results: `[[entityID, yieldTypeID, remainingQuantity]]`.
 *
 * A triple whose entityID does not decode is DROPPED rather than kept with a
 * zero — a scan row that cannot be tied back to a rock in the overview is not a
 * rock with no ore, it is a row we could not read.
 */
export function decodeSurveyResults(raw: JsonValue | undefined): readonly SurveyResult[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const results: SurveyResult[] = [];
  for (const entry of raw as JsonValue[]) {
    const triple = Array.isArray(entry) ? (entry as JsonValue[]) : null;
    if (triple === null) {
      continue;
    }
    const itemID = idOrNull(triple[0]);
    if (itemID === null) {
      continue;
    }
    const remaining = numberOrNull(triple[2]);
    results.push({
      itemID,
      yieldTypeID: idOrNull(triple[1]),
      // 0 survives here: a scanned rock really can be empty, and that is worth
      // showing. Only an unreadable value becomes null.
      remainingQuantity: remaining === null ? null : Math.max(0, Math.trunc(remaining)),
    });
  }
  return results;
}

/** What the refinery quoted, stack by stack. */
export function decodeReprocessingQuotes(
  raw: JsonValue | undefined,
): readonly ReprocessingQuote[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const quotes: ReprocessingQuote[] = [];
  for (const entry of raw as JsonValue[]) {
    const value = asObject(entry);
    const itemID = idOrNull(value.itemID);
    if (itemID === null) {
      continue;
    }
    const outputs: { typeID: number; quantity: number }[] = [];
    if (Array.isArray(value.outputs)) {
      for (const output of value.outputs as JsonValue[]) {
        const row = asObject(output);
        const typeID = idOrNull(row.typeID);
        const quantity = numberOrNull(row.quantity);
        if (typeID !== null && quantity !== null && quantity > 0) {
          outputs.push({ typeID, quantity: Math.trunc(quantity) });
        }
      }
    }
    quotes.push({
      itemID,
      typeID: idOrNull(value.typeID),
      quantityToProcess: numberOrNull(value.quantityToProcess),
      leftOvers: numberOrNull(value.leftOvers),
      iskCost: numberOrNull(value.iskCost),
      outputs,
    });
  }
  return quotes;
}

/**
 * The station's reprocessing tax RATE.
 *
 * null means the server did not give one, and the page must say "not known".
 * It must never be shown as 0: reprocessing DEBITS this from the wallet, and a
 * confident zero would tell the player the refinery is free.
 */
export function decodeTaxRate(raw: JsonValue | undefined): number | null {
  const numeric = numberOrNull(raw);
  return numeric === null || numeric < 0 ? null : numeric;
}

/** invconst.categoryAsteroid and invconst.groupHarvestableCloud. */
const CATEGORY_ASTEROID = 25;
const GROUP_HARVESTABLE_CLOUD = 711;

/**
 * The hangar's stacks the Mining window offers for refining: what the client's own rule calls refinable of what
 * is mined, which is ore and ice by their category and gas by its group (typematerials/data.py 104 to 117). One of
 * a kind is no stack, and a row whose kind is not known is left out: refining uses a stack up, and "cannot tell"
 * does not pass. Whether the plant will refine a stack is the plant's to say, in its quote.
 */
export function refinableHangarStacks(rows: readonly InventoryItemRow[]): readonly InventoryItemRow[] {
  return rows.filter((row) => !row.singleton && row.quantity > 0 &&
    (row.categoryID === CATEGORY_ASTEROID || row.groupID === GROUP_HARVESTABLE_CLOUD));
}

/**
 * Whether a quote says nothing of what was picked would be refined: it has a row, and every row of it has nought to
 * process (each stack too few for one batch). A row that does not say is not nought, and a quote of no rows is the
 * plant refusing every stack, which the window says in its own words.
 */
export function quoteRefinesNothing(quotes: readonly ReprocessingQuote[]): boolean {
  return quotes.length > 0 && quotes.every((quote) => quote.quantityToProcess === 0);
}

/**
 * A stack's amount as the client shows it (uix.GetItemQty, uix.py 254 to 263): nothing at all for a singleton (a
 * thing assembled, which the server keeps with a quantity below nought), and the stack's size otherwise.
 */
export function stackAmountText(quantity: number): string {
  return quantity < 0 ? "" : quantity.toLocaleString();
}

/** Of what is picked, the stacks that are in the ship's holds: the unloading is theirs, and no hangar's stack's. */
export function picksInHolds(selected: readonly number[], holds: readonly MiningHold[]): readonly number[] {
  const held = new Set(holds.flatMap((hold) => (hold.items ?? []).map((item) => item.itemID)));
  return selected.filter((itemID) => held.has(itemID));
}
