// The saved-bots library, over a fake storage map — no localStorage in node.

import test from "node:test";
import assert from "node:assert/strict";

import type { BotScript } from "./botScript.ts";
import { createBotLibrary, type StorageLike } from "./botLibrary.ts";

function fakeStorage(): StorageLike & { dump(): string | null } {
  let value: string | null = null;
  return {
    getItem: () => value,
    setItem: (_k, v) => {
      value = v;
    },
    dump: () => value,
  };
}

function doc(name: string): BotScript {
  return {
    format: "evejs-bot-script",
    version: 1,
    name,
    notes: "",
    home: { entity: "station", id: null, name: null, systemName: null, starting: true },
    interrupts: [],
    program: [{ id: "s1", kind: "macro", macro: "undock", args: {} }],
  };
}

function lib(storage: StorageLike) {
  let n = 0;
  let clock = 0;
  return createBotLibrary(storage, "test-key", {
    makeId: () => `bot-${(n += 1)}`,
    now: () => `2026-07-23T00:00:${String((clock += 1)).padStart(2, "0")}.000Z`,
  });
}

test("save, list, and load round-trip through the codec", () => {
  const storage = fakeStorage();
  const library = lib(storage);
  const id = library.save("Belt runner", doc("Belt runner"));
  assert.equal(id, "bot-1");

  const listed = library.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.name, "Belt runner");

  const loaded = library.load(id);
  assert.ok(loaded);
  assert.equal(loaded.name, "Belt runner");
});

test("list is newest-first", () => {
  const library = lib(fakeStorage());
  library.save("first", doc("first"));
  library.save("second", doc("second"));
  assert.deepEqual(library.list().map((m) => m.name), ["second", "first"]);
});

test("update overwrites; unknown id is a no-op", () => {
  const storage = fakeStorage();
  const library = lib(storage);
  const id = library.save("v1", doc("v1"));
  assert.equal(library.update(id, "v2", doc("v2")), true);
  assert.equal(library.load(id)?.name, "v2");
  assert.equal(library.update("nope", "x", doc("x")), false);
});

test("remove deletes; a blank name becomes 'Untitled bot'", () => {
  const storage = fakeStorage();
  const library = lib(storage);
  const id = library.save("   ", doc("keep-name-off-doc"));
  assert.equal(library.list()[0]?.name, "Untitled bot");
  library.remove(id);
  assert.equal(library.list().length, 0);
  assert.equal(library.load(id), null);
});

test("a corrupted entry loads as null, never crashes", () => {
  const storage = fakeStorage();
  storage.setItem("test-key", JSON.stringify({ scripts: { bad: { id: "bad", name: "Bad", savedAt: "x", doc: { not: "a script" } } } }));
  const library = createBotLibrary(storage, "test-key");
  assert.equal(library.load("bad"), null);
  // It still lists (metadata is intact) so the player can delete it.
  assert.equal(library.list().length, 1);
});

test("garbage storage contents are treated as empty", () => {
  const storage = fakeStorage();
  storage.setItem("test-key", "not json at all");
  const library = createBotLibrary(storage, "test-key");
  assert.deepEqual(library.list(), []);
});
