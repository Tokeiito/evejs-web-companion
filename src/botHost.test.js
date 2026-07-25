"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createBotHost } = require("./botHost");

// The host is exercised with a FAKE browser stack (the loadStack seam): the
// real one is the shipping web/src modules, proven live; these tests pin the
// host's own obligations — claims, refusals, lifecycle, release-on-end.

const IDLE_SLICE = Object.freeze({
  status: "idle",
  name: null,
  phase: null,
  why: null,
  stepPath: null,
  interruptID: null,
  pauseReason: null,
  note: null,
  startError: null,
});

function makeFakeStack(log) {
  return async () => ({
    decodeScriptValue: (doc) =>
      doc && doc.valid === true
        ? { ok: true, doc, warnings: [] }
        : { ok: false, refusal: "That bot could not be read." },
    createClientStore: () => {
      const listeners = new Set();
      const state = {
        station: { online: null },
        customBot: { ...IDLE_SLICE },
        flight: { status: null },
        space: { snapshot: null },
        mining: { holds: [] },
      };
      const store = {
        _set(partial) {
          Object.assign(state, partial);
          for (const listener of listeners) {
            listener(state);
          }
        },
        station: { get: () => state.station },
        customBot: { get: () => state.customBot },
        flight: { get: () => state.flight },
        space: { get: () => state.space },
        mining: { get: () => state.mining },
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      };
      log.push(["_store", store]);
      return store;
    },
    createAppFlow: (store, options) => {
      log.push(["createAppFlow", options.baseUrl, options.perSessionToken, options.initialSessionToken]);
      return {
        async selectCharacter(characterID) {
          log.push(["selectCharacter", characterID]);
          store._set({ station: { online: { characterID, characterName: "Test Pilot" } } });
        },
        async startCustomBot(doc) {
          log.push(["startCustomBot", doc]);
          store._set({ customBot: { ...IDLE_SLICE, status: "running", phase: "Working" } });
        },
        stopCustomBot() {
          log.push(["stopCustomBot"]);
        },
        async logout() {
          log.push(["logout"]);
        },
        // The vitals sampler's reads: populate the slices like the real flow.
        async loadFlightStatus() {
          store._set({ flight: { status: { docked: false, stationID: null } } });
        },
        async loadSpaceSnapshot() {
          store._set({
            space: { snapshot: { ship: { shieldRatio: 0.9, armorRatio: 1, hullRatio: 1 } } },
          });
        },
        async loadMiningHolds() {
          store._set({
            mining: {
              holds: [
                { label: "Ore hold", present: true, capacity: { used: 6000, capacity: 8000 } },
                { label: "Fuel bay", present: false, capacity: null },
              ],
            },
          });
        },
      };
    },
  });
}

function makeHost({ log = [], isCharacterHeld = () => false, ...extras } = {}) {
  return createBotHost({
    webAuth: { createSessionToken: () => "bot-token" },
    baseUrl: "http://127.0.0.1:0",
    isCharacterHeld,
    errorLogger: () => {},
    loadStack: makeFakeStack(log),
    ...extras,
  });
}

const ACCOUNT = { accountID: 7, username: "test" };
const START = {
  account: ACCOUNT,
  characterID: 140000001,
  scriptID: "s1",
  scriptName: "Miner",
  doc: { valid: true },
};

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

test("start flies the character on its own session and lists it", async () => {
  const log = [];
  const host = makeHost({ log });
  const outcome = await host.start(START);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.bot.status, "running");
  assert.equal(outcome.bot.characterName, "Test Pilot");
  assert.equal(host.claimedBy(140000001), outcome.bot.botID);
  const listed = host.list(7);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].botID, outcome.bot.botID);
  // Another account sees nothing.
  assert.equal(host.list(8).length, 0);
  // The flow was seeded with the minted token — no password ever crossed.
  const flowCall = log.find((row) => row[0] === "createAppFlow");
  assert.deepEqual(flowCall.slice(2), [true, "bot-token"]);
});

test("a second bot may not take a claimed character", async () => {
  const host = makeHost();
  assert.equal((await host.start(START)).ok, true);
  const second = await host.start(START);
  assert.equal(second.ok, false);
  assert.equal(second.code, "BOT_ALREADY_RUNNING");
});

test("a character a web session holds is refused", async () => {
  const host = makeHost({ isCharacterHeld: (characterID) => characterID === 140000001 });
  const outcome = await host.start(START);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "CHARACTER_IN_USE");
  assert.equal(host.claimedBy(140000001), null);
});

test("an undecodable doc is refused before any session exists", async () => {
  const log = [];
  const host = makeHost({ log });
  const outcome = await host.start({ ...START, doc: { valid: false } });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "BOTSCRIPT_INVALID");
  assert.equal(log.some((row) => row[0] === "selectCharacter"), false);
});

test("stop releases the claim and the character", async () => {
  const log = [];
  const host = makeHost({ log });
  const started = await host.start(START);
  const stopped = await host.stop(started.bot.botID, 7);
  assert.equal(stopped.ok, true);
  assert.equal(stopped.bot.status, "stopped");
  assert.notEqual(stopped.bot.endedAt, null);
  assert.equal(host.claimedBy(140000001), null);
  assert.equal(log.some((row) => row[0] === "logout"), true);
  // The record remains listable for inspection.
  assert.equal(host.list(7).length, 1);
});

