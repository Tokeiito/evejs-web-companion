// Every panel must SURVIVE ITS FIRST MOUNT (goal R18).
//
// The bug this suite exists to prevent: the Fitting tab did nothing at all when
// clicked. `<Fitting>`'s template read `{activeShipName()}` — invoking a
// `$derived` STRING as if it were a function. That throws
// `TypeError: activeShipName(...) is not a function` while Svelte is creating
// the component, so Svelte abandoned the whole render, `page` never visibly
// changed, and the tab looked inert. Nothing reached `window.onerror`, so the
// failure was completely silent to the player.
//
// Nothing else in the suite could have caught it: `tsc` does not parse
// `.svelte` files (web/src/svelte-files.d.ts), and no test had ever executed a
// component. So this suite RENDERS them, using Svelte's server generator (no
// DOM needed — see svelteSsrHook.ts).
//
// Two layers, because they fail for different reasons:
//   1. render every panel against the store's INITIAL state, and the Fitting
//      panel against the RAW BFF read shapes decoded through the real flow —
//      this is the first-mount reproduction;
//   2. a static sweep asserting no `$derived` binding is ever invoked as a
//      function — this also covers template branches a render does not reach.
//
// `$effect` and `onMount` do not run under the server generator, so this pins
// RENDER-time correctness. It is the half where the R18 bug lived.

import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

register("./svelteSsrHook.ts", import.meta.url);

const { render } = await import("svelte/server");
const { createClientStore } = await import("../store/clientStore.ts");
const { createAppFlow } = await import("../app/flow.ts");

const UI_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Every panel App can swap in, plus the pre-login pages and App itself. */
const PANELS = [
  "App",
  "LoginForm",
  "CharacterSelect",
  "StationPanel",
  "InventoryShip",
  "Fitting",
  "Industry",
  "Market",
  "Mail",
  "Contracts",
  "AgentsMissions",
  "AgentFinder",
  "Flight",
  "Overview",
  "MiningBot",
  "Mining",
  "Travel",
  "Chat",
] as const;

/**
 * A flow stub: the server generator never runs `onMount` or an event handler,
 * so no panel should call anything on it during a render. Any property reads
 * back as a no-op async function.
 */
function fakeFlow(): unknown {
  return new Proxy({}, { get: () => async () => {} });
}

async function loadPanel(name: string): Promise<unknown> {
  const module = (await import(`./${name}.svelte`)) as { default: unknown };
  return module.default;
}

// --- 1. first mount against the store's initial state -----------------------

for (const name of PANELS) {
  test(`${name} renders on first mount against the store's initial state`, async () => {
    const store = createClientStore();
    const Panel = await loadPanel(name);
    // Any throw here is the R18 failure mode: the component dies during
    // creation and the page silently refuses to change.
    const output = render(Panel as never, {
      props: { store, flow: fakeFlow() },
    } as never);
    assert.equal(typeof output.body, "string");
  });
}

// --- 2. the Fitting panel against the RAW BFF read shapes -------------------

function packedRow(fields: Record<string, unknown>): unknown {
  return { type: "packedrow", fields };
}

/**
 * The exact envelope `GET /api/bridge/fitting` returns for Farmer's ship: raw
 * retail shapes, every read clean. A Punisher — 4 high / 2 mid / 5 low / 3 rig,
 * docked (so its capacitor arrives as "charge", attribute 18, not 482).
 */
function rawFittingRead(): unknown {
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
  };
  return {
    ok: true,
    activeShipID: 9988400029047,
    stationID: 60003760,
    slots: {
      type: "list",
      items: [
        packedRow({ itemID: 5001, typeID: 3634, groupID: 53, flagID: 27 }),
        packedRow({ itemID: 5004, typeID: 31358, groupID: 781, flagID: 92 }),
      ],
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
                    entries: Object.entries(attributes).map(([id, value]) => [
                      Number(id),
                      value,
                    ]),
                  },
                ],
              ],
            },
          },
        ],
      ],
    },
    online: { type: "list", items: [5001] },
    errors: { slots: null, shipInfo: null, online: null },
  };
}

function fittingFetch(): typeof fetch {
  return (async (input: unknown) => ({
    ok: true,
    status: 200,
    async json() {
      return String(input) === "/api/bridge/fitting"
        ? rawFittingRead()
        : { ok: true, applied: true };
    },
  })) as unknown as typeof fetch;
}

test("Fitting renders the loaded ship after the raw BFF read is decoded", async () => {
  const store = createClientStore();
  const flow = createAppFlow(store, { fetch: fittingFetch() });
  await flow.loadFitting();

  const fitting = store.get().fitting;
  assert.equal(fitting.loaded, true);
  assert.equal(fitting.activeShipID, 9988400029047);
  // 4 high + 2 mid + 5 low + 3 rig.
  assert.equal(fitting.slots.length, 14);

  const Panel = await loadPanel("Fitting");
  const output = render(Panel as never, { props: { store, flow } } as never);

  // The ship header renders the derived NAME, not "[object Object]" and not a
  // crash. With no inventory row to name it from, it is the plain fallback.
  assert.match(output.body, /your ship/);
  // The slot families the decoded read produced are on screen, by plain name.
  assert.match(output.body, /High slots/);
  assert.match(output.body, /Rigs/);
  // R7d: the ship's itemID must never be rendered.
  assert.equal(output.body.includes("9988400029047"), false);
});

// --- 3. static sweep: a $derived is a VALUE, never a function ---------------

test("no component invokes a $derived binding as a function", () => {
  const offences: string[] = [];
  const files = readdirSync(UI_DIR).filter((name) => name.endsWith(".svelte"));
  assert.ok(files.length > 0, "expected .svelte components to sweep");

  for (const file of files) {
    const source = readFileSync(path.join(UI_DIR, file), "utf8");
    const declarations = source.matchAll(
      /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*?)?=\s*\$derived\b/g,
    );
    for (const declaration of declarations) {
      const name = declaration[1]!;
      const called = new RegExp(String.raw`\b${name}\s*\(`, "g");
      for (const hit of source.matchAll(called)) {
        // Skip the declaration itself (`const x = $derived.by(...)`).
        if (hit.index === declaration.index! + declaration[0].indexOf(name)) {
          continue;
        }
        const line = source.slice(0, hit.index).split("\n").length;
        offences.push(`${file}:${line} calls the $derived '${name}' as a function`);
      }
    }
  }

  assert.deepEqual(offences, []);
});
