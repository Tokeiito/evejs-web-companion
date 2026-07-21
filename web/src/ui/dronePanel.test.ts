// R25 as it actually RENDERS: the Drones section, and the threat block that
// makes a pirate impossible to miss.
//
// Two claims are load-bearing and both are checked against real rendered
// output rather than asserted in prose:
//
//   1. LAUNCHING IS THE DEFENCE. The server auto-engages idle combat drones
//      against whatever shoots the ship, so a miner who launches is defended
//      with no further clicks. A player who does not know that will sit there
//      clicking, so the panel has to SAY it.
//
//   2. "WE COULD NOT LOOK" IS NOT "NOTHING IS OUT THERE". A null drone list
//      must never render as an empty bay or an empty sky — that is what invites
//      a player to launch a second flight on top of the one already flying.
//
// The standing invariants are re-proven on the new markup: R7d (no visible
// numeric IDs), R9a (plain player language — "Pirate", never a runtime entity
// kind), R8 (real buttons).

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
const CHARACTER_ID = 7;
const DRONE_TYPE_ID = 2456;
const BAY_DRONE_ID = 7800001;
const SPACE_DRONE_ID = 9500001;
const RAT_ID = 50002001;
const ROCK_ID = 50001248;

function fakeFlow(): unknown {
  return new Proxy({}, { get: () => async () => {} });
}

