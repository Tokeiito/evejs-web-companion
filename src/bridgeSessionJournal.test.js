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
const held = (bridgeSessionID, accountID = 1, characterID = 90000001) => ({
  bridgeSessionID, accountID, characterID, boundHandles: new Map(), streamSubscribers: new Set(), chat: null,
});
const deadOwner = { id: "dead-owner", pid: 2147483001, hostname: os.hostname() };
const reaper = (filePath, options = {}) => createBridgeSessionJournal({ filePath, isOwnerDead: () => true, ...options });
function documents(filePath) {
  const dir = `${filePath}.owners`;
  return !fs.existsSync(dir) ? [] : fs.readdirSync(dir).filter((name) => name.endsWith(".json"))
    .map((name) => ({ file: path.join(dir, name), ...JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) }));
}
const handles = (filePath) => documents(filePath).flatMap((document) => document.sessions.map((row) => row.bridgeSessionID)).sort();
function previous(filePath, rows) {
  const journal = createBridgeSessionJournal({ filePath, owner: deadOwner });
  const sessions = journal.createSessionMap();
  for (const row of rows) sessions.set(row.bridgeSessionID, row);
  return journal;
}

test("the live map retains detached handles until their release is confirmed", (t) => {
  const filePath = tempJournal(t);
  const journal = createBridgeSessionJournal({ filePath });
  const sessions = journal.createSessionMap();
  sessions.set("tab-a", held("bridge-a"));
  sessions.set("bot-b", held("bridge-b", 2, 90000002));
  const [document] = documents(filePath);
  assert.equal(document.version, 2);
  assert.equal(document.owner.pid, process.pid);
  assert.equal(document.owner.hostname, os.hostname());
  assert.deepEqual(document.sessions, [
    { bridgeSessionID: "bridge-a", accountID: 1, characterID: 90000001 },
    { bridgeSessionID: "bridge-b", accountID: 2, characterID: 90000002 },
  ]);
  assert.equal(fs.existsSync(filePath), false, "there is no shared whole-file snapshot to overwrite");
  sessions.delete("tab-a");
  sessions.clear();
  assert.equal(sessions.size, 0);
  assert.deepEqual(handles(filePath), ["bridge-a", "bridge-b"], "local detachment is not release proof");
  journal.confirmReleased("bridge-a");
  assert.deepEqual(handles(filePath), ["bridge-b"]);
  journal.confirmReleased("bridge-b");
  assert.deepEqual(handles(filePath), []);
});

test("a restart releases only dead owners and preserves the new process's sessions", async (t) => {
  const filePath = tempJournal(t);
  previous(filePath, [held("bridge-a"), held("bridge-b", 2, 90000002)]);
  const after = reaper(filePath);
  after.createSessionMap().set("tab-a", held("bridge-new"));
  const calls = [];
  const outcome = await after.releaseOrphans(async (bridgeSessionID, fields) => {
    calls.push([bridgeSessionID, fields.userid]);
    return { released: true };
  });
  assert.deepEqual(calls, [["bridge-a", 1], ["bridge-b", 2]]);
  assert.deepEqual(outcome, { released: 2, gone: 0, failed: 0 });
  assert.deepEqual(handles(filePath), ["bridge-new"]);
});

test("SESSION_NOT_FOUND is proof; transport failures and unconfirmed replies stay durable", async (t) => {
  const filePath = tempJournal(t);
  previous(filePath, [held("bridge-gone"), held("bridge-unreachable"), held("bridge-unconfirmed"), held("bridge-undefined"), held("bridge-ok-only")]);
  const errors = [];
  const after = reaper(filePath, { logError: (error) => errors.push(error.code) });
  const outcome = await after.releaseOrphans(async (bridgeSessionID) => {
    if (bridgeSessionID === "bridge-unconfirmed") return { released: false };
    if (bridgeSessionID === "bridge-undefined") return undefined;
    if (bridgeSessionID === "bridge-ok-only") return { ok: true };
    throw Object.assign(new Error("no"), { code: bridgeSessionID === "bridge-gone" ? "SESSION_NOT_FOUND" : "EVE_GATEWAY_UNREACHABLE" });
  });
  assert.deepEqual(outcome, { released: 0, gone: 1, failed: 4 });
  assert.deepEqual(errors, ["EVE_GATEWAY_UNREACHABLE", "PILOT_RELEASE_UNVERIFIED", "PILOT_RELEASE_UNVERIFIED", "PILOT_RELEASE_UNVERIFIED"]);
  assert.deepEqual(handles(filePath), ["bridge-ok-only", "bridge-unconfirmed", "bridge-undefined", "bridge-unreachable"]);
  const retried = [];
  await reaper(filePath).releaseOrphans(async (id) => { retried.push(id); return { released: true }; });
  assert.deepEqual(retried.sort(), ["bridge-ok-only", "bridge-unconfirmed", "bridge-undefined", "bridge-unreachable"]);
  assert.deepEqual(handles(filePath), []);
});

