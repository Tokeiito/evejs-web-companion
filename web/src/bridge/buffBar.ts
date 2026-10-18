// The buff bar's working (eve/client/script/ui/inflight/shipHud/buffBarContainer.py and buffButtons.py): the warfare
// buffs on the pilot's ship (dbuff/client/incomingDbuffTracker.py, dbuff/client/uiFormatters.py) and the electronic
// warfare on it (tactical.jammersByJammingType from OnEwarStart and OnEwarEnd, godma.activeJams and shipUI's timers
// from OnJamStart and OnJamEnd); which of the bar's slots show and where, each slot's timer and its hint's rows. The
// slots themselves are dbuffs.ts.

import { BUFF_SLOTS, BUFF_SLOT_CREATED_ORDER, type BuffSlot } from "./dbuffs.ts";
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
  /** tactical.jammersByJammingType: by jamming type, each other ship's module working on the pilot's. */
  readonly jammers: ReadonlyMap<string, readonly EwarJammer[]>;
  /** godma.activeJams: each jam cycle landed, until its OnJamEnd or its time is up (StopJam). */
  readonly activeJams: readonly ActiveJamCycle[];
  /** shipUI's timers on the buttons (StartTimer): by jamming type, each jammer's latest cycle, until its OnEwarEnd. */
  readonly jamTimers: ReadonlyMap<string, readonly JamTimer[]>;
}

/** One other ship's module working on the pilot's (tactical's (sourceBallID, moduleID)). */
export interface EwarJammer {
  readonly sourceID: number;
  readonly moduleID: number;
}

/** One of godma's activeJams, on the browser's clock. */
export interface ActiveJamCycle {
  readonly sourceID: number;
  readonly moduleID: number;
  readonly targetID: number;
  readonly jammingType: string;
  readonly endMs: number;
}

/** One timer on a button (ModuleEffectTimer), its jammer (source, module, target) and its run, on the browser's clock. */
export interface JamTimer {
  readonly key: string;
  readonly startMs: number;
  readonly endMs: number;
}

/** The bar's state before anything is on the ship. */
export const NO_BUFFS: BuffBarState = Object.freeze({
  incoming: new Map(),
  clockOffsetMs: 0,
  facts: new Map(),
  iconFiles: new Map(),
  percentUnitName: "",
  jammers: new Map(),
  activeJams: [],
  jamTimers: new Map(),
});

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
 * BuffSlotParent._ShouldBeVisible, for the sources the page has: a module of another ship of the slot's jamming type
 * working on the pilot's (jammersByType), or one of the slot's collections on the ship.
 */
export function slotShows(slot: BuffSlot, state: BuffBarState): boolean {
  return (state.jammers.get(slot.slot)?.length ?? 0) > 0 || slotShowsBuffs(slot, state.incoming);
}

/**
 * The bar's children as BuffBarContainer keeps them: the system-wide effects' container first (idx 0), then a
 * BuffSlotParent a slot in the order CreateAllButtons made them; and which of the slots show.
 */
export interface BuffBarLayout {
  readonly children: readonly string[];
  readonly showing: ReadonlySet<string>;
}

/** The system-wide effects' container's place among the children (SystemWideEffectsContainer, idx=0). */
const SYSTEM_EFFECTS_CHILD = "";

export function newBuffBarLayout(): BuffBarLayout {
  return { children: [SYSTEM_EFFECTS_CHILD, ...BUFF_SLOT_CREATED_ORDER], showing: new Set() };
}

/**
 * RefreshAllButtonDisplay: each slot in btnParByEffectType's order, one that should show and does not comes up
 * (FadeButtonIn) and is moved to its order among the children (SetOrder: SetParent at the index where it does not
 * stand there already; -1 appends, childrenlist.insert): an offensive button to the number of its jammers less one, any
 * other to the end; one that should not show goes (FadeButtonOut) and keeps its place.
 */
