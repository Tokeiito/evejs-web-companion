// The R30 slice C flight strip as it actually RENDERS.
//
// The strip answers three questions the player previously had to leave this tab
// to ask — where am I, what is happening, what went wrong — plus the one control
// that matters right now. Two of its rules are the kind that rot silently, so
// they are checked here against real rendered output rather than trusted:
//
//   1. NARRATION IS NEVER SYNTHESIZED. Hand-flying shows no "doing" line at all.
//      A convincing invented sentence is worse than no sentence, because it
//      makes a browser guess indistinguishable from something the autopilot
//      actually reported.
//   2. STOP IS NEVER DISABLED. Not by a shared busy flag, not by its own. It is
//      the control you reach for when things are going wrong, which is exactly
//      when other requests are in flight.
//
// It also re-proves the standing invariants on the new markup: R7d (no visible
// numeric IDs) and R9a (plain player language).

import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

register("./svelteSsrHook.ts", import.meta.url);

const { render } = await import("svelte/server");
const { createClientStore } = await import("../store/clientStore.ts");
const Overview = (await import("./Overview.svelte")).default;

const UI_DIR = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(path.join(UI_DIR, "Overview.svelte"), "utf8");

const SHIP_ID = 9001;
const SHIP_TYPE_ID = 622;
const STATION_ID = 60000358;
const SYSTEM_ID = 30000142;

function fakeFlow(): unknown {
  return new Proxy({}, { get: () => async () => {} });
}

