// The R12 Fitting controller against a faked BFF: loadFitting decodes the slot
// and resource reads into the store; fit / unfit / online / offline / destroy
// call their route and then RELOAD so the panel shows server truth; a thrown
// refusal surfaces the server's own reason; a SILENT decline is reported as a
// decline rather than a guessed cause; a lost session unwinds to offline.

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

/** Answers the fitting read, and whatever else the flow reloads, with 200s. */
function respondOk(extra: (path: string, method: string, body: Record<string, unknown>) => unknown = () => null) {
  return (path: string, method: string, body: Record<string, unknown>) => {
    if (path === "/api/bridge/fitting") {
      return { status: 200, body: fittingPanel() };
    }
    const custom = extra(path, method, body);
    if (custom !== null && custom !== undefined) {
      return custom as { status: number; body: unknown };
    }
    return { status: 200, body: { ok: true, applied: true } };
  };
}

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

test("fitModule addresses the slot by family and index, never by a flag ID", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch(respondOk());
  const flow = createAppFlow(store, { fetch });

  await flow.fitModule(7100, "hangar", { family: "high", index: 2 });

  const fit = requests.find((r) => r.path === "/api/bridge/fitting/fit");
  assert.ok(fit, "the fit route was called");
  assert.deepEqual(fit.body, { itemID: 7100, source: "hangar", family: "high", index: 2 });
  assert.equal(
    JSON.stringify(fit.body).includes("flag"),
    false,
    "no slot flag ID crosses the wire from the browser",
  );
  // The panel is re-read after the change, so it shows server truth.
  assert.ok(requests.some((r) => r.path === "/api/bridge/fitting" && r.method === "GET"));
});

test("fitting 'anywhere' asks the SERVER to pick the slot", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch(respondOk());
  const flow = createAppFlow(store, { fetch });

  await flow.fitModule(7100, "cargo", "auto");

  const fit = requests.find((r) => r.path === "/api/bridge/fitting/fit");
  assert.deepEqual(fit!.body, { itemID: 7100, source: "cargo", family: "auto" });
});

test("unfitModule sends the module back to the chosen container", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch(respondOk());
  const flow = createAppFlow(store, { fetch });

  await flow.unfitModule(5001, "hangar");

  const unfit = requests.find((r) => r.path === "/api/bridge/fitting/unfit");
  assert.deepEqual(unfit!.body, { itemID: 5001, destination: "hangar" });
  assert.equal(store.get().fitting.actionError, null);
});

// --- online / offline -------------------------------------------------------

test("online and offline are the same route with the state the player asked for", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch(respondOk());
  const flow = createAppFlow(store, { fetch });

  await flow.setModuleOnline(5001, true);
  await flow.setModuleOnline(5001, false);

  const states = requests
    .filter((r) => r.path === "/api/bridge/fitting/state")
    .map((r) => r.body);
  assert.deepEqual(states, [
    { itemID: 5001, online: true },
    { itemID: 5001, online: false },
  ]);
});

test("a refusal shows the SERVER'S OWN reason, not a guessed one", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch(
    respondOk((path) =>
      path === "/api/bridge/fitting/state"
        ? {
            status: 409,
            body: {
              ok: false,
              error: "CALL_REFUSED",
              message: "You do not have enough CPU to online that module.",
            },
          }
        : null,
    ),
  );
  const flow = createAppFlow(store, { fetch });

  await flow.setModuleOnline(5001, true);

  // ⚠ THIS TEST ONLY NOW DOES WHAT ITS NAME SAYS. It asserted `CALL_REFUSED`
  // — the envelope — while the handler's actual reason rode along inside the
  // same error and was dropped on the floor. R31 made the seam keep the
  // message, so the player reads dogma's own sentence about CPU.
  assert.equal(
    store.get().fitting.actionError,
    "You do not have enough CPU to online that module.",
  );
});

// --- the silent decline -----------------------------------------------------

test("a fit the server declines SILENTLY is reported as a decline, with no invented cause", async () => {
  // invbroker answers a skill-gated fit by returning null — no error, nothing
  // moved. The BFF re-reads the slots and says applied:false; the flow must
  // report that honestly rather than claim success or name a reason it does
  // not know.
  const store = createClientStore();
  const { fetch } = makeFakeFetch(
    respondOk((path) =>
      path === "/api/bridge/fitting/fit"
        ? { status: 200, body: { ok: true, applied: false } }
        : null,
    ),
  );
  const flow = createAppFlow(store, { fetch });

  await flow.fitModule(7100, "hangar", { family: "low", index: 0 });

  const message = store.get().fitting.actionError;
  assert.ok(message, "a silent decline is still surfaced to the player");
  assert.match(message!, /did not apply/i);
  assert.match(message!, /gave no reason/i);
  // It must not pretend to know why (no invented CPU / skill / slot claim).
  assert.equal(/cpu|powergrid|skill|slot/i.test(message!), false);
});

test("an applied change leaves no stale action error behind", async () => {
  const store = createClientStore();
  let applied = false;
  const { fetch } = makeFakeFetch(
    respondOk((path) =>
      path === "/api/bridge/fitting/fit" ? { status: 200, body: { ok: true, applied } } : null,
    ),
  );
  const flow = createAppFlow(store, { fetch });

  await flow.fitModule(7100, "hangar", { family: "low", index: 0 });
  assert.ok(store.get().fitting.actionError, "the declined attempt is recorded");

  applied = true;
  await flow.fitModule(7100, "hangar", { family: "low", index: 1 });
  assert.equal(store.get().fitting.actionError, null, "the successful one clears it");
});

// --- the destructive rig path ----------------------------------------------

test("destroyRig always sends an explicit confirmation", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch(respondOk());
  const flow = createAppFlow(store, { fetch });

  await flow.destroyRig(5004);

  const destroy = requests.find((r) => r.path === "/api/bridge/fitting/destroy-rig");
  assert.ok(destroy, "the destroy route was called");
  assert.equal(destroy.body.confirm, true, "never without an explicit confirmation");
  assert.equal(destroy.body.itemID, 5004);
});

test("no fitting action ever runs against a route that was not asked for", async () => {
  // A guard against a mis-wired button: each action hits exactly one mutating
  // route (plus the read that follows it).
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch(respondOk());
  const flow = createAppFlow(store, { fetch });

  await flow.unfitModule(5001, "cargo");

  const mutations = requests.filter((r) => r.method === "POST").map((r) => r.path);
  assert.deepEqual(mutations, ["/api/bridge/fitting/unfit"]);
});
