// The buff bar's working for the warfare buffs (eve/client/script/ui/inflight/shipHud/buffBarContainer.py and
// buffButtons.py; dbuff/client/incomingDbuffTracker.py, dbuff/client/uiFormatters.py): what the server said is on
// the pilot's ship, which of the bar's slots show and in what order, each slot's timer and its hint's rows. The slots
// themselves are dbuffs.ts.

import { BUFF_SLOTS, type BuffSlot } from "./dbuffs.ts";
import { unwrapLong, type JsonValue } from "./wire.ts";

/** One dbuff collection on the ship: its value, and when it ends on the server's clock (ms), or null where it has no end. */
export interface IncomingDbuff {
  readonly value: number;
  readonly expiresMs: number | null;
}

/** IncomingDbuffTracker.incomingDbuffs: the collections on the pilot's ship, by collectionID. */
export type IncomingDbuffs = ReadonlyMap<number, IncomingDbuff>;

/** What the bar needs of a dbuff collection (dbuff/storage.py GetDbuffCollection, GetDisplayNameID). */
export interface DbuffCollectionFacts {
  /** Its displayName's text, or null where it has none (and the hint leaves it out). */
  readonly name: string | null;
  readonly operationName: string;
  readonly showOutputValueInUI: string;
}

/** What the HUD's buff bar shows the warfare buffs with. */
export interface BuffBarState {
  readonly incoming: IncomingDbuffs;
  /** The server's clock less the browser's when the buffs were last heard of. */
  readonly clockOffsetMs: number;
  /** The collections read so far, null for one the client's data has not. */
  readonly facts: ReadonlyMap<number, DbuffCollectionFacts | null>;
  /** The slots' icons' res: paths, by iconID (null for one the client's data has not). */
  readonly iconFiles: ReadonlyMap<number, string | null>;
  /** The relative-percent unit's name. */
  readonly percentUnitName: string;
}

const FILETIME_UNIX_EPOCH_MS = 11_644_473_600_000;
/** dogma/const.py unitModifierRelativePercent: the unit of a PostPercent collection's value (GetDisplayNameAndValue). */
export const UNIT_MODIFIER_RELATIVE_PERCENT = 124;

const itemsOf = (value: JsonValue | undefined): readonly JsonValue[] | null => {
  if (Array.isArray(value)) return value;
  if (value !== null && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)) {
    return (value as { items: JsonValue[] }).items;
  }
  return null;
};
const realOf = (value: JsonValue | undefined): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value !== null && typeof value === "object" && !Array.isArray(value) && (value as { type?: unknown }).type === "real") {
    const real = Number((value as { value?: unknown }).value);
    return Number.isFinite(real) ? real : null;
  }
  const long = unwrapLong(value);
  return long === null ? null : Number(long);
};

/**
 * OnDbuffUpdated(shipID, dbuffState) as IncomingDbuffTracker.OnDbuffUpdated takes it: for the ship the session is in
 * alone (null where it is another's), the state's list of (collectionID, (value, expiryTime)) made a map, and a state
 * of nothing (None, or an empty list) the tracker reset to nothing. An expiry is a FILETIME, or None for no end.
 */
export function decodeDbuffUpdate(args: readonly JsonValue[], sessionShipID: number | null): IncomingDbuffs | null {
  const shipID = unwrapLong(args[0]);
  if (shipID === null || (sessionShipID !== null && Number(shipID) !== sessionShipID)) return null;
  const incoming = new Map<number, IncomingDbuff>();
  for (const entry of itemsOf(args[1]) ?? []) {
    const [collection, state] = itemsOf(entry) ?? [];
    const collectionID = unwrapLong(collection);
    const [rawValue, rawExpiry] = itemsOf(state) ?? [];
    const value = realOf(rawValue);
    if (collectionID === null || value === null) continue;
    const expiry = rawExpiry === null || rawExpiry === undefined ? null : unwrapLong(rawExpiry);
    incoming.set(Number(collectionID), { value, expiresMs: expiry === null ? null : Number(expiry) / 10_000 - FILETIME_UNIX_EPOCH_MS });
  }
  return incoming;
}

