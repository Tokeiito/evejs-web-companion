"use strict";

// D1 — the library store, exercised against a throwaway temp directory so the
// real data/ is never touched. Ownership, quotas, size, and the optimistic
// revision are the load-bearing behaviours.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createBotScriptStore, MAX_SCRIPTS_PER_ACCOUNT, MAX_DOC_BYTES } = require("./botScriptStore");

function tempStore() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "botstore-"));
  let n = 0;
  let clock = 0;
  const store = createBotScriptStore({
    dataDir,
    uuid: () => `uuid-${(n += 1)}`,
    now: () => `2026-07-23T00:00:${String((clock += 1)).padStart(2, "0")}.000Z`,
  });
  return { store, dataDir };
}

const ALICE = 1001;
const BOB = 2002;

function doc(name) {
  return { format: "evejs-bot-script", version: 1, name, program: [] };
}

test("create, get, and list round-trip for the owning account", () => {
  const { store } = tempStore();
  const { scriptID, rev } = store.create(ALICE, doc("Belt runner"));
  assert.equal(rev, 1);

  const got = store.get(ALICE, scriptID);
  assert.ok(got);
  assert.equal(got.doc.name, "Belt runner");
  assert.equal(got.name, "Belt runner");

  const listed = store.list(ALICE);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].scriptID, scriptID);
  assert.equal(listed[0].bytes > 0, true);
  assert.equal(listed[0].doc, undefined, "list returns metadata only, never the doc");
});

test("another account cannot see, update, or delete a script", () => {
  const { store } = tempStore();
  const { scriptID } = store.create(ALICE, doc("Private"));
  assert.equal(store.get(BOB, scriptID), null);
  assert.equal(store.list(BOB).length, 0);
  assert.equal(store.remove(BOB, scriptID), false);
  assert.throws(() => store.update(BOB, scriptID, doc("Hijack"), 1), /could not be found/i);
  // Alice's copy is untouched.
  assert.equal(store.get(ALICE, scriptID).doc.name, "Private");
});

test("update bumps the revision; a stale baseRev conflicts", () => {
  const { store } = tempStore();
  const { scriptID } = store.create(ALICE, doc("v1"));
  const { rev } = store.update(ALICE, scriptID, doc("v2"), 1);
  assert.equal(rev, 2);
  assert.equal(store.get(ALICE, scriptID).doc.name, "v2");

  assert.throws(() => store.update(ALICE, scriptID, doc("v3"), 1), (e) => e.code === "SCRIPT_REV_CONFLICT");
});

test("the per-account quota is enforced", () => {
  const { store } = tempStore();
  for (let i = 0; i < MAX_SCRIPTS_PER_ACCOUNT; i += 1) {
    store.create(ALICE, doc(`bot ${i}`));
  }
  assert.throws(() => store.create(ALICE, doc("one too many")), (e) => e.code === "BOTSCRIPT_LIMIT_REACHED");
  // A different account is unaffected.
  assert.doesNotThrow(() => store.create(BOB, doc("bob's first")));
});

test("an oversized document is refused", () => {
  const { store } = tempStore();
  const big = { format: "evejs-bot-script", version: 1, name: "huge", blob: "y".repeat(MAX_DOC_BYTES) };
  assert.throws(() => store.create(ALICE, big), (e) => e.code === "BOTSCRIPT_TOO_BIG");
});

test("non-object docs are refused", () => {
  const { store } = tempStore();
  assert.throws(() => store.create(ALICE, null), (e) => e.code === "BOTSCRIPT_INVALID");
  assert.throws(() => store.create(ALICE, [1, 2, 3]), (e) => e.code === "BOTSCRIPT_INVALID");
});

test("remove deletes an owned script", () => {
  const { store } = tempStore();
  const { scriptID } = store.create(ALICE, doc("temp"));
  assert.equal(store.remove(ALICE, scriptID), true);
  assert.equal(store.get(ALICE, scriptID), null);
  assert.equal(store.remove(ALICE, scriptID), false, "removing again is a no-op");
});

test("data survives a fresh store instance over the same directory", () => {
  const { store, dataDir } = tempStore();
  const { scriptID } = store.create(ALICE, doc("persisted"));
  const reopened = createBotScriptStore({ dataDir });
  assert.equal(reopened.get(ALICE, scriptID).doc.name, "persisted");
});
