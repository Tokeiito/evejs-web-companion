// The docked Station panel's ship actions (goal: the retail station-services
// strip). A docked character must be offered "Board your corvette" and
// "Leave ship", and a refused action's words (which land in
// inventory.actionError via the shared mutation path) must surface on THIS
// panel — the player pressed the button here, not on the Inventory tab.

import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./svelteSsrHook.ts", import.meta.url);

const { render } = await import("svelte/server");
const { createClientStore } = await import("../store/clientStore.ts");

/** No panel may call the flow during a server render — reads back no-ops. */
function fakeFlow(): unknown {
  return new Proxy({}, { get: () => async () => {} });
}

function dockedStore() {
  const store = createClientStore();
  store.apply({ type: "session/logged-in", accountID: 1, username: "rrfarmer" });
  store.apply({
    type: "character/online",
    character: {
      characterID: 90000001,
      characterName: "Farmer",
      stationID: 60003760,
      structureID: null,
      solarSystemID: 30000142,
      corporationID: 1000001,
    },
    station: null,
  });
  return store;
}

test("the docked station panel offers the corvette and leave-ship actions", async () => {
  const store = dockedStore();
  const { default: StationPanel } = (await import("./StationPanel.svelte")) as { default: unknown };
  const body = render(StationPanel as never, { props: { store, flow: fakeFlow() } } as never).body;

  assert.match(body, /Board your corvette/, "the corvette action is missing");
  assert.match(body, /Leave ship/, "the leave-ship action is missing");
});

test("a refused ship action's words surface on the station panel", async () => {
  const store = dockedStore();
  store.apply({
    type: "inventory/action-error",
    message: "You are already in your corvette.",
  });
  const { default: StationPanel } = (await import("./StationPanel.svelte")) as { default: unknown };
  const body = render(StationPanel as never, { props: { store, flow: fakeFlow() } } as never).body;

  assert.match(body, /You are already in your corvette\./, "the refusal words are not shown");
});
