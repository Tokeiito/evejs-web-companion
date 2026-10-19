// The R12 Fitting controller against a faked BFF: loadFitting decodes the slot
// and resource reads into the store; a module is fitted and unfitted by the
// page's own call as the client makes it (bridge/fitModule.ts), and a rig is
// destroyed by its route, each then RELOADING so the panel shows server truth;
// a thrown refusal surfaces the server's own reason; a SILENT decline is
// reported as a decline rather than a guessed cause; a lost session unwinds to
// offline.

import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";
import { slotsOfFamily } from "../bridge/fitting.ts";

function packedRow(fields: Record<string, unknown>): unknown {
  return { type: "packedrow", fields };
}

/** A Punisher: 4 high / 2 mid / 5 low / 3 rig, docked (capacitor via charge). */
function shipInfo(overrides: Record<number, number | null> = {}) {
  const attributes: Record<number, number | null> = {
    48: 168,
    49: 3.6,
    11: 88.44,
    15: 6,
    482: null,
    18: 460,
    1132: 400,
    1152: 100,
    14: 4,
    13: 2,
    12: 5,
    1137: 3,
    ...overrides,
  };
  return {
    type: "dict",
    entries: [
      [
        9001,
        {
          type: "object",
          name: "util.KeyVal",
          args: {
            type: "dict",
            entries: [
              ["itemID", 9001],
              [
                "attributes",
                {
                  type: "dict",
                  entries: Object.entries(attributes).map(([id, value]) => [Number(id), value]),
                },
              ],
            ],
          },
        },
      ],
    ],
  };
}

function fittingPanel(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    activeShipID: 9001,
    stationID: 60003760,
    slots: {
      type: "list",
      items: [
        packedRow({ itemID: 5001, typeID: 3634, groupID: 53, flagID: 27 }),
        packedRow({ itemID: 5004, typeID: 31358, groupID: 781, flagID: 92 }),
      ],
    },
    shipInfo: shipInfo(),
    online: { type: "list", items: [5001] },
    errors: { slots: null, shipInfo: null, online: null },
    ...overrides,
  };
}

interface Recorded {
  readonly path: string;
  readonly method: string;
  readonly body: Record<string, unknown>;
}

function makeFakeFetch(
  responder: (path: string, method: string, body: Record<string, unknown>) => {
    status: number;
    body: unknown;
  },
): { fetch: typeof fetch; requests: Recorded[] } {
  const requests: Recorded[] = [];
  const fakeFetch = (async (input: unknown, init?: { method?: string; body?: unknown }) => {
    const path = String(input);
    const method = (init && init.method) || "GET";
    const body = init && typeof init.body === "string" ? JSON.parse(init.body) : {};
    requests.push({ path, method, body });
    const outcome = responder(path, method, body);
    return {
      ok: outcome.status >= 200 && outcome.status < 300,
      status: outcome.status,
      async json() {
        return outcome.body;
      },
    };
  }) as unknown as typeof fetch;
  return { fetch: fakeFetch, requests };
}

/**
 * Answers what `extra` answers first; then the fitting read, the generic call as the live server answers a thing
 * moved into an inventory (the thing's own number), and whatever else the flow reloads, with 200s.
 */
function respondOk(extra: (path: string, method: string, body: Record<string, unknown>) => unknown = () => null) {
  return (path: string, method: string, body: Record<string, unknown>) => {
    const custom = extra(path, method, body);
    if (custom !== null && custom !== undefined) {
      return custom as { status: number; body: unknown };
    }
    if (path === "/api/bridge/fitting") {
      return { status: 200, body: fittingPanel() };
    }
    if (path === "/api/bridge/call") {
      const args = Array.isArray(body.args) ? body.args : [];
      return { status: 200, body: { ok: true, service: body.service, method: body.method, result: args[0] ?? null, notifications: [] } };
    }
    return { status: 200, body: { ok: true, applied: true } };
  };
}

/** A pilot in ship 9001, docked at Jita (60003760) or in space (null), as the store has it once a character is chosen. */
function pilotOnline(store: ReturnType<typeof createClientStore>, stationID: number | null): void {
  store.apply({
    type: "character/online",
    character: {
      characterID: 90000001,
      characterName: "Synthetic Pilot",
      stationID,
      structureID: null,
      solarSystemID: 30000142,
      corporationID: 98000001,
    },
    station: null,
  });
}

/** A flow for the pilot, docked at Jita unless said, its fitting read once, so that the ship and where it lies are known. */
async function dockedFlow(responder: Parameters<typeof makeFakeFetch>[0], stationID: number | null = 60003760) {
  const store = createClientStore();
  pilotOnline(store, stationID);
  const { fetch, requests } = makeFakeFetch(responder);
  const flow = createAppFlow(store, { fetch });
  await flow.loadFitting();
  requests.length = 0;
  return { store, flow, requests };
}

/** The page's own calls on an inventory, as the requests carried them. */
const inventoryCalls = (requests: readonly Recorded[]) =>
  requests.filter((r) => r.path === "/api/bridge/call" && r.body.service === "invbroker").map((r) => r.body);

