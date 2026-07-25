// R107 — remember the pilots you have signed into, so "Add character" can offer
// one-click quick-adds instead of retyping an account name and re-picking a
// character every time. Persisted in localStorage (per origin, shared across
// tabs), mirroring the per-character desktop-layout store in ui/desktop.ts.
//
// This keeps only NAMES and IDs the login already hands back for any account on
// this local emulator — no secret lives here (unlike the session token, which is
// never persisted in per-session/multibox mode). DO NOT copy this to anything a
// network can reach without revisiting that.

import type { CharacterSummary } from "../store/types.ts";

export interface KnownCharacter {
  /** The account to sign into to bring this pilot online (any password). */
  readonly accountName: string;
  readonly characterID: number;
  readonly characterName: string;
  readonly shipName: string | null;
  readonly skillPoints: number | null;
  readonly balance: number | null;
  /** ms epoch of the last sign-in that refreshed this row (roster ordering). */
  readonly lastSeen: number;
}

const STORAGE_VERSION = 1;
const STORAGE_KEY = `evejs-web-known-characters:v${STORAGE_VERSION}`;
// A sane cap so a long-lived roster can never grow without bound.
const MAX_ENTRIES = 60;

/** The slice of `Storage` this module needs; tests supply their own. */
export interface KnownCharacterStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function detectStorage(): KnownCharacterStorage | null {
  try {
    const candidate = (globalThis as { localStorage?: KnownCharacterStorage | null }).localStorage;
    if (
      candidate &&
      typeof candidate.getItem === "function" &&
      typeof candidate.setItem === "function"
    ) {
      return candidate;
    }
  } catch {
    // Some privacy modes throw on touching localStorage — treat as unavailable.
  }
  return null;
}

let storage: KnownCharacterStorage | null = detectStorage();

/** Point this module at a different store (tests). Passing null disables it. */
export function setKnownCharacterStorage(next: KnownCharacterStorage | null): void {
  storage = next;
}

function isKnown(value: unknown): value is KnownCharacter {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.accountName === "string" &&
    o.accountName.length > 0 &&
    typeof o.characterID === "number" &&
    Number.isFinite(o.characterID) &&
    typeof o.characterName === "string" &&
    (o.shipName === null || typeof o.shipName === "string") &&
    (o.skillPoints === null || typeof o.skillPoints === "number") &&
    (o.balance === null || typeof o.balance === "number") &&
    typeof o.lastSeen === "number"
  );
}

/** The saved roster, most-recently-seen first; empty when none/unavailable. */
export function loadKnownCharacters(): KnownCharacter[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isKnown).sort((a, b) => b.lastSeen - a.lastSeen);
  } catch {
    return [];
  }
}

function write(entries: readonly KnownCharacter[]): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // storage full or blocked — the roster is a convenience, never fatal.
  }
}

/**
 * Record the character list a sign-in returned for `accountName`. The account's
 * previous rows are replaced wholesale (a character removed from the account
 * drops off), and every kept row's `lastSeen` is bumped so this account sorts to
 * the top of the roster.
 */
export function rememberCharacters(
  accountName: string,
  characters: readonly CharacterSummary[],
): void {
  const name = accountName.trim();
  if (!name || characters.length === 0) return;
  const now = Date.now();
  const others = loadKnownCharacters().filter((k) => k.accountName !== name);
  const fresh: KnownCharacter[] = characters.map((c) => ({
    accountName: name,
    characterID: c.characterID,
    characterName: c.characterName,
    shipName: c.shipName ?? null,
    skillPoints: c.skillPoints ?? null,
    balance: c.balance ?? null,
    lastSeen: now,
  }));
  write([...fresh, ...others].sort((a, b) => b.lastSeen - a.lastSeen));
}

/** Drop one pilot from the roster (the "forget" affordance in the picker). */
export function forgetKnownCharacter(characterID: number): void {
  write(loadKnownCharacters().filter((k) => k.characterID !== characterID));
}
