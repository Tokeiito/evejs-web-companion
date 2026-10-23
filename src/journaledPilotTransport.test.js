"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { journaledPilotTransport } = require("./journaledPilotTransport");
const { createPilotMutationFence } = require("./pilotMutationFence");
const { createPilotTransport } = require("./pilotTransport");

test("selection records exact identity and only confirmed releases remove its obligation", async () => {
  const pending = new Map();
  const journal = { track(row) { pending.set(row.bridgeSessionID, row); }, confirmReleased(handle) { pending.delete(handle); } };
  let verdict = { released: false };
  const selected = { bridgeSessionID: "factory-owned", session: { characterID: 9 } };
  const transport = journaledPilotTransport({
    async selectCharacter() { return selected; },
    async releaseBridgeSession() { if (verdict instanceof Error) throw verdict; return verdict; },
  }, journal);
  assert.equal(await transport.selectCharacter([9, null, true], null, { userid: 4 }), selected);
  assert.deepEqual([...pending.values()], [{ bridgeSessionID: "factory-owned", accountID: 4, characterID: 9 }]);
  await transport.releaseBridgeSession("factory-owned", { userid: 4 });
  assert.equal(pending.size, 1, "a false acknowledgement leaves recovery necessary");
  verdict = Object.assign(new Error("timeout"), { code: "EVE_GATEWAY_TIMEOUT" });
  await assert.rejects(transport.releaseBridgeSession("factory-owned", { userid: 4 }), (error) => error === verdict);
  assert.equal(pending.size, 1);
  verdict = { released: true };
  await transport.releaseBridgeSession("factory-owned", { userid: 4 });
  assert.equal(pending.size, 0);
  await transport.selectCharacter([9, null, true], null, { userid: 4 });
  verdict = Object.assign(new Error("gone"), { code: "SESSION_NOT_FOUND" });
  await assert.rejects(transport.releaseBridgeSession("factory-owned", { userid: 4 }), (error) => error === verdict);
  assert.equal(pending.size, 0, "a missing exact handle is no longer owned");
});

test("the journal seam preserves transport receivers and remains inside the mutation fence", async () => {
  let tracked = 0, selected = 0;
  class Transport {
    #value = 42;
    readValue() { return this.#value; }
    async selectCharacter() { selected++; return { bridgeSessionID: "never-selected", session: { characterID: 9 } }; }
  }
  const trackedTransport = journaledPilotTransport(new Transport(), { track() { tracked++; }, confirmReleased() {} });
  const fence = createPilotMutationFence({ heldSessions: new Map(), assertWritable() { throw new Error("blocked by custody"); } });
  const transport = fence.wrap(trackedTransport);
  assert.equal(transport.readValue(), 42);
  assert.throws(() => transport.selectCharacter([9, null, true], null, { userid: 4 }), /blocked by custody/);
  assert.equal(selected, 0);
  assert.equal(tracked, 0);
});

test("exact native handles retain their game-port release routing through the journal seam", async () => {
  const calls = [];
  const gamePort = {
    async selectCharacter() { return { bridgeSessionID: "gp:factory", session: { characterID: 9 } }; },
    async releaseBridgeSession(handle, fields) { calls.push([handle, fields.userid]); return { released: true }; },
  };
  const transport = journaledPilotTransport(createPilotTransport({
    gateway: { releaseBridgeSession() { assert.fail("A native handle must not be sent to the HTTP gateway."); } },
    gamePort, transportFor: () => "gameport",
  }), { track(row) { calls.push([row.bridgeSessionID, row.accountID]); }, confirmReleased(handle) { calls.push(["confirmed", handle]); } });
  await transport.selectCharacter([9, null, true], null, { userid: 4 });
  await transport.releaseBridgeSession("gp:factory", { userid: 4 });
  assert.deepEqual(calls, [["gp:factory", 4], ["gp:factory", 4], ["confirmed", "gp:factory"]]);
});