// --- the read ---------------------------------------------------------------

test("loadFitting decodes the slots and the resource readings into the store", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch(respondOk());
  const flow = createAppFlow(store, { fetch });

  await flow.loadFitting();

  const fitting = store.get().fitting;
  assert.equal(fitting.loaded, true);
  assert.equal(fitting.activeShipID, 9001);

  const high = slotsOfFamily(fitting.slots, "high");
  assert.equal(high.length, 4, "all four high slots are shown");
  assert.equal(high[0]!.module?.typeID, 3634);
  assert.equal(high[0]!.module?.online, true);
  assert.equal(high[1]!.module, null, "an empty slot is visible as empty");

  assert.equal(slotsOfFamily(fitting.slots, "rig")[0]!.module?.typeID, 31358);

  assert.equal(fitting.resources.cpu.used, 3.6);
  assert.equal(fitting.resources.cpu.total, 168);
  assert.equal(fitting.resources.powergrid.total, 88.44);
  assert.equal(fitting.resources.calibration.used, 100);
  assert.equal(fitting.resources.capacitor.total, 460, "docked capacitor via charge");
});

test("a failed resource read still shows the fit (and each error is kept apart)", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch(() => ({
    status: 200,
    body: fittingPanel({
      shipInfo: null,
      errors: { slots: null, shipInfo: "READ_FAILED", online: null },
    }),
  }));
  const flow = createAppFlow(store, { fetch });

  await flow.loadFitting();

  const fitting = store.get().fitting;
  assert.equal(fitting.resourcesError, "READ_FAILED");
  assert.equal(fitting.slotsError, null);
  // Without slot counts there are no empty slots to draw, but the modules that
  // ARE fitted still show — the fit is never blanked by a resource failure.
  assert.equal(
    fitting.slots.filter((slot) => slot.module !== null).length,
    2,
    "both fitted modules survive",
  );
});

test("a lost session during a fitting read unwinds to character select", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch(() => ({
    status: 404,
    body: { ok: false, error: "SESSION_NOT_FOUND", message: "gone" },
  }));
  const flow = createAppFlow(store, { fetch });

  await assert.rejects(() => flow.loadFitting());
  assert.equal(store.get().station.online, null, "back to the character list");
});

// --- fitting and unfitting --------------------------------------------------
//
// A module is fitted and unfitted by the page's own call since 2026-10-13, on an inventory's own object
// (bridge/fitModule.ts). The routes the tests here held the flow to (POST /api/bridge/fitting/fit and .../unfit)
// are gone, and so is their rule that no slot's flag crosses from the page: the client names the flag itself. The
// calls are held to the client's own, by its lines.

test("a module is fitted into a slot as the client fits it: the ship's own inventory's Add, the item, where it lies, one of it, the slot's flag", async () => {
  const { flow, requests } = await dockedFlow(respondOk());

  await flow.fitModule(7100, "hangar", { family: "high", index: 2 });

  // clientDogmaLocation.TryFit (669 to 673): invCache.GetInventoryFromId(shipID).Add(item.itemID,
  // item.locationID, qty=1, flag=flagID), the third high slot being flagHiSlot2, 29.
  assert.deepEqual(inventoryCalls(requests), [
    { service: "invbroker", method: "Add", args: [7100, 60003760], kwargs: { qty: 1, flag: 29 }, pilot: true, confirm: true, of: 9001 },
  ]);
  // The panel is re-read after the change, so it shows server truth.
  const call = requests.findIndex((r) => r.path === "/api/bridge/call");
  assert.ok(requests.slice(call + 1).some((r) => r.path === "/api/bridge/fitting" && r.method === "GET"));
});

test("a module fitted to no slot of the ship's is the client's MultiAdd, with the server to pick", async () => {
  const { flow, requests } = await dockedFlow(respondOk());

  await flow.fitModule(7100, "cargo", "auto");

  // fittingUtil.TryFit (157) and the fitting screen's FitModule (tryFit.py 135):
  // shipInv.moniker.MultiAdd(itemIDs, sourceID, flag=const.flagAutoFit), from the ship's own hold here.
  assert.deepEqual(inventoryCalls(requests), [
    { service: "invbroker", method: "MultiAdd", args: [[7100], 9001], kwargs: { flag: 0 }, pilot: true, confirm: true, of: 9001 },
  ]);
});

/** The fitting read once a call has been made: the turret in high slot 0 (5001) gone, the rig still there. */
function unfittedOnceCalled() {
  let called = false;
  return (path: string) => {
    if (path === "/api/bridge/call") called = true;
    return path === "/api/bridge/fitting" && called
      ? { status: 200, body: fittingPanel({ slots: { type: "list", items: [packedRow({ itemID: 5004, typeID: 31358, groupID: 781, flagID: 92 })] } }) }
      : null;
  };
}

