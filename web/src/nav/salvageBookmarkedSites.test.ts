// The salvager's lap (salvage-bookmarked-sites): folders taken up, a site picked from one folder, flown to,
// looted and salvaged, its bookmark filed in the other; home to unload when full, and a bounded wait docked when
// no site is left.

import test from "node:test";
import assert from "node:assert/strict";
import type { MacroStep } from "../bots/botScript.ts";
import type { FlightStatus } from "../store/types.ts";
import type { ScriptObservation } from "./scriptConditions.ts";
import type { MacroMemory, ScriptBoard } from "./scriptDecide.ts";
import { SCRIPT_MACROS } from "./scriptMacros.ts";

const NB: ScriptBoard = {};
const salvager = SCRIPT_MACROS["salvage-bookmarked-sites"]!;

const FROM = 7000001;
const DONE = 7000002;
const HOME = 60000004;
const HERE = 30000142;
const ELSEWHERE = 30000144;
const NEAR_SITE = 9000011;
const FAR_SITE = 9000005;

const step: MacroStep = {
  id: "salvager", kind: "macro", macro: "salvage-bookmarked-sites",
  args: {
    fromFolder: { kind: "bookmarkFolder", folderID: null, name: "To Salvage" },
    doneFolder: { kind: "bookmarkFolder", folderID: null, name: "Salvaged" },
    station: { kind: "station", ref: { entity: "station", id: HOME, name: "Home", systemName: null } },
  },
} as never;

function flight(over: Partial<FlightStatus> = {}): FlightStatus {
  return { inSpace: true, docked: false, solarSystemID: HERE, stationID: null, structureID: null, shipID: 9001, shipTypeID: null, shipIsCapsule: null, shipMode: null, shipSpeedFraction: null, ...over };
}
const dockedHome = flight({ inSpace: false, docked: true, stationID: HOME });

const bothOn = {
  known: [
    { folderID: FROM, name: "To Salvage", isPersonal: false, isActive: true },
    { folderID: DONE, name: "Salvaged", isPersonal: false, isActive: true },
  ],
  addable: [],
};
const sites = [
  { bookmarkID: FAR_SITE, name: "Site", folderID: FROM, solarSystemID: ELSEWHERE },
  { bookmarkID: NEAR_SITE, name: "Site", folderID: FROM, solarSystemID: HERE },
  { bookmarkID: 9000099, name: "Old", folderID: DONE, solarSystemID: HERE },
];

const SHIP = { itemID: 9001, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, activeModuleIDs: [], activeModuleTargets: [], moduleRanges: [] };

function obs(over: Partial<ScriptObservation> = {}): ScriptObservation {
  return {
    inSpace: true, docked: false, inWarp: false,
    shieldRatio: 1, armorRatio: 1, hullRatio: 1, health: 1,
    oreHoldFraction: 0, holdEmpty: true, hostileOnGrid: false, dronesOut: false,
    flightStatus: flight(),
    bookmarkFolders: bothOn,
    bookmarks: sites,
    snapshot: { ship: SHIP, entities: [] } as never,
    salvageModuleIDs: [501],
    ...over,
  } as ScriptObservation;
}
const ready: MacroMemory = { foldersReady: true, fromID: FROM, doneID: DONE, unloadChecked: true };

test("salvager: takes its folders up first, by the folder block's own rule", () => {
  const t = salvager(step, obs({ bookmarkFolders: { known: [], addable: [
    { folderID: FROM, name: "To Salvage", isPersonal: false }, { folderID: DONE, name: "Salvaged", isPersonal: false },
  ] } }), {}, NB);
  assert.deepEqual(t.action, { kind: "addKnownFolder", folderID: FROM });
  // Both on: the folders are remembered by their numbers.
  const on = salvager(step, obs(), {}, NB);
  assert.equal(on.nextMem["foldersReady"], true);
  assert.deepEqual([on.nextMem["fromID"], on.nextMem["doneID"]], [FROM, DONE]);
});

test("salvager: picks this system's site first and warps to it by its number", () => {
  const t = salvager(step, obs(), ready, NB);
  assert.deepEqual(t.action, { kind: "warpBookmark", bookmarkID: NEAR_SITE });
  assert.equal(t.nextMem["site"], NEAR_SITE);
});

test("salvager: a site in another system is travelled to first", () => {
  const t = salvager(step, obs({ bookmarks: [sites[0]!] }), ready, NB);
  assert.deepEqual(t.action, { kind: "startSystemRoute", systemID: ELSEWHERE });
});

