// A dumping the server refuses, through the real flow over a faked BFF.
//
// The Mining window's dumping is the page's own call since 2026-10-14 (bridge/shipWrites.ts, jettison: the client's
// GetShipAccess().Jettison(itemIDs), invItemFunctions.py 63), made by the generic call after a read of the flight
// (until then the BFF's route made it). This server
// refuses a second jettison for three minutes after one: seen on the running server on 2026-10-12, on both
// transports, as 409 CALL_REFUSED with the message "ShpJettisonPending" and nothing else. The client has a notice
// of that name. The window is to say why, in the page's own words, and not that it was turned down for no reason.

import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";
import { SOLAR_SYSTEM_ID } from "./botFixtures.ts";
import { describeRefusal, UNKNOWN_REFUSAL_TEXT } from "../bridge/refusals.ts";

const CALL = "/api/bridge/call";
const FLIGHT = "/api/bridge/flight/status";
const jettisonOf = (itemIDs: readonly number[]) => ({ service: "ship", method: "Jettison", args: [itemIDs], kwargs: null, pilot: true, confirm: true });
const list = (items: readonly number[]) => ({ type: "list", items });

/** A flow for a pilot in space, over a BFF that answers a jettison with `answer`. */
function harness(answer: { readonly status: number; readonly body: unknown }) {
  const store = createClientStore();
  store.apply({ type: "character/online", character: {
    characterID: 140000001, characterName: "Test", stationID: null,
    structureID: null, solarSystemID: SOLAR_SYSTEM_ID, corporationID: 1000044,
  }, station: null });
  const asked: { readonly path: string; readonly body: unknown }[] = [];
  const flow = createAppFlow(store, { livePush: false, perSessionToken: true, initialSessionToken: "pilot", fetch: async (input, init) => {
    const path = String(input);
    asked.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (path === FLIGHT) return Response.json({ ok: true, flight: { inSpace: true, shipID: 9001, solarSystemID: SOLAR_SYSTEM_ID } });
    if (path === CALL) return Response.json(answer.body, { status: answer.status });
    return Response.json({ ok: true });
  } });
  return { flow, store, asked };
}

test("a dumping refused because the ship jettisoned a moment ago is said so in the Mining window, and not as a refusal with no reason", async () => {
  // As the BFF handed the server's refusal on, on both transports.
  const { flow, store, asked } = harness({ status: 409, body: { ok: false, error: "CALL_REFUSED", message: "ShpJettisonPending" } });

  await flow.jettisonItems([901, 902]);

  assert.deepEqual(asked.filter((each) => each.path === CALL), [{ path: CALL, body: jettisonOf([901, 902]) }]);
  const said = store.mining.get().actionError;
  assert.equal(said, "Jettison refused: Your ship jettisoned a container a moment ago and cannot launch another yet. Wait a few minutes, then try again.");
  // The sentence is the table's for that reason, and is not the one for a reason nobody knows.
  assert.equal(describeRefusal("ShpJettisonPending").text, "Your ship jettisoned a container a moment ago and cannot launch another yet. Wait a few minutes, then try again.");
  assert.ok(!String(said).includes(UNKNOWN_REFUSAL_TEXT));
  // The hold is not read again for a jettison that was refused: nothing went. The flight was read before it.
  assert.deepEqual(asked.map((each) => each.path).filter((path) => path !== CALL), [FLIGHT]);
});

test("a dumping that is taken says nothing of a refusal", async () => {
  const { flow, store } = harness({ status: 200, body: { ok: true, service: "ship", method: "Jettison", result: [list([901]), list([])], notifications: [] } });

  await flow.jettisonItems([901]);

  assert.equal(store.mining.get().actionError, null);
  assert.equal(store.mining.get().silentDecline, null);
});

// The client reads its answer as (jettisonedToCanIDs, jettisonItemList), and an item asked for and in neither did
// not go (invItemFunctions.py 63 to 72, NotAllItemsWereJettisoned).
test("a dumping answered with a stack in neither list says that stack stayed", async () => {
  const { flow, store } = harness({ status: 200, body: { ok: true, service: "ship", method: "Jettison", result: [list([901]), list([])], notifications: [] } });

  await flow.jettisonItems([901, 902]);

  assert.equal(store.mining.get().actionError, null);
  assert.equal(store.mining.get().silentDecline, "Only 1 of 2 stacks were jettisoned. The server did not say why the rest stayed.");
});
