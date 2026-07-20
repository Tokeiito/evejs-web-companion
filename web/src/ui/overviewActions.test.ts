// The R23 slice A action layer as it actually RENDERS in the overview panel.
//
// Slice A's whole claim is that it is GENERIC — the same lock button and the
// same equipment table serve a mining laser and a turret. A claim like that
// rots unless something checks it, so this file checks it two ways: it renders
// the panel and reads what a player would see, and it reads the source for the
// call sites, so a later goal cannot quietly grow a mining-only branch.
//
// It also re-proves the standing invariants on the new markup: R7d (no visible
// numeric IDs), R9a (plain player language), R8 (reflow tables carry data-label
// on every cell, and controls are real buttons rather than bare links).

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
const { deriveShipStats } = await import("../bridge/shipStats.ts");

const UI_DIR = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(path.join(UI_DIR, "Overview.svelte"), "utf8");

const ROCK_ID = 50001248;
const SHIP_ID = 9001;
const MODULE_ID = 7700001;
const ORE_TYPE_ID = 1230;
const LASER_TYPE_ID = 483;

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

/**
 * The panel with a rock in view, that rock LOCKED, a mining laser fitted and
 * online, and the server reporting it as cycling. Every one of those facts
 * arrives the way the real app delivers it — through a store event.
 */
