// The safety level and the combat timers, as the page says them.
//
// The retail client's crimewatch service holds five timers, each a state and a time it ends
// (crimewatchSvc.py: weapons, PvP, NPC, criminal, disapproval), and the ship's safety level. A timer's state is
// its kind's idle state, or one above it (crimewatch/const.py): +1 while what caused it goes on, +2 while it
// counts down to its end, +3 and on where it is inherited from another's doing. The criminal's timer says
// which of the two it is by its state: the odd ones the criminal's, the even ones the suspect's.
//
// The client draws each as a dial. Here each is its word and what is left of it. The words are this page's own.

import type { CrimewatchClientStates } from "../bridge/boundCrimewatch.ts";
import { SECURITY_CLASS, securityClass } from "../bridge/systemSecurity.ts";

/** The clock's 100 ns ticks at the start of Unix time. */
const FILETIME_OF_UNIX_EPOCH = 116444736000000000n;

/** Crimewatch's client states as last read, with the server's clock less the browser's at the read. */
export interface CrimewatchReading {
  readonly states: CrimewatchClientStates;
  readonly clockOffsetMs: number;
}

/** The server's notices that change what crimewatch's client states say (crimewatchSvc.py 222 to 288). */
export const CRIMEWATCH_NOTICES: ReadonlySet<string> = new Set([
  "OnWeaponsTimerUpdate", "OnPvpTimerUpdate", "OnNpcTimerUpdate", "OnCriminalTimerUpdate", "OnDisapprovalTimerUpdate",
  "OnSystemCriminalFlagUpdates", "OnSystemDisapprovalFlagUpdates",
  "OnCrimewatchEngagementCreated", "OnCrimewatchEngagementEnded", "OnCrimewatchEngagementStartTimeout", "OnCrimewatchEngagementStopTimeout",
]);
/** What of the session, changing, has the client ask crimewatch its states again (crimewatchSvc.py 95, 119). */
export const CRIMEWATCH_SESSION_NAMES: ReadonlySet<string> = new Set(["locationid", "solarsystemid", "shipid"]);

export type CrimewatchTimerKind = "weapons" | "pvp" | "npc" | "criminal" | "disapproval";
/** Whether a timer's cause goes on, it is counting down, or it is another's doing passed on. */
export type CrimewatchTimerPhase = "active" | "timer" | "inherited";

export interface CrimewatchTimerView {
  readonly kind: CrimewatchTimerKind;
  readonly word: string;
  readonly phase: CrimewatchTimerPhase;
  /** What is left of it, where the server said when it ends; null where it only goes on. */
  readonly remainingMs: number | null;
}

/** The five, in the order the client's states have them, each with its idle state. */
const TIMERS: ReadonlyArray<readonly [CrimewatchTimerKind, number, string]> = [
  ["weapons", 100, "Weapons"],
  ["pvp", 200, "PvP"],
  ["npc", 400, "NPC"],
  ["criminal", 300, "Criminal"],
  ["disapproval", 500, "Disapproval"],
];

/** A server's clock time (100 ns ticks since 1601, as its exact digits) in Unix milliseconds; null for what is none. */
export function filetimeToMs(filetime: string | null): number | null {
  if (filetime === null || !/^\d+$/.test(filetime)) {
    return null;
  }
  return Number((BigInt(filetime) - FILETIME_OF_UNIX_EPOCH) / 10000n);
}

/** A timer's phase by how far its state is above its kind's idle state; null for idle and for what is no state of the kind. */
function phaseOf(kind: CrimewatchTimerKind, above: number): CrimewatchTimerPhase | null {
  if (kind === "criminal") {
    // 301, 302 go on; 303, 304 count down; 305, 306 are inherited: the criminal's and the suspect's of each.
    return above === 1 || above === 2 ? "active" : above === 3 || above === 4 ? "timer" : above === 5 || above === 6 ? "inherited" : null;
  }
  return above === 1 ? "active" : above === 2 ? "timer" : above === 3 ? "inherited" : null;
}

/**
 * The timers to show at `nowMs`, by the server's clock: every one that is not idle, in the client's order. One
 * counting down to a time already past is left out: the server has not said it is over, and there is nothing
 * left of it to show.
 */
