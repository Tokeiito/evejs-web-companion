"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createBridgeSessionJournal } = require("./bridgeSessionJournal");

function tempJournal(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-session-journal-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, "bridge-sessions.json");
}

const held = (bridgeSessionID, accountID, characterID) => ({
  bridgeSessionID, accountID, characterID, boundHandles: new Map(), streamSubscribers: new Set(), chat: null,
});

function read(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8")).sessions;
}

test("every set and delete mirrors only the handle, account and character to disk", (t) => {
  const filePath = tempJournal(t);
  const sessions = createBridgeSessionJournal({ filePath }).createSessionMap();
  sessions.set("tab-a", held("bridge-a", 1, 90000001));
  sessions.set("bot-b", held("bridge-b", 2, 90000002));
  assert.deepEqual(read(filePath), [
    { bridgeSessionID: "bridge-a", accountID: 1, characterID: 90000001 },
    { bridgeSessionID: "bridge-b", accountID: 2, characterID: 90000002 },
  ]);
  sessions.delete("tab-a");
  assert.deepEqual(read(filePath).map((row) => row.bridgeSessionID), ["bridge-b"]);
  assert.equal(sessions.get("bot-b").bridgeSessionID, "bridge-b", "the map still behaves as a Map");
});

test("a restart releases what the previous process held, and only that", async (t) => {
  const filePath = tempJournal(t);
  const before = createBridgeSessionJournal({ filePath }).createSessionMap();
  before.set("tab-a", held("bridge-a", 1, 90000001));
  before.set("bot-b", held("bridge-b", 2, 90000002));

  const after = createBridgeSessionJournal({ filePath });
  const sessions = after.createSessionMap();
  // A tab reconnects before the release runs: its NEW session must survive it.
  sessions.set("tab-a", held("bridge-new", 1, 90000001));
  const calls = [];
  const outcome = await after.releaseOrphans(async (bridgeSessionID, fields) => {
    calls.push([bridgeSessionID, fields.userid]);
    return { released: true };
  });
  assert.deepEqual(calls, [["bridge-a", 1], ["bridge-b", 2]]);
  assert.deepEqual(outcome, { released: 2, gone: 0, failed: 0 });
  assert.deepEqual(read(filePath).map((row) => row.bridgeSessionID), ["bridge-new"]);
});

test("SESSION_NOT_FOUND counts as released; any other failure is kept for the next start", async (t) => {
  const filePath = tempJournal(t);
  const before = createBridgeSessionJournal({ filePath }).createSessionMap();
  before.set("a", held("bridge-gone", 1, 90000001));
  before.set("b", held("bridge-unreachable", 2, 90000002));

  const errors = [];
  const after = createBridgeSessionJournal({ filePath, logError: (error) => errors.push(error.code) });
  after.createSessionMap();
  const outcome = await after.releaseOrphans(async (bridgeSessionID) => {
    throw Object.assign(new Error("no"), {
      code: bridgeSessionID === "bridge-gone" ? "SESSION_NOT_FOUND" : "EVE_GATEWAY_UNREACHABLE",
    });
  });
  assert.deepEqual(outcome, { released: 0, gone: 1, failed: 1 });
  assert.deepEqual(errors, ["EVE_GATEWAY_UNREACHABLE"]);
  assert.deepEqual(read(filePath).map((row) => row.bridgeSessionID), ["bridge-unreachable"]);

  const third = createBridgeSessionJournal({ filePath });
  third.createSessionMap();
  const retried = [];
  await third.releaseOrphans(async (bridgeSessionID) => { retried.push(bridgeSessionID); });
  assert.deepEqual(retried, ["bridge-unreachable"]);
  assert.deepEqual(read(filePath), []);
});

test("a missing or corrupt journal starts empty and never throws", async (t) => {
  const filePath = tempJournal(t);
  const missing = createBridgeSessionJournal({ filePath });
  assert.deepEqual(await missing.releaseOrphans(async () => assert.fail("nothing to release")),
    { released: 0, gone: 0, failed: 0 });

  fs.writeFileSync(filePath, "{partial");
  const errors = [];
  const corrupt = createBridgeSessionJournal({ filePath, logError: (error) => errors.push(error) });
  assert.equal(errors.length, 1);
  assert.deepEqual(await corrupt.releaseOrphans(async () => assert.fail("nothing to release")),
    { released: 0, gone: 0, failed: 0 });
});

test("without a file path nothing touches the disk", async () => {
  const journal = createBridgeSessionJournal();
  const sessions = journal.createSessionMap();
  sessions.set("tab", held("bridge-a", 1, 90000001));
  sessions.clear();
  assert.deepEqual(await journal.releaseOrphans(async () => assert.fail("nothing to release")),
    { released: 0, gone: 0, failed: 0 });
});