test("salvager: on grid with nothing to loot or salvage, the site is finished and its bookmark filed", () => {
  const landed = { ...ready, site: NEAR_SITE, stage: "warp", warp: { issued: true, sawWarp: true } };
  const t = salvager(step, obs(), landed, NB);
  assert.deepEqual(t.action, { kind: "moveBookmarks", fromFolderID: FROM, toFolderID: DONE, bookmarkIDs: [NEAR_SITE] });
  // Still in the from-folder on the next read: wait, then ask again, then stop.
  let mem = t.nextMem;
  const kinds: string[] = [];
  for (let i = 0; i < 9; i++) {
    const again = salvager(step, obs(), mem, NB);
    kinds.push(again.outcome.kind === "blocked" ? "blocked" : again.action.kind);
    if (again.outcome.kind === "blocked") break;
    mem = again.nextMem;
  }
  assert.deepEqual(kinds, ["wait", "wait", "moveBookmarks", "wait", "wait", "moveBookmarks", "wait", "wait", "blocked"]);
});

test("salvager: once the bookmark has left the folder, the next site is picked", () => {
  const filed = { ...ready, site: NEAR_SITE, stage: "file", filing: NEAR_SITE, fileWaits: 0, fileTries: 1 };
  const t = salvager(step, obs({ bookmarks: [sites[0]!, sites[2]!] }), filed, NB);
  assert.deepEqual(t.action, { kind: "startSystemRoute", systemID: ELSEWHERE });
  assert.equal(t.nextMem["site"], FAR_SITE);
});

test("salvager: a hold with no room after looting goes home to unload, keeping the site", () => {
  const looting = { ...ready, site: NEAR_SITE, stage: "site" };
  const full = obs({ holds: [{ key: "cargo", present: true, capacity: { capacity: 100, used: 100 } }] as never });
  const t = salvager(step, full, looting, NB);
  assert.equal(t.nextMem["returning"], true);
  assert.equal(t.nextMem["site"], null);
  const home = salvager(step, full, t.nextMem, NB);
  assert.deepEqual(home.action, { kind: "startRoute", stationID: HOME });
});

test("salvager: no site left in space flies home; docked there it waits, and after a long wait finishes for the next pass", () => {
  const none = obs({ bookmarks: [sites[2]!] });
  assert.deepEqual(salvager(step, none, ready, NB).action, { kind: "startRoute", stationID: HOME });
  const waiting = salvager(step, obs({ bookmarks: [sites[2]!], flightStatus: dockedHome }), ready, NB);
  assert.equal(waiting.action.kind, "wait");
  assert.equal(waiting.outcome.kind, "acting");
  const long = salvager(step, obs({ bookmarks: [sites[2]!], flightStatus: dockedHome }), { ...ready, idle: 749 }, NB);
  assert.equal(long.outcome.kind, "done");
});

test("salvager: docked at its station it empties the hold first, then leaves for a site", () => {
  const atHome = obs({ flightStatus: dockedHome, cargo: { rows: [] } as never, shipBays: [] });
  const first = salvager(step, atHome, { ...ready, unloadChecked: false }, NB);
  assert.equal(first.nextMem["unloading"], true);
  const unloaded = salvager(step, atHome, first.nextMem, NB);
  assert.deepEqual(unloaded.action, { kind: "undock" });
  // Cargo aboard: unloaded into the hangar first.
  const laden = obs({ flightStatus: dockedHome, cargo: { rows: [{ itemID: 77, typeID: 25590, quantity: 3, groupID: 754 }] } as never, shipBays: [] });
  const unload = salvager(step, laden, first.nextMem, NB);
  assert.equal(unload.action.kind, "unloadHolds");
});

test("salvager: a ship with wrecks before it and no way to salvage stops with a sentence", () => {
  // Another player's wreck: ours to salvage, not to loot, and nothing aboard salvages.
  const wreck = { itemID: 4001, kind: "wreck", ownerID: 90000555, corporationID: 98999955, position: { x: 0, y: 0, z: 0 } };
  const t = salvager(step, obs({ salvageModuleIDs: [], snapshot: { ship: SHIP, entities: [wreck] } as never }), { ...ready, site: NEAR_SITE, stage: "site" }, NB);
  assert.equal(t.outcome.kind, "blocked");
});

test("salvager: the same folder twice is refused", () => {
  const same: MacroStep = { ...step, args: { ...step.args, doneFolder: step.args["fromFolder"]! } } as never;
  const t = salvager(same, obs({ bookmarkFolders: { known: [bothOn.known[0]!], addable: [] } }), {}, NB);
  assert.equal(t.outcome.kind, "blocked");
});

