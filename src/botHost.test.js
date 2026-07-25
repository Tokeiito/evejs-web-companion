"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
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
      const state = { station: { online: null }, customBot: { ...IDLE_SLICE } };
      const store = {
        _set(partial) {
          Object.assign(state, partial);
          for (const listener of listeners) {
            listener(state);
          }
        },
        station: { get: () => state.station },
        customBot: { get: () => state.customBot },
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
      };
    },
  });
}

function makeHost({ log = [], isCharacterHeld = () => false } = {}) {
  return createBotHost({
    webAuth: { createSessionToken: () => "bot-token" },
    baseUrl: "http://127.0.0.1:0",
    isCharacterHeld,
    errorLogger: () => {},
    loadStack: makeFakeStack(log),
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
