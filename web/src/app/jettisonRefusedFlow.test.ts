// A dumping the server refuses, through the real flow over a faked BFF.
//
// The Mining window's dumping asks the BFF's route, which makes the client's one call (ship.Jettison). This server
// refuses a second jettison for three minutes after one: seen on the running server on 2026-10-12, on both
// transports, as 409 CALL_REFUSED with the message "ShpJettisonPending" and nothing else. The client has a notice
// of that name. The window is to say why, in the page's own words, and not that it was turned down for no reason.

import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";
import { SOLAR_SYSTEM_ID } from "./botFixtures.ts";
import { describeRefusal, UNKNOWN_REFUSAL_TEXT } from "../bridge/refusals.ts";

const JETTISON = "/api/bridge/ship/jettison";

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
    if (path === JETTISON) return Response.json(answer.body, { status: answer.status });
    return Response.json({ ok: true });
  } });
  return { flow, store, asked };
}

test("a dumping refused because the ship jettisoned a moment ago is said so in the Mining window, and not as a refusal with no reason", async () => {
  // As the BFF handed the server's refusal on, on both transports.
  const { flow, store, asked } = harness({ status: 409, body: { ok: false, error: "CALL_REFUSED", message: "ShpJettisonPending" } });

  await flow.jettisonItems([901, 902]);

  assert.deepEqual(asked.filter((each) => each.path === JETTISON), [{ path: JETTISON, body: { itemIDs: [901, 902], confirm: true } }]);
  const said = store.mining.get().actionError;
  assert.equal(said, "Jettison refused: Your ship jettisoned a container a moment ago and cannot launch another yet. Wait a few minutes, then try again.");
  // The sentence is the table's for that reason, and is not the one for a reason nobody knows.
  assert.equal(describeRefusal("ShpJettisonPending").text, "Your ship jettisoned a container a moment ago and cannot launch another yet. Wait a few minutes, then try again.");
  assert.ok(!String(said).includes(UNKNOWN_REFUSAL_TEXT));
  // The hold is not read again for a jettison that was refused: nothing went.
  assert.deepEqual(asked.map((each) => each.path).filter((path) => path !== JETTISON), []);
});

test("a dumping that is taken says nothing of a refusal", async () => {
  const { flow, store } = harness({ status: 200, body: { ok: true, applied: true, result: [[901], []], notifications: [] } });

  await flow.jettisonItems([901]);

  assert.equal(store.mining.get().actionError, null);
});
