// R107 — the sessionStorage roster that survives a refresh. These pin the
// round-trip, that an empty roster CLEARS the key (a signed-out tab restores to
// nothing), invalid-payload tolerance, and graceful behaviour with no storage.

import test from "node:test";
import assert from "node:assert/strict";

import {
  loadPersistedSessions,
  savePersistedSessions,
  clearPersistedSessions,
  setPersistedSessionsStorage,
  type PersistedSessionsStorage,
} from "./persistedSessions.ts";

const KEY = "evejs-web-online-pilots:v1";

function makeStorage(): PersistedSessionsStorage & { readonly map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

test.beforeEach(() => {
  setPersistedSessionsStorage(makeStorage());
});

test.after(() => {
  setPersistedSessionsStorage(null);
});

test("round-trips the roster and the active pilot", () => {
  savePersistedSessions({
    pilots: [
      { accountName: "test", characterID: 140000001 },
      { accountName: "test2", characterID: 140000002 },
    ],
    activeCharacterID: 140000002,
  });

  const loaded = loadPersistedSessions();
  assert.equal(loaded.pilots.length, 2);
  assert.deepEqual(loaded.pilots[0], { accountName: "test", characterID: 140000001 });
  assert.equal(loaded.activeCharacterID, 140000002);
});

test("an empty roster CLEARS the key — a signed-out tab restores to nothing", () => {
  const storage = makeStorage();
  setPersistedSessionsStorage(storage);
  savePersistedSessions({ pilots: [{ accountName: "test", characterID: 1 }], activeCharacterID: 1 });
  assert.equal(storage.map.has(KEY), true);

  savePersistedSessions({ pilots: [], activeCharacterID: null });
  assert.equal(storage.map.has(KEY), false, "the key is removed, not left as []");
  assert.deepEqual(loadPersistedSessions(), { pilots: [], activeCharacterID: null });
});

test("clearPersistedSessions forgets the roster", () => {
  savePersistedSessions({ pilots: [{ accountName: "test", characterID: 1 }], activeCharacterID: 1 });
  clearPersistedSessions();
  assert.deepEqual(loadPersistedSessions().pilots, []);
});

test("invalid pilot rows are dropped; a non-object payload is empty", () => {
  const storage = makeStorage();
  setPersistedSessionsStorage(storage);
  storage.map.set(
    KEY,
    JSON.stringify({
      pilots: [
        { accountName: "ok", characterID: 5 },
        { accountName: "", characterID: 6 }, // blank name
        { accountName: "no-id" }, // missing id
        { characterID: 7 }, // missing name
        42, // not an object
      ],
      activeCharacterID: 5,
    }),
  );
  const loaded = loadPersistedSessions();
  assert.equal(loaded.pilots.length, 1);
  assert.equal(loaded.pilots[0]?.accountName, "ok");
});

test("corrupt JSON and no storage both read back empty, never throwing", () => {
  const storage = makeStorage();
  storage.map.set(KEY, "{not json");
  setPersistedSessionsStorage(storage);
  assert.deepEqual(loadPersistedSessions(), { pilots: [], activeCharacterID: null });

  setPersistedSessionsStorage(null);
  assert.deepEqual(loadPersistedSessions(), { pilots: [], activeCharacterID: null });
  savePersistedSessions({ pilots: [{ accountName: "x", characterID: 1 }], activeCharacterID: 1 });
  clearPersistedSessions();
});
