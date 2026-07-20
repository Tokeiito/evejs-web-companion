// The fitting window as it actually RENDERS (goal R21).
//
// fittingGeometry.test.ts pins the maths; this pins that the panel is wired to
// it — that the ring the player sees has exactly the sockets the SERVER's slot
// counts imply, on two different hulls, with no 8/8/8 anywhere.

import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

register("./svelteSsrHook.ts", import.meta.url);

const { render } = await import("svelte/server");
const { createClientStore } = await import("../store/clientStore.ts");
const { createAppFlow } = await import("../app/flow.ts");

const UI_DIR = path.dirname(fileURLToPath(import.meta.url));

function packedRow(fields: Record<string, unknown>): unknown {
  return { type: "packedrow", fields };
}

/**
 * A `GET /api/bridge/fitting` envelope in raw retail shapes, for a hull with
 * the given slot counts. Everything the panel draws comes from here — this is
 * the SERVER speaking.
 */
function rawFittingRead(
  counts: { high: number; mid: number; low: number; rig: number },
  fitted: readonly { itemID: number; typeID: number; flagID: number }[] = [],
): unknown {
  const attributes: Record<number, number | null> = {
    48: 168,
    49: 3.6,
    11: 88.44,
    15: 6,
    482: null,
    18: 460,
    1132: 400,
    1152: 100,
    14: counts.high,
    13: counts.mid,
    12: counts.low,
    1137: counts.rig,
  };
  return {
    ok: true,
    activeShipID: 9988400029047,
    stationID: 60003760,
    slots: {
      type: "list",
      items: fitted.map((row) => packedRow({ ...row, groupID: 53 })),
    },
    shipInfo: {
      type: "dict",
      entries: [
        [
          9988400029047,
          {
            type: "object",
            name: "util.KeyVal",
            args: {
              type: "dict",
              entries: [
                ["itemID", 9988400029047],
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
    },
    online: { type: "list", items: fitted.length > 0 ? [fitted[0]!.itemID] : [] },
    errors: { slots: null, shipInfo: null, online: null },
  };
}

function fittingFetch(envelope: unknown): typeof fetch {
  return (async (input: unknown) => ({
    ok: true,
    status: 200,
    async json() {
      return String(input) === "/api/bridge/fitting" ? envelope : { ok: true, applied: true };
    },
  })) as unknown as typeof fetch;
}

async function renderFitting(envelope: unknown): Promise<string> {
  const store = createClientStore();
  const flow = createAppFlow(store, { fetch: fittingFetch(envelope) });
  await flow.loadFitting();
  const { default: Panel } = (await import("./Fitting.svelte")) as { default: unknown };
  return render(Panel as never, { props: { store, flow } } as never).body;
}

/**
 * How many sockets the ring drew. Anchored on the socket BUTTON's class, which
 * always begins `fit-socket ` — a looser pattern also catches the
 * `fit-socket-text` span inside each one and silently doubles the count.
 */
function socketCount(body: string): number {
  return (body.match(/class="fit-socket /g) ?? []).length;
}

test("the ring draws exactly the sockets the server's slot counts imply", async () => {
  // A Rifter: 4 high / 3 mid / 3 low / 3 rig = 13 sockets.
  const rifter = await renderFitting(rawFittingRead({ high: 4, mid: 3, low: 3, rig: 3 }));
  assert.equal(socketCount(rifter), 13);

  // A Drake: 8 / 6 / 5 / 3 = 22. Same component, a different ring — which is
  // only possible if the counts really do come from the read.
  const drake = await renderFitting(rawFittingRead({ high: 8, mid: 6, low: 5, rig: 3 }));
  assert.equal(socketCount(drake), 22);
});

test("every socket is positioned by the geometry, not by a stylesheet guess", async () => {
  const body = await renderFitting(rawFittingRead({ high: 4, mid: 3, low: 3, rig: 3 }));
  const positioned = body.match(/left: [\d.]+%; top: [\d.]+%/g) ?? [];
  assert.equal(positioned.length, 13, "each socket carries its own computed position");
  // The positions are genuinely different from one another.
  assert.equal(new Set(positioned).size, 13);
});

test("the ring names the slot families and reports how many are filled", async () => {
  const body = await renderFitting(
    rawFittingRead({ high: 4, mid: 3, low: 3, rig: 3 }, [
      { itemID: 5001, typeID: 3634, flagID: 27 },
      { itemID: 5004, typeID: 31358, flagID: 92 },
    ]),
  );
  assert.match(body, /High slots: 1 of 4 filled/);
  assert.match(body, /Mid slots: 0 of 3 filled/);
  assert.match(body, /Rigs: 1 of 3 filled/);
});

test("a socket says in words which slot it is and what state it is in", async () => {
  const body = await renderFitting(
    rawFittingRead({ high: 4, mid: 3, low: 3, rig: 3 }, [
      { itemID: 5001, typeID: 3634, flagID: 27 },
      { itemID: 5002, typeID: 3634, flagID: 28 },
    ]),
  );
  // Slot 1 is online (it is in the `online` list), slot 2 is not.
  assert.match(body, /High slot 1, .*, online/);
  assert.match(body, /High slot 2, .*, offline/);
  assert.match(body, /High slot 3, empty/);
  // Rigs have no online state to speak of, so they never claim one.
  assert.match(body, /Rig 1, empty/);
});

test("a hull with no rigs and no subsystems draws neither", async () => {
  const body = await renderFitting(rawFittingRead({ high: 2, mid: 1, low: 1, rig: 0 }));
  assert.equal(socketCount(body), 4);
  assert.doesNotMatch(body, /Rigs:/);
  assert.doesNotMatch(body, /Subsystems:/);
});

test("R7d: the ring never renders a raw numeric ID", async () => {
  const body = await renderFitting(
    rawFittingRead({ high: 4, mid: 3, low: 3, rig: 3 }, [
      { itemID: 5001, typeID: 3634, flagID: 27 },
    ]),
  );
  // The ship's itemID, the module's itemID and its flagID are all absent from
  // anything the player can read. (The typeID appears only inside the icon's
  // src, which is an asset path and not data on screen — asserted separately.)
  assert.equal(body.includes("9988400029047"), false);
  assert.equal(body.includes("5001"), false);
  const visible = body.replace(/<img[^>]*>/g, "").replace(/<[^>]+>/g, " ");
  assert.equal(/\b3634\b/.test(visible), false, "a typeID must never be visible text");
  assert.equal(/\bflag\b/i.test(visible), false);
});

// --- the toggle -------------------------------------------------------------

test("both views exist and the toggle names them in plain language", async () => {
  const body = await renderFitting(rawFittingRead({ high: 4, mid: 3, low: 3, rig: 3 }));
  assert.match(body, /Ship view/);
  assert.match(body, /List view/);
  // The ring is the default above the breakpoint, so it is what rendered.
  assert.match(body, /fit-ring/);
});

test("the panel remembers the chosen view and defaults from the viewport", () => {
  // The behaviour lives in onMount (which the server generator never runs), so
  // this pins the wiring by reading it: a remembered choice wins, and with
  // none the R8 breakpoint decides.
  const source = readFileSync(path.join(UI_DIR, "Fitting.svelte"), "utf8");
  assert.match(source, /localStorage\?\.getItem\(VIEW_STORAGE_KEY\)/);
  assert.match(source, /localStorage\?\.setItem\(VIEW_STORAGE_KEY, next\)/);
  assert.match(source, /matchMedia\?\.\("\(max-width: 640px\)"\)/);
});

// --- the sockets drive R12's existing actions, they do not reimplement them --

test("socket actions route into the R12 flow calls, unchanged", () => {
  const source = readFileSync(path.join(UI_DIR, "Fitting.svelte"), "utf8");
  // The panel owns exactly one call site per action, shared by BOTH views —
  // the ring reuses R12's handlers rather than growing a parallel set. The one
  // exception is fitModule, which has two deliberate call sites: into a chosen
  // slot (fitInto) and into the first free one (fitAnywhere, the server-picked
  // auto-fit flag).
  const callSites: Readonly<Record<string, number>> = {
    "flow.fitModule(": 2,
    "flow.unfitModule(": 1,
    "flow.setModuleOnline(": 1,
    "flow.destroyRig(": 1,
  };
  for (const [call, expected] of Object.entries(callSites)) {
    assert.equal(
      source.split(call).length - 1,
      expected,
      `${call} must have exactly ${expected} call site(s), shared by the ring and the list`,
    );
  }
  // Clicking a socket goes through those same helpers.
  assert.match(source, /function clickSocket/);
  assert.match(source, /fitInto\(slot\)/);
});

test("removing a rig from a socket still takes two deliberate steps", () => {
  const source = readFileSync(path.join(UI_DIR, "Fitting.svelte"), "utf8");
  // The destroy button is only reachable once confirmingRigID is armed, and
  // arming it is its own click.
  assert.match(source, /confirmingRigID === selectedSlot\.module\.itemID/);
  assert.match(source, /Destroy rig…/);
  assert.match(source, /Yes, destroy it/);
  assert.match(source, /Destroying a rig is permanent/);
});