/** Everything a player can see, with markup and comments stripped. */
function visibleText(body: string): string {
  return body
    .replace(/<img[^>]*>/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");
}

interface SceneOptions {
  readonly bay?: { itemID: number; typeID: number; quantity: number }[] | null;
  readonly inSpace?:
    | {
        itemID: number;
        typeID: number | null;
        name: string | null;
        activity: string | null;
        targetID: number | null;
        shieldRatio: number | null;
        armorRatio: number | null;
        hullRatio: number | null;
      }[]
    | null;
  readonly maxActiveDrones?: number | null;
  readonly droneBandwidth?: number | null;
  readonly hostiles?: { itemID: number; name: string; npcEntityType: string | null }[];
  readonly players?: { itemID: number; name: string }[];
  readonly loadDrones?: boolean;
  readonly shieldRatio?: number;
}

function spaceRow(over: Record<string, unknown> & { itemID: number }): unknown {
  return {
    kind: "ship",
    typeID: 606,
    groupID: 25,
    categoryID: 6,
    name: null,
    ownerID: null,
    radius: 30,
    position: { x: 2000, y: 0, z: 0 },
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
    isNpc: false,
    npcEntityType: null,
    controllerID: null,
    droneActivity: null,
    targetEntityID: null,
    ...over,
  };
}

/** The panel in space, with whatever drones and hostiles the case needs. */
function scene(options: SceneOptions = {}): string {
  const store = createClientStore();
  const entities: unknown[] = [];
  for (const hostile of options.hostiles ?? []) {
    entities.push(
      spaceRow({
        itemID: hostile.itemID,
        name: hostile.name,
        isNpc: true,
        npcEntityType: hostile.npcEntityType,
      }),
    );
  }
  for (const player of options.players ?? []) {
    entities.push(
      spaceRow({ itemID: player.itemID, name: player.name, characterID: 90000042 }),
    );
  }
  store.apply({
    type: "space/snapshot",
    snapshot: {
      inSpace: true,
      solarSystemID: 30000142,
      shipID: SHIP_ID,
      sampledAtMs: 1,
      entities: entities as never,
      ship: {
        itemID: SHIP_ID,
        typeID: 24700,
        name: "Test Pilot's ship",
        mode: "STOP",
        maxVelocity: 300,
        radius: 30,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        shieldRatio: options.shieldRatio ?? 1,
        armorRatio: 1,
        hullRatio: 1,
        capacitorRatio: 1,
        shieldCapacity: 3000,
        armorCapacity: 3000,
        hullCapacity: 3000,
        activeModuleIDs: [],
      },
    },
  } as never);
  if (options.loadDrones !== false) {
    store.apply({
      type: "drones/loaded",
      bay: options.bay === undefined ? [] : options.bay,
      inSpace: options.inSpace === undefined ? [] : options.inSpace,
      limits: {
        // `undefined` means "the case did not care"; an explicit `null` is the
        // case being tested (a limit the ship did not report).
        maxActiveDrones: options.maxActiveDrones === undefined ? 5 : options.maxActiveDrones,
        droneBandwidth: options.droneBandwidth === undefined ? 50 : options.droneBandwidth,
      },
    } as never);
  }
  // Names the panel resolves by typeID (R7d — nothing numeric is rendered).
  store.apply({
    type: "names/resolved",
    resolved: { [`type:${DRONE_TYPE_ID}`]: "Hobgoblin I" },
  } as never);
  return render(Overview, { props: { store, flow: fakeFlow() } }).body;
}

const A_SPACE_DRONE = {
  itemID: SPACE_DRONE_ID,
  typeID: DRONE_TYPE_ID,
  name: "Hobgoblin I",
  activity: "idle",
  targetID: null,
  shieldRatio: 1,
  armorRatio: 1,
  hullRatio: 1,
};

// --- The Drones section ------------------------------------------------------

test("the panel says LAUNCHING is the defence, in a player's words", () => {
  const text = visibleText(scene());
  // ⚠ The single most important sentence in this feature. The server
  // auto-engages idle combat drones against whatever shoots the ship, so a
  // miner who launches is defended without another click — and a player who is
  // not told that will sit there clicking Engage.
  assert.match(text, /Drones you launch defend you on their own/i);
  assert.match(text, /attack anything that\s+shoots your ship/i);
});

test("the bay and what is in space are shown SEPARATELY, both by name", () => {
  const text = visibleText(
    scene({
      bay: [{ itemID: BAY_DRONE_ID, typeID: DRONE_TYPE_ID, quantity: 1 }],
      inSpace: [A_SPACE_DRONE],
    }),
  );
  assert.match(text, /In space/);
  assert.match(text, /In the bay/);
  // R7d: the drone reads as its NAME, and neither its itemID nor its typeID
  // appears anywhere a player can see.
  assert.match(text, /Hobgoblin I/);
  assert.doesNotMatch(text, new RegExp(String(BAY_DRONE_ID)));
  assert.doesNotMatch(text, new RegExp(String(SPACE_DRONE_ID)));
  assert.doesNotMatch(text, new RegExp(String(DRONE_TYPE_ID)));
});

test("a drone in space says WHAT IT IS DOING, and names what it is doing it to", () => {
  const text = visibleText(
    scene({
      inSpace: [{ ...A_SPACE_DRONE, activity: "fighting", targetID: RAT_ID }],
      hostiles: [{ itemID: RAT_ID, name: "Serpentis Scout", npcEntityType: "npc" }],
    }),
  );
  assert.match(text, /Attacking/);
  // The target by NAME, never by id.
  assert.match(text, /Serpentis Scout/);
  assert.doesNotMatch(text, new RegExp(String(RAT_ID)));
});

test("an activity the gateway could not read says Unknown — never Waiting", () => {
  // A player told their drones are idle when nobody looked will not launch the
  // ones that would have saved them.
  const text = visibleText(scene({ inSpace: [{ ...A_SPACE_DRONE, activity: null }] }));
  assert.match(text, /Unknown/);
});

test("⚠ a FAILED read renders as 'could not be read', never as 'none out'", () => {
  const text = visibleText(scene({ bay: null, inSpace: null }));
  assert.match(text, /drones in space could not be read/i);
  assert.match(text, /drone bay could not be read/i);
  // The empty-state wording must NOT appear: it would invite a second launch.
  assert.doesNotMatch(text, /No drones out\./);
  assert.doesNotMatch(text, /Nothing in the drone bay\./);
});

test("a genuinely empty bay and sky say so plainly", () => {
  const text = visibleText(scene({ bay: [], inSpace: [] }));
  assert.match(text, /No drones out\./);
  assert.match(text, /Nothing in the drone bay\./);
});

test("the server's limits are SHOWN, and unknown reads as unknown", () => {
  const shown = visibleText(scene({ inSpace: [A_SPACE_DRONE], maxActiveDrones: 5, droneBandwidth: 50 }));
  assert.match(shown, /Drones at once:\s*1 of 5/);
  assert.match(shown, /Bandwidth:\s*50 Mbit\/sec/);

  // ⚠ null is "not known" — a hull with no drone bay and a read that failed
  // look identical from here, and neither may be shown as a hard zero.
  const unknown = visibleText(scene({ maxActiveDrones: null, droneBandwidth: null }));
  assert.match(unknown, /Drones at once: not known/);
  assert.match(unknown, /Bandwidth: not known/);
  assert.doesNotMatch(unknown, /Drones at once:\s*\d+ of 0/);
});

// --- The threat block --------------------------------------------------------

test("a pirate is called a Pirate, and a player ship gets no badge", () => {
  const text = visibleText(
    scene({
      hostiles: [{ itemID: RAT_ID, name: "Serpentis Scout", npcEntityType: "npc" }],
      players: [{ itemID: 60001, name: "Some Pilot" }],
    }),
  );
  assert.match(text, /Hostiles nearby/);
  // R9a: the word a player uses. Never "NPC entity kind", never "nativeNpc".
  assert.match(text, /Pirate/);
  assert.doesNotMatch(text, /nativeNpc|npcEntityType|NPC entity/i);
  // R7d: the rat is named, its itemID is not shown.
  assert.match(text, /Serpentis Scout/);
  assert.doesNotMatch(text, new RegExp(String(RAT_ID)));
});

test("police and drifters are labelled honestly — and only threats are listed", () => {
  const police = visibleText(
    scene({ hostiles: [{ itemID: 60002, name: "CONCORD Police", npcEntityType: "concord" }] }),
  );
  // Law enforcement is an NPC that does not shoot a miner. Painting it as a
  // threat would make the colour meaningless.
  assert.doesNotMatch(police, /Hostiles nearby/);

  const drifter = visibleText(
    scene({ hostiles: [{ itemID: 60003, name: "Drifter Battleship", npcEntityType: "drifter" }] }),
  );
  assert.match(drifter, /Hostiles nearby/);
  assert.match(drifter, /Drifter/);
});

test("with nothing hostile around, no threat block is rendered at all", () => {
  const text = visibleText(scene({ players: [{ itemID: 60004, name: "Some Pilot" }] }));
  assert.doesNotMatch(text, /Hostiles nearby/);
  assert.doesNotMatch(text, /You are taking damage/);
});

test("the threat badge is a WORD, so colour is never the only signal", () => {
  // A player who cannot distinguish the red still reads "Pirate".
  const body = scene({
    hostiles: [{ itemID: RAT_ID, name: "Serpentis Scout", npcEntityType: "npc" }],
  });
  assert.match(body, /class="threat-badge"[^>]*>\s*Pirate/);
});

test("a hostile is marked in the ordinary overview list too", () => {
  const body = scene({
    hostiles: [{ itemID: RAT_ID, name: "Serpentis Scout", npcEntityType: "npc" }],
  });
  // The threat block is the loud version; the row marker is so the list a
  // player is already reading is legible as well.
  assert.match(body, /<tr[^>]*class="[^"]*\bhostile\b/);
});