export function crimewatchTimers(states: CrimewatchClientStates | null, nowMs: number): CrimewatchTimerView[] {
  if (states === null) {
    return [];
  }
  const shown: CrimewatchTimerView[] = [];
  TIMERS.forEach(([kind, idle, word], index) => {
    const timer = states.timers[index];
    if (!timer) {
      return;
    }
    const above = timer.state - idle;
    const phase = phaseOf(kind, above);
    if (phase === null) {
      return;
    }
    const endsAtMs = filetimeToMs(timer.expiry);
    const remainingMs = endsAtMs === null ? null : endsAtMs - nowMs;
    if (phase === "timer" && (remainingMs === null || remainingMs <= 0)) {
      return;
    }
    shown.push({
      kind,
      word: kind === "criminal" && above % 2 === 0 ? "Suspect" : word,
      phase,
      remainingMs: remainingMs !== null && remainingMs > 0 ? remainingMs : null,
    });
  });
  return shown;
}

/** A timer as its word and what is left of it, in minutes and seconds, a second begun counting as one. */
export function timerText(timer: CrimewatchTimerView): string {
  if (timer.remainingMs === null) {
    return timer.word;
  }
  const seconds = Math.ceil(timer.remainingMs / 1000);
  return `${timer.word} ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** crimewatch/const.py: shipSafetyLevelNone, shipSafetyLevelPartial and shipSafetyLevelFull. */
export type SafetyLevel = 0 | 1 | 2;

export interface SafetyBadge {
  readonly level: SafetyLevel;
  readonly word: string;
  readonly tone: "none" | "partial" | "full";
}

/** The three levels in the order the client's selector has them (shipSafetyButton.construct_buttons), each with what it lets the ship do. */
const SAFETY_LEVELS: ReadonlyArray<readonly [SafetyLevel, string, SafetyBadge["tone"], string]> = [
  [0, "None", "none", "The ship refuses nothing."],
  [1, "Partial", "partial", "The ship refuses what would make you a criminal."],
  [2, "Full", "full", "The ship refuses what would make you a suspect or a criminal."],
];

/**
 * Whether the safety level is held at Full where the pilot is (crimewatchSvc.IsSafetyLockedToFullLevel): in a
 * solar system of the safest class of security. `security` is the system's own; null, while it is not known,
 * holds nothing. The client's other cause, a structure controlled in high security, is nothing this page does.
 */
export function safetyLockedToFull(security: number | null): boolean {
  return security !== null && securityClass(security) === SECURITY_CLASS.safe;
}

/**
 * The ship's safety level in a word; null for what is no level. Where the level is held at Full, Full is the
 * level whatever crimewatch said (crimewatchSvc._UpdateSafetyLevel).
 */
export function safetyBadge(states: CrimewatchClientStates | null, lockedToFull = false): SafetyBadge | null {
  const said = states?.safetyLevel;
  const row = SAFETY_LEVELS.find(([level]) => level === said);
  if (row === undefined) {
    return null;
  }
  const [level, word, tone] = lockedToFull ? SAFETY_LEVELS[2]! : row;
  return { level, word, tone };
}

/** One of the selector's three buttons. */
export interface SafetyChoice extends SafetyBadge {
  /** What this level lets the ship do, in this page's words. */
  readonly says: string;
  /** The level now. */
  readonly selected: boolean;
  /** Not to be pressed (SecurityButton.IsLocked): every level but Full, where the level is held at Full. */
  readonly locked: boolean;
  /** Lower than the level now: the client wants a second press, on a button to confirm. */
  readonly confirms: boolean;
}

/** The selector's buttons for a ship at this level: None, Partial, Full. */
export function safetyChoices(current: SafetyLevel, lockedToFull: boolean): SafetyChoice[] {
  return SAFETY_LEVELS.map(([level, word, tone, says]) => ({
    level, word, tone, says,
    selected: level === current,
    locked: lockedToFull && level !== 2,
    confirms: level < current,
  }));
}

/**
 * What a press of one of the selector's buttons does (shipSafetyButton.OnSecurityButtonClick): nothing where the
 * button is locked, and nothing while a level waits to be confirmed; a level lower than the one now waits for a
 * second press; any other is set at once, the level now among them.
 */
export function safetyPress(choice: SafetyChoice, confirming: SafetyLevel | null): "nothing" | "confirm" | "set" {
  if (choice.locked || confirming !== null) {
    return "nothing";
  }
  return choice.confirms ? "confirm" : "set";
}