test("activeCharacterIDs names exactly the characters bots are flying", async () => {
  const host = makeHost();
  assert.deepEqual(host.activeCharacterIDs(), []);
  const started = await host.start(START);
  assert.deepEqual(host.activeCharacterIDs(), [140000001]);
  await host.stop(started.bot.botID, 7);
  assert.deepEqual(host.activeCharacterIDs(), []);
});

test("stop is scoped to the owning account", async () => {
  const host = makeHost();
  const started = await host.start(START);
  const outcome = await host.stop(started.bot.botID, 8);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "BOT_NOT_FOUND");
  assert.notEqual(host.claimedBy(140000001), null);
});

test("a script that ends on its own releases the character", async () => {
  const log = [];
  const host = makeHost({ log });
  const started = await host.start(START);
  const record = host.list(7)[0];
  assert.equal(record.status, "running");
  // The runner lets go: the store reports the terminal status.
  const store = lastStore(log);
  store._set({ customBot: { ...IDLE_SLICE, status: "stopped", phase: "Done" } });
  await settle();
  assert.equal(host.claimedBy(140000001), null);
  assert.equal(log.some((row) => row[0] === "logout"), true);
  const after = host.list(7)[0];
  assert.equal(after.botID, started.bot.botID);
  assert.equal(after.status, "stopped");
  assert.notEqual(after.endedAt, null);
});

test("a fresh start on the character replaces the finished record", async () => {
  const host = makeHost();
  const first = await host.start(START);
  await host.stop(first.bot.botID, 7);
  const second = await host.start(START);
  assert.equal(second.ok, true);
  const listed = host.list(7);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].botID, second.bot.botID);
});

// The fake stack hands each start a fresh store; tests that poke the store
// after start need the one the LAST start used. Cheapest honest way: capture
// it off the subscribe seam — the host subscribes exactly once per start.
function lastStore(log) {
  const call = [...log].reverse().find((row) => row[0] === "_store");
  assert.notEqual(call, undefined, "no store was captured — did start() succeed?");
  return call[1];
}

// ── Durability: the running roster survives a restart ───────────────────────

function tempRosterPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bot-host-")), "server-bots.json");
}

function readRosterFile(rosterPath) {
  return JSON.parse(fs.readFileSync(rosterPath, "utf8")).bots;
}

test("the running roster is mirrored to disk and cleared when the bot ends", async () => {
  const rosterPath = tempRosterPath();
  const host = makeHost({ persistPath: rosterPath });
  const started = await host.start(START);
  const persisted = readRosterFile(rosterPath);
  assert.equal(persisted.length, 1);
  assert.deepEqual(persisted[0], {
    accountID: 7,
    username: "test",
    characterID: 140000001,
    scriptID: "s1",
    scriptName: "Miner",
    startedAt: started.bot.startedAt,
  });
  await host.stop(started.bot.botID, 7);
  assert.equal(readRosterFile(rosterPath).length, 0);
});

test("resume restarts a persisted bot on a fresh host (the restart path)", async () => {
  const rosterPath = tempRosterPath();
  const before = makeHost({ persistPath: rosterPath });
  await before.start(START);
  // "The BFF restarted": a brand-new host, same file, no in-memory state.
  const after = makeHost({
    persistPath: rosterPath,
    loadAccount: async (username) => (username === "test" ? { ...ACCOUNT } : null),
    loadScript: (accountID, scriptID) =>
      accountID === 7 && scriptID === "s1"
        ? { scriptID: "s1", name: "Miner", doc: { valid: true } }
        : null,
  });
  await after.resume();
  const listed = after.list(7);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].status, "running");
  assert.notEqual(listed[0].resumedAt, null);
  assert.equal(after.claimedBy(140000001), listed[0].botID);
  // The file now names the NEW run.
  const persisted = readRosterFile(rosterPath);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].startedAt, listed[0].startedAt);
});

test("vitals sampling projects ship health, hold fill and the bot's words", async () => {
  const host = makeHost();
  await host.start(START);
  await host.sampleAllVitals();
  const rows = host.activeBots();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].characterID, 140000001);
  assert.equal(rows[0].status, "running");
  assert.equal(rows[0].phase, "Working");
  const vitals = rows[0].vitals;
  assert.equal(vitals.docked, false);
  assert.equal(vitals.shield, 0.9);
  assert.equal(vitals.armor, 1);
  assert.equal(vitals.hull, 1);
  // Only PRESENT holds are reported.
  assert.deepEqual(vitals.holds, [{ label: "Ore hold", used: 6000, capacity: 8000 }]);
  // Nothing controllable or identifying rides on the unauthenticated rows.
  assert.equal("botID" in rows[0], false);
  assert.equal("accountID" in rows[0], false);
  assert.equal("scriptID" in rows[0], false);
});

test("a bot whose script vanished leaves a visible error record, not silence", async () => {
  const rosterPath = tempRosterPath();
  const before = makeHost({ persistPath: rosterPath });
  await before.start(START);
  const after = makeHost({
    persistPath: rosterPath,
    loadAccount: async () => ({ ...ACCOUNT }),
    loadScript: () => null,
  });
  await after.resume();
  const listed = after.list(7);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].status, "error");
  assert.match(String(listed[0].why), /restarted/);
  assert.equal(after.claimedBy(140000001), null);
  // The failure is dropped from the roster file — it must not retry forever.
  assert.equal(readRosterFile(rosterPath).length, 0);
});