test("loot: a wreck left by a member of the pilot's PLAYER corporation is the pilot's to open; in an NPC corporation it is not", () => {
  const loot = SCRIPT_MACROS["loot-wrecks"]!;
  const lootStep: MacroStep = { id: "loot", kind: "macro", macro: "loot-wrecks", args: {} } as never;
  const PLAYER_CORP = 98999901;
  const NPC_CORP = 1000044;
  const mate = (corporationID: number) => ({ itemID: 4002, kind: "wreck", ownerID: 90000002, corporationID, position: { x: 0, y: 0, z: 0 } });
  const seen = (myCorporationID: number, corporationID: number) =>
    loot(lootStep, obs({ myCharacterID: 90000001, myCorporationID, snapshot: { ship: null, entities: [mate(corporationID)] } as never }), {}, NB).outcome.kind;
  assert.notEqual(seen(PLAYER_CORP, PLAYER_CORP), "done");
  assert.equal(seen(NPC_CORP, NPC_CORP), "done");
  assert.equal(seen(PLAYER_CORP, 98999902), "done");
});

test("salvager: a site bookmarked under two and a half minutes ago is left until the server lets it be warped to", () => {
  const young = [{ bookmarkID: NEAR_SITE, name: "Site", folderID: FROM, solarSystemID: HERE, ageMs: 30_000 }];
  // In space with only a young site: wait where it is, neither warping nor flying home.
  const waits = salvager(step, obs({ bookmarks: young }), ready, NB);
  assert.equal(waits.action.kind, "wait");
  assert.match(waits.why, /just now/);
  // Old enough: warped to.
  const opened = salvager(step, obs({ bookmarks: [{ ...young[0]!, ageMs: 200_000 }] }), ready, NB);
  assert.deepEqual(opened.action, { kind: "warpBookmark", bookmarkID: NEAR_SITE });
  // An older site is taken before a young one.
  const both = salvager(step, obs({ bookmarks: [young[0]!, { ...sites[0]!, ageMs: 600_000 }] }), ready, NB);
  assert.deepEqual(both.action, { kind: "startSystemRoute", systemID: ELSEWHERE });
});

test("on site: a far wreck of ours gets a tractor beam (no lock); one in loot range is looted first; a looted one is locked, then salvaged", () => {
  const TRACTOR = 601;
  const SALVAGER = 602;
  const onSite = { ...ready, site: NEAR_SITE, stage: "site" };
  const wreck = (itemID: number, x: number) => ({ itemID, kind: "wreck", ownerID: 90000001, corporationID: null, position: { x, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } });
  const grid = (entities: unknown[], ship = SHIP, over: Partial<ScriptObservation> = {}) => obs({
    myCharacterID: 90000001, myCorporationID: 98999901, tractorModuleIDs: [TRACTOR], salvageModuleIDs: [SALVAGER], maxLockedTargets: 3, maxTargetRangeM: 30_000,
    lockedTargetIDs: [], snapshot: { ship: { ...ship, moduleRanges: [{ moduleID: TRACTOR, rangeM: 40_000 }, { moduleID: SALVAGER, rangeM: 6_000 }] }, entities } as never, ...over,
  });

  const far = salvager(step, grid([wreck(4101, 15_000)]), onSite, NB);
  assert.deepEqual(far.action, { kind: "activate", moduleID: TRACTOR, targetID: 4101 });

  const close = salvager(step, grid([wreck(4102, 1_500)]), onSite, NB);
  assert.deepEqual(close.action, { kind: "lootWreck", wreckID: 4102 });

  // Looted (the attempt was not refused): locked, then the salvager goes on it.
  const looted = { ...onSite, work: { looted: [4102] } };
  const lock = salvager(step, grid([wreck(4102, 1_500)]), looted, NB);
  assert.deepEqual(lock.action, { kind: "lock", targetID: 4102 });
  const salvage = salvager(step, grid([wreck(4102, 1_500)], SHIP, { lockedTargetIDs: [4102] }), lock.nextMem, NB);
  assert.deepEqual(salvage.action, { kind: "activate", moduleID: SALVAGER, targetID: 4102 });
});

test("on site: a tractor beam whose wreck has arrived is switched off, so it can take the next", () => {
  const TRACTOR = 601;
  const onSite = { ...ready, site: NEAR_SITE, stage: "site", work: { looted: [4103] } };
  const arrived = { itemID: 4103, kind: "wreck", ownerID: 90000001, corporationID: null, position: { x: 600, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } };
  const t = salvager(step, obs({
    myCharacterID: 90000001, tractorModuleIDs: [TRACTOR], salvageModuleIDs: [602], maxLockedTargets: 3, maxTargetRangeM: 30_000, lockedTargetIDs: [],
    snapshot: { ship: { ...SHIP, activeModuleIDs: [TRACTOR], activeModuleTargets: [{ moduleID: TRACTOR, targetID: 4103 }], moduleRanges: [{ moduleID: TRACTOR, rangeM: 40_000 }] }, entities: [arrived] } as never,
  }), onSite, NB);
  // Looted already and inside salvage reach: the beam has nothing left to do with it.
  assert.deepEqual(t.action, { kind: "deactivate", moduleID: TRACTOR });
});