test("live, foreign, unknown and legacy owners are preserved even when a test liveness check says dead", async (t) => {
  const filePath = tempJournal(t);
  createBridgeSessionJournal({ filePath }).track(held("bridge-live"));
  createBridgeSessionJournal({ filePath, owner: { ...deadOwner, id: "foreign", hostname: `${os.hostname()}-foreign` } }).track(held("bridge-foreign"));
  const unknownFile = path.join(`${filePath}.owners`, "unknown.json");
  fs.writeFileSync(unknownFile, JSON.stringify({ version: 2, sessions: [held("bridge-unknown")] }));
  const legacy = JSON.stringify({ version: 1, sessions: [held("bridge-legacy")] });
  fs.writeFileSync(filePath, legacy);
  const errors = [];
  const after = reaper(filePath, { logError: (error) => errors.push(error) });
  assert.deepEqual(await after.releaseOrphans(async () => assert.fail("owner was not proven dead")), { released: 0, gone: 0, failed: 0 });
  assert.equal(errors.length, 1);
  assert.equal(fs.readFileSync(filePath, "utf8"), legacy);
  assert.equal(JSON.parse(fs.readFileSync(unknownFile)).sessions[0].bridgeSessionID, "bridge-unknown");
  assert.deepEqual(handles(filePath), ["bridge-foreign", "bridge-live", "bridge-unknown"]);
});

test("a failed atomic save preserves disk evidence and later flush includes every in-memory obligation", (t) => {
  const filePath = tempJournal(t);
  const errors = [];
  const journal = createBridgeSessionJournal({ filePath, logError: (error) => errors.push(error.code) });
  journal.track(held("bridge-a"));
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (path.dirname(to) === `${filePath}.owners`) throw Object.assign(new Error("disk unavailable"), { code: "EIO" });
    return rename(from, to);
  };
  try { assert.equal(journal.track(held("bridge-b")), false); }
  finally { fs.renameSync = rename; }
  assert.deepEqual(handles(filePath), ["bridge-a"]);
  assert.deepEqual(errors, ["EIO"]);
  journal.track(held("bridge-c"));
  assert.deepEqual(handles(filePath), ["bridge-a", "bridge-b", "bridge-c"]);
});

test("failed reaper persistence cannot discard an unreleased sibling", async (t) => {
  const filePath = tempJournal(t);
  previous(filePath, [held("bridge-a"), held("bridge-b")]);
  const journal = reaper(filePath, { logError: () => {} });
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (path.dirname(to) === `${filePath}.owners`) throw Object.assign(new Error("disk unavailable"), { code: "EIO" });
    return rename(from, to);
  };
  try {
    const outcome = await journal.releaseOrphans(async (id) => {
      if (id === "bridge-b") throw new Error("release unavailable");
      return { released: true };
    });
    assert.deepEqual(outcome, { released: 1, gone: 0, failed: 1 });
  } finally { fs.renameSync = rename; }
  assert.deepEqual(handles(filePath), ["bridge-a", "bridge-b"]);
  const calls = [];
  await reaper(filePath).releaseOrphans(async (id) => {
    calls.push(id);
    if (id === "bridge-a") throw Object.assign(new Error("already gone"), { code: "SESSION_NOT_FOUND" });
    return { released: true };
  });
  assert.deepEqual(calls, ["bridge-a", "bridge-b"]);
  assert.deepEqual(handles(filePath), []);
});

test("concurrent reapers may repeat idempotent releases but preserve every failed row", async (t) => {
  const filePath = tempJournal(t);
  previous(filePath, [held("bridge-a"), held("bridge-b"), held("bridge-c")]);
  const released = new Set();
  const release = async (id) => {
    if (id === "bridge-b") throw new Error("release unavailable");
    if (released.has(id)) throw Object.assign(new Error("already gone"), { code: "SESSION_NOT_FOUND" });
    released.add(id);
    await new Promise((resolve) => setImmediate(resolve));
    return { released: true };
  };
  const outcomes = await Promise.all([
    reaper(filePath, { logError: () => {} }).releaseOrphans(release),
    reaper(filePath, { logError: () => {} }).releaseOrphans(release),
  ]);
  assert.deepEqual(outcomes.map((outcome) => outcome.failed), [1, 1]);
  assert.deepEqual([...released].sort(), ["bridge-a", "bridge-c"]);
  assert.deepEqual(handles(filePath), ["bridge-b"]);
});

test("closing during an orphan release records its result and stops further dispatch", async (t) => {
  const filePath = tempJournal(t);
  previous(filePath, [held("bridge-a"), held("bridge-b")]);
  let current = true;
  const calls = [];
  const outcome = await reaper(filePath).releaseOrphans(async (id) => {
    calls.push(id);
    current = false;
    return { released: true };
  }, { shouldContinue: () => current });
  assert.deepEqual(outcome, { released: 1, gone: 0, failed: 0 });
  assert.deepEqual(calls, ["bridge-a"]);
  assert.deepEqual(handles(filePath), ["bridge-b"]);
});

test("missing or corrupt files cannot authorize a release, and without a path no disk is touched", async (t) => {
  const filePath = tempJournal(t);
  const missing = reaper(filePath);
  assert.deepEqual(await missing.releaseOrphans(async () => assert.fail("nothing to release")), { released: 0, gone: 0, failed: 0 });
  fs.mkdirSync(`${filePath}.owners`);
  const corrupt = path.join(`${filePath}.owners`, "partial.json");
  fs.writeFileSync(corrupt, "{partial");
  const errors = [];
  await reaper(filePath, { logError: (error) => errors.push(error) }).releaseOrphans(async () => assert.fail("unknown owner"));
  assert.equal(errors.length, 1);
  assert.equal(fs.readFileSync(corrupt, "utf8"), "{partial");
  const memory = createBridgeSessionJournal();
  memory.createSessionMap().set("tab", held("bridge-memory"));
  assert.equal(memory.confirmReleased("bridge-memory"), true);
  assert.deepEqual(await memory.releaseOrphans(async () => assert.fail("nothing on disk")), { released: 0, gone: 0, failed: 0 });
});
