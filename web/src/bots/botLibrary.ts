// A player's saved bots, kept in the browser (localStorage). This is the "works
// today" library — a durable per-account one over the BFF (slice D2/D3) can
// replace the storage backend later without changing the editor. Every load runs
// the stored bytes back through the codec (decode-on-read), so a corrupted or
// outdated entry can never reach the runner.
//
// Storage is INJECTED (a tiny getItem/setItem interface), so this is a plain
// node --test module — no localStorage in the tests.

import { decodeScriptValue } from "./scriptCodec.ts";
import type { BotScript } from "./botScript.ts";

export interface SavedMeta {
  readonly id: string;
  readonly name: string;
  readonly savedAt: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface BotLibrary {
  /** Saved bots, newest first (metadata only). */
  list(): SavedMeta[];
  /** Decode a saved bot; null when missing or no longer valid. */
  load(id: string): BotScript | null;
  /** Save a new bot; returns its id. */
  save(name: string, doc: BotScript): string;
  /** Overwrite an existing bot; false when the id is unknown. */
  update(id: string, name: string, doc: BotScript): boolean;
  remove(id: string): void;
}

interface StoredRecord {
  id: string;
  name: string;
  savedAt: string;
  doc: unknown;
}
interface Stored {
  scripts: Record<string, StoredRecord>;
}

export interface LibraryOptions {
  now?: () => string;
  makeId?: () => string;
}

export function createBotLibrary(storage: StorageLike, key: string, options: LibraryOptions = {}): BotLibrary {
  const now = options.now ?? (() => new Date().toISOString());
  const makeId =
    options.makeId ??
    (() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `id-${now()}`));

  function readAll(): Stored {
    try {
      const raw = storage.getItem(key);
      if (raw === null) {
        return { scripts: {} };
      }
      const parsed: unknown = JSON.parse(raw);
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        "scripts" in parsed &&
        typeof (parsed as { scripts: unknown }).scripts === "object" &&
        (parsed as { scripts: unknown }).scripts !== null
      ) {
        return parsed as Stored;
      }
      return { scripts: {} };
    } catch {
      return { scripts: {} };
    }
  }

  function writeAll(data: Stored): void {
    storage.setItem(key, JSON.stringify(data));
  }

  function safeName(name: string): string {
    const trimmed = name.trim();
    return trimmed.length > 0 ? trimmed.slice(0, 60) : "Untitled bot";
  }

  return {
    list(): SavedMeta[] {
      const all = readAll();
      return Object.values(all.scripts)
        .map((s) => ({ id: s.id, name: s.name, savedAt: s.savedAt }))
        .sort((a, b) => (a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0));
    },
    load(id: string): BotScript | null {
      const record = readAll().scripts[id];
      if (record === undefined) {
        return null;
      }
      const result = decodeScriptValue(record.doc);
      return result.ok ? result.doc : null;
    },
    save(name: string, doc: BotScript): string {
      const all = readAll();
      const id = makeId();
      all.scripts[id] = { id, name: safeName(name), savedAt: now(), doc };
      writeAll(all);
      return id;
    },
    update(id: string, name: string, doc: BotScript): boolean {
      const all = readAll();
      if (all.scripts[id] === undefined) {
        return false;
      }
      all.scripts[id] = { id, name: safeName(name), savedAt: now(), doc };
      writeAll(all);
      return true;
    },
    remove(id: string): void {
      const all = readAll();
      if (all.scripts[id] !== undefined) {
        delete all.scripts[id];
        writeAll(all);
      }
    },
  };
}