test("a module unfitted docked goes to the hangar's own inventory, with no quantity named", async () => {
  const { store, flow, requests } = await dockedFlow(respondOk(unfittedOnceCalled()));

  await flow.unfitModule(5001);

  // fittingSlotController.UnfitModule (237, 238): docked,
  // invCache.GetInventory(const.containerHangar).Add(moduleID, shipID, flag=const.flagHangar).
  assert.deepEqual(inventoryCalls(requests), [
    { service: "invbroker", method: "Add", args: [5001, 9001], kwargs: { flag: 4 }, pilot: true, confirm: true, of: "hangar" },
  ]);
  assert.equal(store.get().fitting.actionError, null);
});

test("a module unfitted in space goes to the ship's own hold, with a quantity of None", async () => {
  const { store, flow, requests } = await dockedFlow(respondOk(unfittedOnceCalled()), null);

  await flow.unfitModule(5001);

  // fittingSlotController.UnfitModule (239 to 241): in space,
  // invCache.GetInventoryFromId(parentID).Add(moduleID, parentID, qty=None, flag=const.flagCargo).
  assert.deepEqual(inventoryCalls(requests), [
    { service: "invbroker", method: "Add", args: [5001, 9001], kwargs: { qty: null, flag: 5 }, pilot: true, confirm: true, of: 9001 },
  ]);
  assert.equal(store.get().fitting.actionError, null);
});

// --- online / offline -------------------------------------------------------
//
// The flow makes the client's own call for a module put online or taken offline since 2026-10-13
// (bridge/dogmaWrites.ts, setModuleOnline). Two tests here held it to the route that did it before
// (POST /api/bridge/fitting/state), and went with the route.

// --- the silent decline -----------------------------------------------------

test("a fit the server declines SILENTLY is reported as a decline, with no invented cause", async () => {
  // The server answers some fits with nothing and moves nothing (seen live on
  // 2026-10-13: a thing that is not there, fitted, answered None). The flow
  // reads the slots before and after; it must report that honestly rather than
  // claim success or name a reason it does not know.
  const { store, flow } = await dockedFlow(
    respondOk((path, _method, body) =>
      path === "/api/bridge/call"
        ? { status: 200, body: { ok: true, service: body.service, method: body.method, result: null, notifications: [] } }
        : null,
    ),
  );

  await flow.fitModule(7100, "hangar", { family: "low", index: 0 });

  const message = store.get().fitting.actionError;
  assert.ok(message, "a silent decline is still surfaced to the player");
  assert.match(message!, /did not apply/i);
  assert.match(message!, /gave no reason/i);
  // It must not pretend to know why (no invented CPU / skill / slot claim).
  assert.equal(/cpu|powergrid|skill|slot/i.test(message!), false);
});

test("an applied change leaves no stale action error behind", async () => {
  // The slots say whether a fit landed: until `landed`, the module is in none of them.
  let landed = false;
  const { store, flow } = await dockedFlow(
    respondOk((path) =>
      path === "/api/bridge/fitting" && landed
        ? {
            status: 200,
            body: fittingPanel({
              slots: {
                type: "list",
                items: [
                  packedRow({ itemID: 5001, typeID: 3634, groupID: 53, flagID: 27 }),
                  packedRow({ itemID: 5004, typeID: 31358, groupID: 781, flagID: 92 }),
                  packedRow({ itemID: 7100, typeID: 2048, groupID: 60, flagID: 12 }),
                ],
              },
            }),
          }
        : null,
    ),
  );

  await flow.fitModule(7100, "hangar", { family: "low", index: 0 });
  assert.ok(store.get().fitting.actionError, "the declined attempt is recorded");

  landed = true;
  await flow.fitModule(7100, "hangar", { family: "low", index: 1 });
  assert.equal(store.get().fitting.actionError, null, "the successful one clears it");
});

// --- the destructive rig path ----------------------------------------------

test("destroyRig is the page's own call on the ship's own inventory, and only for a rig", async () => {
  // fittingSlotController.Unfit (262): parentInv.DestroyFitting(moduleID) on the ship's own inventory, the page's
  // own call since 2026-10-14, made once the slots say the module is in a rig slot.
  const { flow, requests } = await dockedFlow(respondOk());

  await flow.destroyRig(5004);
  assert.deepEqual(inventoryCalls(requests), [
    { service: "invbroker", method: "DestroyFitting", args: [5004], kwargs: null, pilot: true, confirm: true, of: 9001 },
  ]);

  requests.length = 0;
  await flow.destroyRig(5001);
  assert.deepEqual(inventoryCalls(requests), [], "a module in no rig slot is asked nothing");
});

test("no fitting action ever runs against a route that was not asked for", async () => {
  // A guard against a mis-wired button: an unfitting of a module with no charge
  // and in no weapon bank makes exactly one write, the page's own call (plus the
  // reads of the slots around it).
  const { flow, requests } = await dockedFlow(respondOk());

  await flow.unfitModule(5001);

  const mutations = requests.filter((r) => r.method === "POST").map((r) => r.path);
  assert.deepEqual(mutations, ["/api/bridge/call"]);
});