/** Everything visible to a player, with markup and image sources stripped. */
function visibleText(body: string): string {
  return body
    .replace(/<img[^>]*>/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");
}

function dockedStore() {
  const store = createClientStore();
  store.apply({
    type: "flight/status",
    status: {
      inSpace: false,
      docked: true,
      solarSystemID: SYSTEM_ID,
      stationID: STATION_ID,
      structureID: null,
      shipID: SHIP_ID,
      shipMode: null,
      shipSpeedFraction: null,
    },
  });
  store.apply({
    type: "flight/location",
    forSolarSystemID: SYSTEM_ID,
    forStationID: STATION_ID,
    forStructureID: null,
    solarSystemName: "Jita",
    stationName: "Jita IV - Moon 4 - Caldari Navy Assembly Plant",
    structureName: null,
  });
  return store;
}

function inSpaceStore() {
  const store = createClientStore();
  store.apply({
    type: "flight/status",
    status: {
      inSpace: true,
      docked: false,
      solarSystemID: SYSTEM_ID,
      stationID: null,
      structureID: null,
      shipID: SHIP_ID,
      shipMode: "STOP",
      shipSpeedFraction: 0,
    },
  });
  store.apply({
    type: "flight/location",
    forSolarSystemID: SYSTEM_ID,
    forStationID: null,
    forStructureID: null,
    solarSystemName: "Jita",
    stationName: null,
    structureName: null,
  });
  store.apply({
    type: "space/snapshot",
    snapshot: {
      inSpace: true,
      solarSystemID: SYSTEM_ID,
      shipID: SHIP_ID,
      sampledAtMs: 1_700_000_000_000,
      entities: [],
      ship: {
        itemID: SHIP_ID,
        typeID: SHIP_TYPE_ID,
        name: null,
        mode: "STOP",
        shieldRatio: 1,
        armorRatio: 1,
        hullRatio: 1,
        capacitorRatio: 1,
        shieldCapacity: 400,
        armorCapacity: 300,
        hullCapacity: 600,
        radius: 100,
        maxVelocity: 300,
        activeModuleIDs: [],
    overloadedModuleIDs: [],
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
      },
    },
  });
  store.apply({
    type: "names/resolved",
    entries: { [`type:${SHIP_TYPE_ID}`]: "Venture" },
  });
  return store;
}

function renderWith(store: unknown): string {
  return render(Overview as never, { props: { store, flow: fakeFlow() } } as never).body;
}

// --- where ------------------------------------------------------------------

test("docked, the strip says WHERE — by station name, never an id", () => {
  const body = renderWith(dockedStore());
  const text = visibleText(body);

  assert.match(text, /Docked at Jita IV - Moon 4 - Caldari Navy Assembly Plant/);
  // R7d — the station and system ids are never rendered.
  assert.equal(body.includes(String(STATION_ID)), false);
  assert.equal(body.includes(String(SYSTEM_ID)), false);
  assert.equal(body.includes(String(SHIP_ID)), false);
});

test("in space, the strip names the system AND the ship, by name", () => {
  const body = renderWith(inSpaceStore());
  const text = visibleText(body);

  assert.match(text, /In space · Jita/);
  assert.match(text, /Venture/, "the active ship is named by its type");
  assert.equal(body.includes(String(SHIP_TYPE_ID)), false, "R7d — never the typeID");
});

test("before any flight read the strip says it does not know yet, and guesses nothing", () => {
  const text = visibleText(renderWith(createClientStore()));
  assert.match(text, /Finding out where you are/);
  // It must not claim a location it has not been told.
  assert.equal(/In space ·/.test(text), false);
  assert.equal(/Docked at/.test(text), false);
});

// --- doing: the rule that must not rot --------------------------------------

test("HAND-FLYING PRODUCES NO NARRATION — nothing is synthesized", () => {
  // A ship in space, nothing driving it. There is no authority to quote, so the
  // strip says nothing about what is happening rather than inventing a phrase.
  const body = renderWith(inSpaceStore());
  assert.equal(
    body.includes("strip-doing"),
    false,
    "manual play must render no 'doing' line at all",
  );
});

test("a running bot's OWN words are passed through, unaltered", () => {
  const store = inSpaceStore();
  store.apply({
    type: "bot/progress",
    status: "running",
    phase: "Mining",
    action: "Running the lasers",
    why: "The hold still has room",
    // R44 — the readout carries which rung fired. The strip does not show it.
    rung: null,
    step: null,
    rockName: "Veldspar",
    cyclesCompleted: 2,
    oreUnitsMined: 400,
    holdUsed: 200,
    holdCapacity: 5000,
    failureReason: null,
  });
  const text = visibleText(renderWith(store));

  // Each of the three fields the loop reported, verbatim.
  assert.match(text, /Mining/);
  assert.match(text, /Running the lasers/);
  assert.match(text, /The hold still has room/);
});

test("a paused bot is still driving the ship, and still gets to speak", () => {
  const store = inSpaceStore();
  store.apply({
    type: "bot/progress",
    status: "paused",
    phase: "Mining",
    action: "Holding",
    why: "You paused it",
    rung: null,
    step: null,
    rockName: null,
    cyclesCompleted: 0,
    oreUnitsMined: 0,
    holdUsed: null,
    holdCapacity: null,
    failureReason: null,
  });
  assert.match(visibleText(renderWith(store)), /You paused it/);
});

test("a bot that has STOPPED says nothing — a finished loop is not narration", () => {
  const store = inSpaceStore();
  store.apply({
    type: "bot/progress",
    status: "stopped",
    phase: "Mining",
    action: "Running the lasers",
    why: "The hold still has room",
    rung: null,
    step: null,
    rockName: null,
    cyclesCompleted: 1,
    oreUnitsMined: 100,
    holdUsed: null,
    holdCapacity: null,
    failureReason: null,
  });
  assert.equal(
    renderWith(store).includes("strip-doing"),
    false,
    "stale words from a loop that is no longer running are not what is happening",
  );
});

// --- wrong ------------------------------------------------------------------

test("a refusal from anywhere reaches the cockpit", () => {
  const store = inSpaceStore();
  store.apply({ type: "flight/action-error", message: "Warp refused: You are warp scrambled." });
  assert.match(visibleText(renderWith(store)), /You are warp scrambled/);
});

test("the strip shows ONE reason, the first, rather than a pile", () => {
  const store = inSpaceStore();
  store.apply({ type: "flight/action-error", message: "Warp refused: scrambled." });
  store.apply({ type: "targeting/action-error", message: "Lock refused: too far." });
  const body = renderWith(store);
  assert.equal(
    (body.match(/strip-wrong/g) ?? []).length,
    1,
    "the strip carries a single 'what went wrong' line",
  );
  // ...and it is the FIRST source in the documented order, not the last written.
  assert.match(visibleText(body), /scrambled/);
});

// --- the control ------------------------------------------------------------

test("docked, the primary control is Undock — and it is HERE, not on another tab", () => {
  const text = visibleText(renderWith(dockedStore()));
  assert.match(text, /Undock/);
  assert.equal(/Stop the ship/.test(text), false, "a docked ship has no engines to cut");
});

test("in space, the primary control is Stop", () => {
  assert.match(visibleText(renderWith(inSpaceStore())), /Stop the ship/);
});

test("STOP IS NEVER DISABLED — not by a shared flag, not by its own", () => {
  const body = renderWith(inSpaceStore());
  // Find the Stop button's own markup and assert it carries no disabled state.
  const index = body.indexOf("Stop the ship");
  assert.ok(index > 0, "the Stop control is rendered");
  const openTag = body.lastIndexOf("<button", index);
  const buttonTag = body.slice(openTag, index);
  assert.equal(
    /disabled/.test(buttonTag),
    false,
    "Stop must never render a disabled attribute — see the comment in Overview.svelte",
  );
});

test("Stop is not silently swallowed by a busy guard either", () => {
  // The other half of the same rule: an enabled button that drops the click
  // because something else is in flight is the same failure, wearing a
  // friendlier face. Stop routes through the UNGUARDED path.
  assert.match(
    SOURCE,
    /runUnguarded\(\(\) => flow\.stopShip\(\)\)/,
    "Stop must call flow.stopShip through the unguarded runner",
  );
});

// --- the structural claims --------------------------------------------------

test("the busy state is a per-concern SET, not one flag", () => {
  // A single shared flag is what greys out Stop mid-fight because a lock
  // request happened to be pending.
  assert.match(SOURCE, /busyConcerns\s*=\s*\$state<readonly Concern\[\]>/);
  assert.match(SOURCE, /function concernBusy\(concern: Concern\): boolean/);
  // And the exemption is written down so a later cleanup does not undo it.
  assert.match(SOURCE, /DO NOT CLEAN THIS UP/);
});

test("the app no longer tells the player to go to the Flight tab to undock", () => {
  // Deleting this sentence IS the acceptance test for this slice: Undock is on
  // the cockpit now, so the instruction to leave it is false.
  assert.equal(
    SOURCE.includes("Undock on the Flight tab"),
    false,
    "the tab-switch instruction must be gone, not reworded",
  );
  const dockedText = visibleText(renderWith(dockedStore()));
  assert.equal(/Flight tab/.test(dockedText), false);
});

test("R9a — the strip speaks plain player language", () => {
  const store = inSpaceStore();
  store.apply({ type: "flight/action-error", message: "Warp refused: You are warp scrambled." });
  const text = visibleText(renderWith(store));
  // No runtime/entity jargon leaking into the readout.
  for (const jargon of ["solarSystemID", "stationID", "itemID", "typeID", "inSpace", "KeyVal"]) {
    assert.equal(text.includes(jargon), false, `"${jargon}" must not reach the player`);
  }
});
