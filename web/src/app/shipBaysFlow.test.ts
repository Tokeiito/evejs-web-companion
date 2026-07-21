// R40 — opening a ship and reading its bays, end to end through the flow.
//
// The decoder is tested next to itself (bridge/shipBays.test.ts) and the cards
// are tested as markup (ui/inventoryCards.test.ts). What is left, and what only
// this layer can pin, is the ROUND TRIP: which URL is called, what lands in the
// store, and — the part with real logic in it — what happens when the answers
// come back out of order.
//
// The fixture is the literal body `GET /api/bridge/ship/:shipID/bays` returned
// for Farmer's Procurer on 2026-07-21.

import test from "node:test";
import assert from "node:assert/strict";
import { createClientStore } from "../store/clientStore.ts";
import { createAppFlow } from "./flow.ts";

const PROCURER_ID = 9988400023309;
const RUPTURE_ID = 9988400091901;
const VELDSPAR_TYPE = 1230;

function baysBody(shipID: number) {
  return {
    ok: true,
    shipID,
    activeShipID: PROCURER_ID,
    bays: [
      { key: "cargo", label: "Cargo hold", present: true, capacity: { capacity: 350, used: 0 }, items: [], error: null },
      {
        key: "ore",
        label: "Ore hold",
        present: true,
        capacity: { capacity: 16000, used: 12375.2 },
        items: [
          { itemID: 9988400092033, typeID: VELDSPAR_TYPE, groupID: 462, categoryID: 25, quantity: 123752, singleton: false },
        ],
        error: null,
      },
      { key: "fleet", label: "Fleet hangar", present: false, capacity: { capacity: 0, used: 0 }, items: null, error: null },
    ],
  };
}

interface Recorded {
  readonly path: string;
}

function fakeFetch(
  responder: (path: string) => { status: number; body: unknown },
): { fetch: typeof fetch; requests: Recorded[] } {
  const requests: Recorded[] = [];
  const impl = (async (input: unknown) => {
    const path = String(input);
    requests.push({ path });
    const outcome = responder(path);
    return {
      ok: outcome.status >= 200 && outcome.status < 300,
      status: outcome.status,
      async json() {
        return outcome.body;
      },
    };
  }) as unknown as typeof fetch;
  return { fetch: impl, requests };
}

function ok(shipID: number) {
  return fakeFetch((path) => {
    if (path.startsWith("/api/bridge/ship/") && path.endsWith("/bays")) {
      return { status: 200, body: baysBody(shipID) };
    }
    return { status: 200, body: { ok: true } };
  });
}

test("opening a ship reads ITS bays, by that ship's own id", async () => {
  const store = createClientStore();
  const net = ok(PROCURER_ID);
  const flow = createAppFlow(store, { fetch: net.fetch });

  await flow.openShipBays(PROCURER_ID);

  assert.deepEqual(
    net.requests.map((r) => r.path),
    [`/api/bridge/ship/${PROCURER_ID}/bays`],
    "one read, addressed to the ship the player clicked",
  );
  const open = store.get().inventory.openShip;
  assert.equal(open?.itemID, PROCURER_ID);
  assert.equal(open?.loaded, true);
  assert.equal(open?.error, null);
  assert.equal(open?.bays.length, 3, "every bay asked about is kept, present or not");
  assert.deepEqual(
    open?.bays.filter((bay) => bay.present === true).map((bay) => bay.label),
    ["Cargo hold", "Ore hold"],
  );
  assert.equal(
    open?.bays.find((bay) => bay.key === "ore")?.capacity?.used,
    12375.2,
    "the server's own fill survives the round trip",
  );
});

test("closing the card clears the open ship without another read", async () => {
  const store = createClientStore();
  const net = ok(PROCURER_ID);
  const flow = createAppFlow(store, { fetch: net.fetch });

  await flow.openShipBays(PROCURER_ID);
  await flow.openShipBays(null);

  assert.equal(store.get().inventory.openShip, null);
  assert.equal(net.requests.length, 1, "closing asks the server nothing");
});

test("⚠ a read that FAILS leaves the ship unknown — not a ship with no bays", async () => {
  const store = createClientStore();
  const net = fakeFetch(() => ({
    status: 500,
    body: { ok: false, error: "CALL_REFUSED", message: "refused" },
  }));
  const flow = createAppFlow(store, { fetch: net.fetch });

  await flow.openShipBays(PROCURER_ID);

  const open = store.get().inventory.openShip;
  assert.equal(open?.itemID, PROCURER_ID, "the card stays on the ship the player picked");
  assert.equal(open?.loaded, true);
  assert.ok(open?.error, "and carries the reason it could not answer");
  assert.deepEqual(open?.bays, [], "with no bays claimed either way");
});

test("⚠ a late reply for a ship the player has left does NOT repaint the new one", async () => {
  // The store guard: two reads in flight, the first answering last. Without it
  // the Rupture's card would fill with the Procurer's ore hold.
  const store = createClientStore();
  let release: (() => void) | null = null;
  const slow = new Promise<void>((resolve) => {
    release = resolve;
  });
  let call = 0;
  const impl = (async (input: unknown) => {
    const path = String(input);
    call += 1;
    if (call === 1) {
      await slow;
      return { ok: true, status: 200, async json() { return baysBody(PROCURER_ID); } };
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return { ok: true, shipID: RUPTURE_ID, bays: [] };
      },
    };
  }) as unknown as typeof fetch;
  const flow = createAppFlow(store, { fetch: impl });

  const first = flow.openShipBays(PROCURER_ID);
  // The player moves on before the first answer lands.
  await flow.openShipBays(RUPTURE_ID);
  release!();
  await first;

  const open = store.get().inventory.openShip;
  assert.equal(open?.itemID, RUPTURE_ID, "the card is still on the ship the player chose");
  assert.deepEqual(
    open?.bays.map((bay) => bay.label),
    [],
    "the stale Procurer bays were dropped, not painted onto the Rupture",
  );
});

test("opening a DIFFERENT ship does not show the previous ship's bays meanwhile", async () => {
  const store = createClientStore();
  const net = ok(PROCURER_ID);
  const flow = createAppFlow(store, { fetch: net.fetch });

  await flow.openShipBays(PROCURER_ID);
  assert.equal(store.get().inventory.openShip?.bays.length, 3);

  // Mid-flight state for the next ship: opened, not yet answered.
  store.apply({ type: "inventory/ship-open", itemID: RUPTURE_ID, typeID: 629 });
  const open = store.get().inventory.openShip;
  assert.equal(open?.itemID, RUPTURE_ID);
  assert.equal(open?.loaded, false, "and it says so, rather than looking empty");
  assert.deepEqual(open?.bays, [], "the previous hull's bays are gone");
});