export function relaidBuffBar(layout: BuffBarLayout, state: BuffBarState): BuffBarLayout {
  const children = [...layout.children];
  const showing = new Set(layout.showing);
  for (const slot of BUFF_SLOTS) {
    if (!slotShows(slot, state)) {
      showing.delete(slot.slot);
      continue;
    }
    if (showing.has(slot.slot)) continue;
    showing.add(slot.slot);
    const order = slot.kind === "offensive" ? (state.jammers.get(slot.slot)?.length ?? 0) - 1 : -1;
    const at = children.indexOf(slot.slot);
    if (at === order) continue;
    children.splice(at, 1);
    if (order === -1) children.push(slot.slot);
    else children.splice(order, 0, slot.slot);
  }
  return { children, showing };
}

/** The slots showing, left to right. */
export function shownBuffSlots(layout: BuffBarLayout): string[] {
  return layout.children.filter((child) => layout.showing.has(child));
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

// --- the electronic warfare --------------------------------------------------

/** OnEwarStart or OnEwarEnd (sourceBallID, moduleID, targetBallID, jammingType), as tactical takes it. */
export interface EwarNotice {
  readonly started: boolean;
  readonly sourceID: number;
  readonly moduleID: number;
  readonly targetID: number;
  readonly jammingType: string;
}

const idOf = (value: JsonValue | undefined): number | null => {
  const id = unwrapLong(value);
  return id === null || id <= 0n || id > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(id);
};

/** OnEwarStart and OnEwarEnd as tactical reads them; null for another notice, or one with no jamming type (LogError). */
export function decodeEwarNotice(method: string, args: readonly JsonValue[]): EwarNotice | null {
  if (method !== "OnEwarStart" && method !== "OnEwarEnd") return null;
  const [source, module, target, type] = args;
  const sourceID = idOf(source);
  const moduleID = idOf(module);
  const targetID = idOf(target);
  if (sourceID === null || moduleID === null || targetID === null || typeof type !== "string" || type === "") return null;
  return { started: method === "OnEwarStart", sourceID, moduleID, targetID, jammingType: type };
}

const jammerKey = (sourceID: number, moduleID: number, targetID: number): string => `${sourceID}:${moduleID}:${targetID}`;

/**
 * tactical.OnEwarStart: a module of another ship on the pilot's own (targetBallID == session.shipid) counted under its
 * jamming type, once (a set of (source, module)); OnEwarEnd: it is taken out whatever ship it was on, and its timer on
 * the button with it (OnEwarEndFromTactical: RemoveTimer(jammingType, (source, module, target))).
 */
export function ewarNoticed(state: BuffBarState, notice: EwarNotice, ownShipID: number | null): BuffBarState {
  const jammers = new Map(state.jammers);
  const of = jammers.get(notice.jammingType) ?? [];
  const same = (each: EwarJammer) => each.sourceID === notice.sourceID && each.moduleID === notice.moduleID;
  if (notice.started) {
    if (ownShipID === null || notice.targetID !== ownShipID || of.some(same)) return state;
    jammers.set(notice.jammingType, [...of, { sourceID: notice.sourceID, moduleID: notice.moduleID }]);
    return { ...state, jammers };
  }
  jammers.set(notice.jammingType, of.filter((each) => !same(each)));
  const key = jammerKey(notice.sourceID, notice.moduleID, notice.targetID);
  const jamTimers = new Map(state.jamTimers);
  jamTimers.set(notice.jammingType, (jamTimers.get(notice.jammingType) ?? []).filter((timer) => timer.key !== key));
  return { ...state, jammers, jamTimers };
}

/** One OnJamStart or OnJamEnd, as godma and shipUI take it (the page's decode, bridge/jamNotifications.ts). */
export interface JamNotice {
  readonly active: boolean;
  readonly sourceID: number;
  readonly moduleID: number;
  readonly targetID: number;
  readonly jammingType: string;
  readonly receivedAtMs: number;
  readonly durationMs: number;
}

/**
 * godma.OnJamStart: the cycle among the active jams until its OnJamEnd or its time is up (StopJam); shipUI.OnJamStart:
 * on the pilot's own ship, its jammer's timer on the button started anew for its duration (StartTimer: GetTimer moves
 * the jammer's timer last). OnJamEnd takes it out of the active jams and leaves the timer.
 */
export function jamNoticed(state: BuffBarState, notice: JamNotice, ownShipID: number | null): BuffBarState {
  const same = (each: ActiveJamCycle) => each.sourceID === notice.sourceID && each.moduleID === notice.moduleID &&
    each.targetID === notice.targetID && each.jammingType === notice.jammingType;
  const activeJams = state.activeJams.filter((each) => !same(each) && each.endMs > notice.receivedAtMs);
  if (!notice.active) return { ...state, activeJams };
  const endMs = notice.receivedAtMs + notice.durationMs;
  activeJams.push({ sourceID: notice.sourceID, moduleID: notice.moduleID, targetID: notice.targetID, jammingType: notice.jammingType, endMs });
  if (ownShipID === null || notice.targetID !== ownShipID) return { ...state, activeJams };
  const key = jammerKey(notice.sourceID, notice.moduleID, notice.targetID);
  const jamTimers = new Map(state.jamTimers);
  jamTimers.set(notice.jammingType, [
    ...(jamTimers.get(notice.jammingType) ?? []).filter((timer) => timer.key !== key && timer.endMs > notice.receivedAtMs),
    { key, startMs: notice.receivedAtMs, endMs },
  ]);
  return { ...state, activeJams, jamTimers };
}

/** tactical.ResetJammers, at another station, system or ship; and the bar made anew with its timers (shipUI). */
export function jammersReset(state: BuffBarState): BuffBarState {
  return { ...state, jammers: new Map(), jamTimers: new Map() };
}

/** tactical.RemoveBallFromJammers: what the balls that left space were doing is let go (`present` false for one that left). */
export function jammersWithout(state: BuffBarState, present: (ballID: number) => boolean): BuffBarState {
  let changed = false;
  const jammers = new Map<string, readonly EwarJammer[]>();
  for (const [type, list] of state.jammers) {
    const kept = list.filter((each) => present(each.sourceID));
    if (kept.length !== list.length) changed = true;
    jammers.set(type, kept);
  }
  return changed ? { ...state, jammers } : state;
}

/**
 * The newest running timer on a slot's button, on the browser's clock, or null: its jammers' (ModuleEffectTimer, the
 * last started drawn over the rest) while they run.
 */
export function slotJamTimer(slot: BuffSlot, state: BuffBarState, nowMs: number): JamTimer | null {
  const running = (state.jamTimers.get(slot.slot) ?? []).filter((timer) => timer.endMs > nowMs);
  return running.length === 0 ? null : running[running.length - 1]!;
}

/** One row of a hint (buffButtonsUtil.HintRow): its three columns, or a text across them. */
export interface HintRow {
  readonly col1: string;
  readonly col2: string;
  readonly col3: string;
  readonly fullRowText: string | null;
}

/** What the attackers' rows are written with: the client's words, and its ordering of them (localization Sort). */
export interface EwarHintWriter {
  /** UI/Inflight/NumAttacks. */
  numAttacks(num: number): string;
  /** UI/Inflight/EwarAttacker2 (a pilot in its ship), or UI/Inflight/EwarAttackerNPC2 (the ship alone). */
  attacker(characterID: number | null, shipTypeID: number): string;
  /** UI/Inflight/AndMorewarAttackers. */
  andMore(num: number): string;
  /** UI/Inflight/EwarHints/FailedEwarAttempts. */
  failedAttempts(): string;
  compare(a: string, b: string): number;
}

/** What the ballpark knows of a source (GetInvItem): its type and its pilot, or null for one not in space. */
export type EwarSourceOf = (sourceID: number) => { readonly typeID: number; readonly characterID: number | null } | null;

const MAX_ITEMS_IN_HINT = 6;

/** GetEffectSourcesAndCountByJammingType: each source and how many of its modules are on the ship, by type. */
function effectSources(state: BuffBarState, jammingType: string): Map<number, number> {
  const sources = new Map<number, number>();
  for (const jammer of state.jammers.get(jammingType) ?? []) sources.set(jammer.sourceID, (sources.get(jammer.sourceID) ?? 0) + 1);
  return sources;
}

/** _GetTextForTargetedBuffSource: "Nx" and the attacker, or null for a source not in space. */
function sourceRow(sourceID: number, num: number, sourceOf: EwarSourceOf, write: EwarHintWriter): HintRow | null {
  const item = sourceOf(sourceID);
  if (item === null) return null;
  return { col1: write.numAttacks(num), col2: write.attacker(item.characterID, item.typeID), col3: "", fullRowText: null };
}

/**
 * BuffHintProvider.GetNormalHintList: an ECM slot's attackers as _GetEcmHintItems has them (those with modules jamming
 * now, by name, then under Failed Attempts those whose modules did not, as many as six rows hold), any other slot's
 * as _GetBuffHintItems has them (the six with most modules on the ship, by name); and how many more there are.
 */
export function ewarHintRows(slot: BuffSlot, state: BuffBarState, sourceOf: EwarSourceOf, write: EwarHintWriter, nowMs: number): HintRow[] {
  const sources = effectSources(state, slot.slot);
  const more = (extra: number): HintRow[] => (extra > 0 ? [{ col1: "", col2: write.andMore(extra), col3: "", fullRowText: null }] : []);
  const byName = (rows: HintRow[]) => rows.sort((a, b) => write.compare(a.col2, b.col2));
  if (slot.slot === "electronic") {
    const activeBySource = new Map<number, number>();
    for (const jam of state.activeJams) {
      if (jam.jammingType !== slot.slot || jam.endMs <= nowMs) continue;
      activeBySource.set(jam.sourceID, (activeBySource.get(jam.sourceID) ?? 0) + 1);
    }
    const aggressors = [...sources].map(([sourceID, moduleCount]) => ({ sourceID, moduleCount, activeCount: activeBySource.get(sourceID) ?? 0 }))
      .sort((a, b) => b.activeCount - a.activeCount);
    const active: HintRow[] = [];
    const inactive: HintRow[] = [];
    for (const each of aggressors) {
      if (each.activeCount > 0) {
        const row = sourceRow(each.sourceID, each.activeCount, sourceOf, write);
        if (row !== null) active.push(row);
      }
      if (each.moduleCount > each.activeCount) {
        const row = sourceRow(each.sourceID, each.moduleCount - each.activeCount, sourceOf, write);
        if (row !== null) inactive.push(row);
      }
    }
    byName(active);
    byName(inactive);
    const rows = active.slice(0, MAX_ITEMS_IN_HINT);
    if (active.length < MAX_ITEMS_IN_HINT && inactive.length > 0) {
      rows.push({ col1: "", col2: "", col3: "", fullRowText: write.failedAttempts() });
      rows.push(...inactive.slice(0, MAX_ITEMS_IN_HINT - active.length));
    }
    return [...rows, ...more(active.length + inactive.length - MAX_ITEMS_IN_HINT)];
  }
  const rows: HintRow[] = [];
  let extra = 0;
  for (const [sourceID, num] of [...sources].sort((a, b) => b[1] - a[1])) {
    if (rows.length >= MAX_ITEMS_IN_HINT) {
      extra = sources.size - rows.length;
      break;
    }
    const row = sourceRow(sourceID, num, sourceOf, write);
    if (row !== null) rows.push(row);
  }
  return [...byName(rows), ...more(extra)];
}