/** BuffSlotParent._ShouldBeVisible, for the warfare buffs: one of the slot's collections is on the ship. */
export function slotShowsBuffs(slot: BuffSlot, incoming: IncomingDbuffs): boolean {
  return slot.dbuffIDs.some((dbuffID) => incoming.has(dbuffID));
}

/**
 * The slots showing, in the bar's order (RefreshAllButtonDisplay): each slot in turn, one that should show and does
 * not is put last (FadeButtonIn: SetOrder(-1), a defensive one's and an offensive one's with no jammer counted; SetParent
 * with -1 appends, childrenlist.insert), one that should not is taken out (FadeButtonOut). So the bar keeps them in the
 * order they last came up, those coming up together in btnParByEffectType's order.
 */
export function shownBuffSlots(previous: readonly string[], incoming: IncomingDbuffs): string[] {
  const showing = new Set(BUFF_SLOTS.filter((slot) => slotShowsBuffs(slot, incoming)).map((slot) => slot.slot));
  const shown = previous.filter((slot) => showing.has(slot));
  for (const slot of BUFF_SLOTS) {
    if (showing.has(slot.slot) && !shown.includes(slot.slot)) shown.push(slot.slot);
  }
  return shown;
}

export function buffSlotOf(name: string): BuffSlot | null {
  return BUFF_SLOTS.find((slot) => slot.slot === name) ?? null;
}

/**
 * BuffSlotParent.UpdateDbuffTimer: the latest end of the slot's collections on the ship, and no timer where one of them
 * has no end or none is on it.
 */
export function slotBuffEndMs(slot: BuffSlot, incoming: IncomingDbuffs): number | null {
  const ends: (number | null)[] = [];
  for (const [dbuffID, state] of incoming) {
    if (slot.dbuffIDs.includes(dbuffID)) ends.push(state.expiresMs);
  }
  if (ends.length === 0 || ends.includes(null)) return null;
  return Math.max(...(ends as number[]));
}

/** One row of a slot's hint (HintRow: col1 the value, col2 the collection's name, col3 the time left or nothing). */
export interface BuffHintRow {
  readonly value: string | null;
  readonly name: string;
  readonly timeLeft: string;
}

/** What the hint writes with: dogma's FormatValue and FormatUnit in UI/InfoWindow/ValueAndUnit, and an interval. */
export interface BuffHintWriter {
  valueAndUnit(value: number, unitID: number | null): string;
  /** FormatTimeIntervalShortWritten(ticks). */
  interval(ticks: bigint): string;
}

/**
 * BuffHintProvider.GetDbuffHintItemList: each of the slot's collections on the ship, in the slot's order, as
 * GetDisplayNameAndValue writes it: its name, or none and the row left out; its value, inverted where the collection
 * shows it so, in the relative-percent unit for a PostPercent one and with none otherwise, or no value where it hides
 * it; and the time left to its end, or nothing where it has none. A collection the page has not read yet is left out.
 */
export function buffHintRows(
  slot: BuffSlot,
  incoming: IncomingDbuffs,
  facts: ReadonlyMap<number, DbuffCollectionFacts | null>,
  write: BuffHintWriter,
  serverNowMs: number,
): BuffHintRow[] {
  const rows: BuffHintRow[] = [];
  for (const dbuffID of slot.dbuffIDs) {
    const state = incoming.get(dbuffID);
    const collection = facts.get(dbuffID) ?? null;
    if (state === undefined || collection === null || collection.name === null) continue;
    const unitID = collection.operationName === "PostPercent" ? UNIT_MODIFIER_RELATIVE_PERCENT : null;
    const value = collection.showOutputValueInUI === "ShowInverted" ? -state.value : state.value;
    const shown = collection.showOutputValueInUI === "Hide" ? null : write.valueAndUnit(value, unitID);
    const timeLeft = state.expiresMs === null
      ? ""
      : write.interval(BigInt(Math.max(0, Math.round(state.expiresMs - serverNowMs))) * 10_000n);
    rows.push({ value: shown, name: collection.name, timeLeft });
  }
  return rows;
}