function renderLoaded(options: {
  locked?: number[];
  acquiring?: number | null;
  activeModuleIDs?: number[] | null;
  actionError?: string | null;
  silentDecline?: string | null;
} = {}): string {
  const store = createClientStore();
  store.apply({
    type: "space/snapshot",
    snapshot: {
      inSpace: true,
      solarSystemID: 30000142,
      shipID: SHIP_ID,
      sampledAtMs: 1,
      entities: [
        {
          kind: "asteroid",
          itemID: ROCK_ID,
          typeID: ORE_TYPE_ID,
          groupID: 450,
          categoryID: 25,
          name: "Veldspar",
          ownerID: 1,
          radius: 1800,
          position: { x: 1000, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
          isSelf: false,
          shieldRatio: null,
          armorRatio: null,
          hullRatio: null,
          characterID: null,
          corporationID: null,
          allianceID: null,
          securityStatus: null,
          maxVelocity: null,
          mode: null,
          capacitorRatio: null,
          remainingQuantity: null,
          miningYieldTypeID: null,
          beltID: null,
        },
      ],
      ship: {
        itemID: SHIP_ID,
        typeID: 606,
        name: "Ibis",
        mode: "STOP",
        maxVelocity: 300,
        radius: 30,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        shieldRatio: 1,
        armorRatio: 1,
        hullRatio: 1,
        capacitorRatio: 1,
        shieldCapacity: 300,
        armorCapacity: 300,
        hullCapacity: 300,
        activeModuleIDs:
          options.activeModuleIDs === undefined ? [MODULE_ID] : options.activeModuleIDs,
      },
    },
  });
  store.apply({ type: "targeting/targets", targetIDs: options.locked ?? [ROCK_ID] });
  if (options.acquiring) {
    store.apply({ type: "targeting/acquiring", targetID: options.acquiring });
  }
  if (options.actionError) {
    store.apply({ type: "targeting/action-error", message: options.actionError });
  }
  if (options.silentDecline) {
    store.apply({ type: "targeting/silent-decline", message: options.silentDecline });
  }
  store.apply({
    type: "fitting/loaded",
    activeShipID: SHIP_ID,
    slots: [
      {
        family: "high",
        index: 0,
        module: { itemID: MODULE_ID, typeID: LASER_TYPE_ID, groupID: 54, online: true },
      },
    ],
    resources: {
      cpu: { used: 0, total: 0, known: false },
      powergrid: { used: 0, total: 0, known: false },
      capacitor: { used: 0, total: 0, known: false },
      calibration: { used: 0, total: 0, known: false },
    },
    stats: deriveShipStats(new Map()),
    slotsError: null,
    resourcesError: null,
  });
  store.apply({
    type: "names/resolved",
    entries: {
      [`type:${ORE_TYPE_ID}`]: "Veldspar",
      [`typeGroup:${ORE_TYPE_ID}`]: "Veldspar",
      [`typeCategory:${ORE_TYPE_ID}`]: "Asteroid",
      [`type:${LASER_TYPE_ID}`]: "Miner I",
      "type:606": "Ibis",
    },
  });
  return render(Overview, { props: { store, flow: fakeFlow() } }).body;
}

// --- The sections exist and read as a player would expect --------------------

test("the panel shows a locked-target list and an equipment list", () => {
  const text = visibleText(renderLoaded());
  assert.match(text, /Locked targets/);
  assert.match(text, /Your equipment/);
  // Each named, never numbered.
  assert.match(text, /Veldspar/);
  assert.match(text, /Miner I/);
});

test("a lock that has landed reads Locked; one still being acquired reads Locking", () => {
  assert.match(visibleText(renderLoaded()), /Locked\b/);
  const acquiring = visibleText(renderLoaded({ locked: [], acquiring: ROCK_ID }));
  assert.match(acquiring, /Locking…/);
  // A target still being acquired is not yet usable, so it must not be offered
  // as something to switch equipment on to.
  assert.doesNotMatch(acquiring, /Nothing is locked/);
});

test("with nothing locked the list says so, in plain words", () => {
  const text = visibleText(renderLoaded({ locked: [] }));
  assert.match(text, /Nothing is locked/);
});

test("a module the server says is cycling reads Running; otherwise Idle", () => {
  assert.match(visibleText(renderLoaded({ activeModuleIDs: [MODULE_ID] })), /Running/);
  assert.match(visibleText(renderLoaded({ activeModuleIDs: [] })), /Idle/);
});

test("when the server cannot say what is running, the panel says NOT KNOWN — never Idle", () => {
  // This is the honesty rule: a wrong "Idle" invites a double activation.
  const body = renderLoaded({ activeModuleIDs: null });
  const text = visibleText(body);
  assert.match(text, /Not known/);
  assert.doesNotMatch(text, /\bIdle\b/);
  assert.match(body, /stat-unavailable/, "unavailable state uses the shared unavailable style");
});

test("a refusal and a silent decline are shown as DIFFERENT things", () => {
  const text = visibleText(
    renderLoaded({
      actionError: "Lock refused: CALL_REFUSED: TargetTooFar",
      silentDecline: "The server did not release that lock, and gave no reason.",
    }),
  );
  assert.match(text, /TargetTooFar/, "the server's own reason, verbatim");
  assert.match(text, /gave no reason/, "and the silent decline said plainly");
});

// --- R7d: no visible numeric IDs --------------------------------------------

test("R23: no itemID, typeID or moduleID is ever visible text", () => {
  const text = visibleText(renderLoaded());
  for (const id of [ROCK_ID, SHIP_ID, MODULE_ID, ORE_TYPE_ID, LASER_TYPE_ID]) {
    assert.equal(
      new RegExp(`\\b${id}\\b`).test(text),
      false,
      `${id} must never appear as text a player can read`,
    );
  }
  // And no leaked wire vocabulary.
  assert.equal(/\bflag\b/i.test(text), false);
  assert.equal(/\btypeID\b/i.test(text), false);
  assert.equal(/\bitemID\b/i.test(text), false);
});

// --- R9a: plain player language ---------------------------------------------

test("R9a: the new sections speak to a player, not to a developer", () => {
  const text = visibleText(renderLoaded());
  // No API vocabulary on screen.
  for (const jargon of [
    "AddTarget",
    "RemoveTarget",
    "GetTargets",
    "Activate",
    "Deactivate",
    "dogmaIM",
    "effect name",
    "repeat",
    "allowlist",
    "bridge",
    "BFF",
  ]) {
    assert.equal(
      text.includes(jargon),
      false,
      `"${jargon}" is developer vocabulary and must not be on screen`,
    );
  }
  // And the labels are things a player would say.
  assert.match(text, /Switch on/);
  assert.match(text, /Switch off/);
  assert.match(text, /Release lock/);
});

// --- R8: the new tables reflow, and the controls are real buttons -------------

test("R8: every new table is a reflow table inside a scroll wrapper", () => {
  const body = renderLoaded();
  // Three record tables now: locked targets, equipment, and the overview grid.
  const reflowTables = body.match(/<table class="guests[^"]*reflow"/g) ?? [];
  assert.ok(reflowTables.length >= 3, `expected 3+ reflow tables, saw ${reflowTables.length}`);
  const wrappers = body.match(/table-wrap overflow-x-auto/g) ?? [];
  assert.ok(wrappers.length >= 3, "each table scrolls inside its own wrapper");
});

test("R8: every cell in the new tables carries a data-label for the narrow layout", () => {
  const body = renderLoaded();
  // At the R8 breakpoint each row becomes a stack of label/value pairs driven by
  // td::before { content: attr(data-label) }. A cell without the attribute
  // renders as an unlabelled value on a phone.
  const cells = body.match(/<td\b[^>]*>/g) ?? [];
  assert.ok(cells.length > 0, "the loaded panel must render cells");
  for (const cell of cells) {
    assert.match(cell, /data-label="/, `every <td> needs data-label; saw ${cell}`);
  }
});

test("R8: the new actions are <button type=button>, sized by the shared button rule", () => {
  // styles.css gives every button min-height: 2.5rem (40px) — so the R8 target
  // size is inherited, and the thing to pin here is that these ARE buttons and
  // that they sit in the shared .row-actions group (which wraps and, at the
  // breakpoint, stacks full-width).
  assert.match(SOURCE, /class="row-actions"/);
  const lockButtons = SOURCE.match(/flow\.(lock|unlock)Target\(/g) ?? [];
  assert.ok(lockButtons.length >= 2, "lock and unlock are both offered");
  // No bare anchors standing in for actions.
  assert.equal(/<a\s+href="#/.test(SOURCE), false, "actions are buttons, not fake links");
});

// --- The generality claim, pinned in source ----------------------------------

test("the reusable layer is GENERIC: no domain vocabulary in the BFF client", () => {
  // This is the real test of the claim. `Overview.svelte` legitimately talks
  // about rocks and ore — it is the mining PRESENTATION built on top. What must
  // stay domain-free is the layer combat inherits: the typed BFF calls and the
  // flow methods behind them. If a later goal has to add "if this is a mining
  // laser…" THERE, the abstraction was wrong.
  const apiSource = readFileSync(path.join(UI_DIR, "..", "app", "api.ts"), "utf8");
  const sliceA = section(
    apiSource,
    "--- R23 slice A: targeting + module activation ---",
    "--- R23 slice B: the mining loop ---",
  );
  assert.ok(sliceA.length > 500, "the slice A section must be found in api.ts");
  for (const word of ["mining", "asteroid", "ore", "turret", "missile", "laser", "salvage"]) {
    assert.equal(
      new RegExp(`\\b${word}\\b`, "i").test(stripComments(sliceA)),
      false,
      `the reusable layer must not mention "${word}" — it is generic`,
    );
  }

  // And the same for the flow methods.
  const flowSource = readFileSync(path.join(UI_DIR, "..", "app", "flow.ts"), "utf8");
  const flowSliceA = section(
    flowSource,
    "--- R23 slice A: targeting + module activation ---",
    "--- R23 slice B: the mining loop ---",
  );
  assert.ok(flowSliceA.length > 500, "the slice A section must be found in flow.ts");
  for (const word of ["mining", "asteroid", "ore", "turret", "missile", "laser"]) {
    assert.equal(
      new RegExp(`\\b${word}\\b`, "i").test(stripComments(flowSliceA)),
      false,
      `the reusable flow layer must not mention "${word}" — it is generic`,
    );
  }
});

/** The source between two banner comments (exclusive of the second). */
function section(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  if (start < 0) {
    return "";
  }
  const end = source.indexOf(to, start);
  return source.slice(start, end < 0 ? undefined : end);
}

/** Code only: prose in comments may name examples without being a branch. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

test("the panel calls the generic flow methods, once each, with no parallel path", () => {
  const callSites: Readonly<Record<string, number>> = {
    "flow.lockTarget(": 1,
    // Unlock is offered in two places on purpose: on the overview row and in
    // the locked-target list. Both go through the SAME flow method.
    "flow.unlockTarget(": 3,
    "flow.activateModule(": 1,
    "flow.deactivateModule(": 1,
  };
  for (const [call, expected] of Object.entries(callSites)) {
    assert.equal(
      SOURCE.split(call).length - 1,
      expected,
      `${call} must have exactly ${expected} call site(s)`,
    );
  }
});

test("activateModule is called WITHOUT naming an effect — the server picks it", () => {
  // The browser must never guess which effect a module runs. Passing no effect
  // name is what makes one button correct for a laser, a turret and a repper.
  const call = SOURCE.slice(SOURCE.indexOf("flow.activateModule("));
  assert.doesNotMatch(call.slice(0, 200), /effect:/, "the panel must not name an effect");
});

// --- R24 slice B: the Dock action on the overview row ------------------------

const STATION_ID = 60003760;

/** One ball of a chosen runtime kind, alongside the ship, rendered in the panel. */
function renderWithEntity(kind: string, itemID: number): string {
  const store = createClientStore();
  store.apply({
    type: "space/snapshot",
    snapshot: {
      inSpace: true,
      solarSystemID: 30000142,
      shipID: SHIP_ID,
      sampledAtMs: 1,
      entities: [
        {
          kind,
          itemID,
          typeID: ORE_TYPE_ID,
          groupID: 15,
          categoryID: 3,
          name: "Jita IV - Moon 4",
          ownerID: 1,
          radius: 12000,
          position: { x: 400_000, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
          isSelf: false,
          shieldRatio: null,
          armorRatio: null,
          hullRatio: null,
          characterID: null,
          corporationID: null,
          allianceID: null,
          securityStatus: null,
          maxVelocity: null,
          mode: null,
          capacitorRatio: null,
          remainingQuantity: null,
          miningYieldTypeID: null,
          beltID: null,
        },
      ],
      ship: {
        itemID: SHIP_ID,
        typeID: 606,
        name: "Ibis",
        mode: "STOP",
        maxVelocity: 300,
        radius: 30,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        shieldRatio: 1,
        armorRatio: 1,
        hullRatio: 1,
        capacitorRatio: 1,
        shieldCapacity: 300,
        armorCapacity: 300,
        hullCapacity: 300,
        activeModuleIDs: [],
      },
    },
  });
  return render(Overview, { props: { store, flow: fakeFlow() } }).body;
}

test("R24: a station row offers Dock; a rock row does not", () => {
  const station = renderWithEntity("station", STATION_ID);
  assert.match(visibleText(station), /\bDock\b/, "a station is something you can dock at");
  // Dockable is decided from the server's own kind for the ball — not guessed
  // from the name, the distance, or the category number.
  assert.doesNotMatch(
    visibleText(renderWithEntity("asteroid", ROCK_ID)),
    /\bDock\b/,
    "you cannot dock at a rock",
  );
});

test("R24: Dock is a real button in the shared row-actions group, and calls dockAt", () => {
  // dockAt is the ladder (close the distance, then dock); flow.dock is the raw
  // single command. The row must offer the one that finishes the job.
  assert.match(SOURCE, /flow\.dockAt\(row\.itemID\)/);
  const station = renderWithEntity("station", STATION_ID);
  assert.match(station, /class="row-actions"/);
  assert.equal(/<a\s+href="#/.test(station), false, "actions are buttons, not fake links");
});

test("R24: the station row keeps the standing invariants (no ids, plain words, data-label)", () => {
  const body = renderWithEntity("station", STATION_ID);
  const text = visibleText(body);
  for (const id of [STATION_ID, SHIP_ID, ORE_TYPE_ID]) {
    assert.equal(new RegExp(`\b${id}\b`).test(text), false, `${id} must not be visible`);
  }
  for (const jargon of ["CmdDock", "DockingApproach", "stationID", "surface distance", "bridge"]) {
    assert.equal(text.includes(jargon), false, `"${jargon}" is developer vocabulary`);
  }
  for (const cell of body.match(/<td\b[^>]*>/g) ?? []) {
    assert.match(cell, /data-label="/, `every <td> needs data-label; saw ${cell}`);
  }
});