// --- Source-level guarantees -------------------------------------------------

test("threats are read from the SNAPSHOT, not from the filtered overview rows", () => {
  // ⚠ The overview is searchable, filterable and capped at 200 rows. A miner
  // who searched for "Veldspar" while mining would have filtered away the thing
  // shooting them, so the threat list must never be derived from it.
  assert.match(SOURCE, /hostileRows\(snapshot, origin\)/);
  assert.doesNotMatch(SOURCE, /hostileRows\(overview/);
});

test("the panel calls one flow method per drone verb, and no others", () => {
  const callSites: Readonly<Record<string, number>> = {
    // Launch appears twice on purpose: per-stack, and for the picked set.
    "flow.launchDrones(": 2,
    // Engage appears twice: on a threat row, and against the locked target.
    "flow.engageDrones(": 2,
    "flow.mineWithDrones(": 1,
    // Recall appears twice: one drone, and all of them.
    "flow.recallDrones(": 2,
  };
  for (const [call, expected] of Object.entries(callSites)) {
    assert.equal(
      SOURCE.split(call).length - 1,
      expected,
      `${call} must have exactly ${expected} call site(s)`,
    );
  }
  // ⚠ The verbs with NO server handler (CmdAssist / CmdGuard / CmdUnanchor) and
  // the one that permanently disowns drones (CmdAbandonDrone) must not appear
  // anywhere in this panel.
  for (const forbidden of ["assistDrones", "guardDrones", "abandonDrone", "unanchor"]) {
    assert.doesNotMatch(SOURCE, new RegExp(forbidden, "i"), `${forbidden} must not exist`);
  }
});

test("R8: every drone and threat control is a real button", () => {
  const body = scene({
    bay: [{ itemID: BAY_DRONE_ID, typeID: DRONE_TYPE_ID, quantity: 1 }],
    inSpace: [A_SPACE_DRONE],
    hostiles: [{ itemID: RAT_ID, name: "Serpentis Scout", npcEntityType: "npc" }],
  });
  for (const label of ["Launch", "Bring home", "Bring them all home", "Send drones", "Lock"]) {
    assert.match(
      body,
      new RegExp(`<button[^>]*>[\\s\\S]{0,80}${label}`),
      `"${label}" must be a real button`,
    );
  }
});

test("R7d: no numeric ID reaches the rendered drone or threat markup", () => {
  const text = visibleText(
    scene({
      bay: [{ itemID: BAY_DRONE_ID, typeID: DRONE_TYPE_ID, quantity: 1 }],
      inSpace: [{ ...A_SPACE_DRONE, activity: "mining", targetID: ROCK_ID }],
      hostiles: [{ itemID: RAT_ID, name: "Serpentis Scout", npcEntityType: "npc" }],
    }),
  );
  for (const id of [BAY_DRONE_ID, SPACE_DRONE_ID, RAT_ID, ROCK_ID, DRONE_TYPE_ID, SHIP_ID, CHARACTER_ID]) {
    assert.doesNotMatch(
      text,
      new RegExp(`\\b${id}\\b`),
      `the id ${id} must never be visible to a player`,
    );
  }
});
