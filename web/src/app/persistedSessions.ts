// R107 — retain the ONLINE roster across a browser REFRESH, so reloading the tab
// brings the same pilots back online instead of dropping to a fresh login.
//
// sessionStorage, not localStorage, on purpose: it survives an F5/reload but
// clears when the tab is CLOSED (closing the tab is a deliberate "I'm done"),
// and it is per-tab — which matches the one-tab multibox model. Only account
// names + character IDs are kept (the same identities knownCharacters.ts already
// stores) — NEVER a token. Restore re-signs in (any password) and re-selects, so
// nothing here is a credential and an XSS read of it grants nothing new.

export interface PersistedPilot {
  readonly accountName: string;
  readonly characterID: number;
}

export interface PersistedSessions {
  readonly pilots: readonly PersistedPilot[];
  /** Which pilot's cockpit was active, so restore lands on the same one. */
  readonly activeCharacterID: number | null;
}

const STORAGE_VERSION = 1;
const STORAGE_KEY = `evejs-web-online-pilots:v${STORAGE_VERSION}`;

/** The slice of `Storage` this module needs; tests supply their own. */
export interface PersistedSessionsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function detectStorage(): PersistedSessionsStorage | null {
  try {
    const candidate = (globalThis as { sessionStorage?: PersistedSessionsStorage | null })
      .sessionStorage;
    if (
      candidate &&
      typeof candidate.getItem === "function" &&
      typeof candidate.setItem === "function" &&
      typeof candidate.removeItem === "function"
    ) {
      return candidate;
    }
  } catch {
    // Some privacy modes throw on touching sessionStorage — treat as unavailable.
  }
  return null;
}

let storage: PersistedSessionsStorage | null = detectStorage();

/** Point this module at a different store (tests). Passing null disables it. */
export function setPersistedSessionsStorage(next: PersistedSessionsStorage | null): void {
  storage = next;
}

const EMPTY: PersistedSessions = { pilots: [], activeCharacterID: null };

function isPilot(value: unknown): value is PersistedPilot {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.accountName === "string" &&
    o.accountName.length > 0 &&
    typeof o.characterID === "number" &&
    Number.isFinite(o.characterID)
  );
}

/** The retained roster from the last write, or empty when none/unavailable. */
export function loadPersistedSessions(): PersistedSessions {
  if (!storage) return EMPTY;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return EMPTY;
    const o = parsed as Record<string, unknown>;
    const pilots = Array.isArray(o.pilots) ? o.pilots.filter(isPilot) : [];
    const activeCharacterID =
      typeof o.activeCharacterID === "number" && Number.isFinite(o.activeCharacterID)
        ? o.activeCharacterID
        : null;
    return { pilots, activeCharacterID };
  } catch {
    return EMPTY;
  }
}

/** Write the roster; an empty roster clears the key (a fully signed-out tab). */
export function savePersistedSessions(state: PersistedSessions): void {
  if (!storage) return;
  try {
    if (state.pilots.length === 0) {
      storage.removeItem(STORAGE_KEY);
      return;
    }
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ pilots: state.pilots, activeCharacterID: state.activeCharacterID }),
    );
  } catch {
    // storage full or blocked — restore-on-refresh is best-effort, never fatal.
  }
}

/** Forget the retained roster entirely. */
export function clearPersistedSessions(): void {
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // best-effort
  }
}
