import test from "node:test";
import assert from "node:assert/strict";
import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";
import type { BotScript, MacroStep } from "../bots/botScript.ts";
import { SHIP_ID, SOLAR_SYSTEM_ID, STRIP_MINER_ITEM_IDS, fittingBody, flightBody, holdsBody, namesBody, spaceBody } from "./botFixtures.ts";

// What the static data says of a type is asked of the BFF's copy once for a type and kept
// (bridge/keptTypeFacts.ts). These are the flow's askers that kept nothing until 2026-10-11: the base cycle times
// at every reading of the fitting; a combat bot's loadout, which asked its types' facts and its charges' sizes at
// every look; and a script's mining modules' facts at every start.

const CHARGE_TYPE = 2512;
const HARVESTER = { itemID: 7002, typeID: 16278, flagID: 29, groupID: 464, name: "Ice Harvester I", groupName: "Strip Miner" };
const MINING_FACTS = [77, 182, 183, 184, 1285, 1289, 1290];
const keyVal = (entries: unknown[][]) => ({ type: "object", args: { type: "dict", entries } });
const settle = async (turns = 6): Promise<void> => { for (let turn = 0; turn < turns; turn += 1) await new Promise<void>((resolve) => setImmediate(resolve)); };

/** A flow whose every request is kept, with the static data answering for whatever types it is asked of. */
function fixture(options: { readonly inSpace?: boolean; readonly fitting?: () => unknown } = {}) {
  const asked: { readonly path: string; readonly body: Record<string, unknown> }[] = [];
  const store = createClientStore();
  const typesOf = (path: string): number[] => (new URL(path, "http://page").searchParams.get("typeIDs") ?? "").split(",").filter(Boolean).map(Number);
  const flow = createAppFlow(store, { livePush: false, fetch: async (input, init) => {
    const path = String(input);
    const body: Record<string, unknown> = init?.body ? JSON.parse(String(init.body)) : {};
    asked.push({ path, body });
    let result: unknown = { ok: true };
    if (path === "/api/bridge/call") result = { ok: true, service: body.service, method: body.method, result: null, notifications: [] };
    if (path === "/api/bridge/select") result = { ok: true, character: { characterID: 42, characterName: "Test", stationID: 60000358 }, station: null, droneRecoveryCheckID: "check" };
    if (path === "/api/bridge/drones") result = { ok: true, inSpace: [], bay: [] };
    if (path === "/api/bridge/flight/status") result = flightBody(options.inSpace !== true);
    if (path === "/api/bridge/fitting") result = (options.fitting ?? fittingBody)();
    if (path === "/api/bridge/ship/ore-hold") result = holdsBody(0, []);
    if (path === "/api/bridge/bound-dogma") result = { ok: true, reads: { GetAllInfo: { result: keyVal([["activeShipID", SHIP_ID]]) } } };
    if (path === "/api/bridge/inventory") {
      result = { ok: true, stationID: null, activeShipID: SHIP_ID, volumes: {},
        hangar: { list: { type: "list", items: [] }, capacity: null, error: null },
        cargo: { shipID: SHIP_ID, capacity: null, error: null, list: { type: "list", items: [
          { type: "packedrow", fields: { itemID: 5001, typeID: CHARGE_TYPE, quantity: 100, flagID: 5, categoryID: 8, groupID: 387 } },
        ] } } };
    }
    if (path === "/api/names") {
      const names = { ...(namesBody(body) as { names: Record<string, string> }).names, [`type:${HARVESTER.typeID}`]: HARVESTER.name, [`typeGroup:${HARVESTER.typeID}`]: HARVESTER.groupName };
      result = { ok: true, source: "static-data", count: Object.keys(names).length, names, unresolved: [] };
    }
    if (path === "/api/bridge/targets") result = { ok: true, targetIDs: [] };
    if (path === "/api/bridge/script/observation" || (path === "/api/bridge/space/snapshot" && options.inSpace === true)) {
      const sample = spaceBody() as { space: { ship: object } };
      result = { ok: true, activeShipID: SHIP_ID, bay: [], inSpace: [{ itemID: 7007, typeID: 2454,
        controlled: true, reconnectCandidate: false, activity: "idle", shieldRatio: 1, armorRatio: 1, hullRatio: 1 }],
        space: { ...sample.space, ship: { ...sample.space.ship, weaponBanks: {} }, entities: [
          { itemID: 7007, typeID: 2454, kind: "drone", controllerID: SHIP_ID, radius: 5,
            position: { x: 100, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } },
          { itemID: 8008, typeID: 999, kind: "ship", isNpc: true, npcEntityType: "npc", radius: 50,
            position: { x: 5000, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } },
        ] } };
    } else if (path === "/api/bridge/space/snapshot") {
      result = { ok: true, space: { inSpace: false, shipID: SHIP_ID, sampledAtMs: 400,
        ship: { itemID: SHIP_ID, characterID: 42, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, radius: 50, geometryAvailable: true } } };
    }
    if (path.startsWith("/api/types/cycle-times")) result = { ok: true, source: "static-data", baseCycleMs: Object.fromEntries(typesOf(path).map((typeID) => [typeID, 180_000 + typeID])) };
    if (path.startsWith("/api/types/combat-utility")) {
      result = { ok: true, types: Object.fromEntries(typesOf(path).map((typeID) => [typeID,
        { typeID, groupID: 1, categoryID: 7, effects: [], attributes: {}, capacity: null, volume: null }])) };
    }
    if (path === "/api/types/dogma") {
      const wanted = body.attributeIDs as number[];
      result = { ok: true, attributes: Object.fromEntries((body.typeIDs as number[]).map((typeID) => [typeID,
        wanted.includes(77) ? { 77: 1000, 182: 16281 } : wanted.includes(128) ? { 128: 1 } : {}])) };
    }
    return Response.json(result);
  } });
  const paths = (beginning: string): string[] => asked.map((each) => each.path).filter((path) => path.startsWith(beginning));
  const attributesAsked = (attributeID: number) => asked.filter((each) => each.path === "/api/types/dogma" && (each.body.attributeIDs as number[]).includes(attributeID)).map((each) => each.body);
  return { store, flow, asked, paths, typesOf, attributesAsked };
}

test("a module type's base cycle time is asked of the static data once: a fitting read again asks nothing, and a type fitted since is asked for alone", async () => {
  let fitted: readonly (typeof HARVESTER)[] = [];
  const f = fixture({ fitting: () => fittingBody({ extraModules: fitted }) });
  const cycleOf = (moduleID: number) => f.store.targeting.get().moduleCycles[moduleID] ?? null;
  await f.flow.loadFitting(); await settle();
  const first = f.paths("/api/types/cycle-times");
  assert.equal(first.length, 1);
  const types = f.typesOf(first[0]!);
  assert.ok(types.length > 1 && !types.includes(HARVESTER.typeID), String(types));
  const slots = f.store.fitting.get().slots.flatMap((slot) => (slot.module ? [slot.module] : []));
  assert.ok(slots.length > 1);
  for (const module of slots) assert.deepEqual([cycleOf(module.itemID)?.durationMs, cycleOf(module.itemID)?.source], [180_000 + module.typeID, "base"], String(module.itemID));

  await f.flow.loadFitting(); await settle();
  await f.flow.loadFitting(); await settle();
  assert.equal(f.paths("/api/types/cycle-times").length, 1, "read again, the fitting asks nothing of the static data");

  fitted = [HARVESTER];
  await f.flow.loadFitting(); await settle();
  const all = f.paths("/api/types/cycle-times");
  assert.equal(all.length, 2);
  assert.deepEqual(f.typesOf(all[1]!), [HARVESTER.typeID], "the type fitted since, and no other");
  // And each module has its type's time, the ones told before and the one told now.
  assert.deepEqual([cycleOf(HARVESTER.itemID)?.durationMs, cycleOf(slots[0]!.itemID)?.durationMs], [180_000 + HARVESTER.typeID, 180_000 + slots[0]!.typeID]);
});

test("a combat bot's loadout asks the static data of a type once: its types' facts and its charges' sizes, however often it looks", { timeout: 20_000 }, async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture({ inSpace: true });
  f.store.apply({ type: "character/online", character: { characterID: 90000001, characterName: "Test",
    corporationID: 98000000, stationID: null, structureID: null, solarSystemID: SOLAR_SYSTEM_ID }, station: null });
  const combat: BotScript = { format: "evejs-bot-script", version: 1, name: "Loadout", notes: "",
    home: { entity: "station", id: 60003760, name: "Home", systemName: "Test" }, interrupts: [],
    program: [{ id: "fight", kind: "macro", macro: "fight-with-drones", args: {} }] };
  try {
    await f.flow.startCustomBot(combat);
    for (let turn = 0; turn < 20; turn += 1) { context.mock.timers.tick(2000); await settle(); }
    assert.equal(f.store.customBot.get().status, "running");
    // The loadout was read at every look: its fitting, its hold.
    const looks = f.paths("/api/bridge/inventory").length;
    assert.ok(looks >= 10, String(looks));
    // And the static data asked once: for the types fitted and held, and for the held charge's size.
    const facts = f.paths("/api/types/combat-utility");
    assert.equal(facts.length, 1, `${facts.length} for ${looks} looks`);
    assert.ok(f.typesOf(facts[0]!).includes(CHARGE_TYPE) && f.typesOf(facts[0]!).length > 2, String(facts[0]));
    assert.deepEqual(f.attributesAsked(128), [{ typeIDs: [CHARGE_TYPE], attributeIDs: [128] }]);
  } finally {
    f.flow.stopCustomBot();
    await settle();
  }
});

test("a script's mining modules' facts are asked of the static data once, started again or not", async () => {
  const wait: MacroStep = { id: "wait", kind: "macro", macro: "wait", args: { seconds: { kind: "count", value: 500 } } };
  const mine = (id: string, mode: "site" | "ice-site"): MacroStep => ({ id, kind: "macro", macro: "mine-at-belt", args: { belt: { kind: "belt", belt: { mode } } } });
  const script: BotScript = { format: "evejs-bot-script", version: 1, name: "Ore and ice", notes: "",
    home: { entity: "station", id: 60000358, name: "Home", systemName: null }, interrupts: [], program: [wait, mine("ore", "site"), mine("ice", "ice-site")] };
  const f = fixture({ fitting: () => fittingBody({ offline: STRIP_MINER_ITEM_IDS, extraModules: [HARVESTER] }) });
  await f.flow.selectCharacter(42);
  try {
    await f.flow.startCustomBot(script);
    assert.equal(f.store.customBot.get().status, "running");
    assert.deepEqual(f.attributesAsked(77), [{ typeIDs: [HARVESTER.typeID], attributeIDs: MINING_FACTS }]);
    f.flow.stopCustomBot(); await settle();
    await f.flow.startCustomBot(script);
    assert.equal(f.store.customBot.get().status, "running");
    assert.equal(f.attributesAsked(77).length, 1, "started again, it asks nothing of the static data");
  } finally {
    f.flow.stopCustomBot();
    await settle();
  }
});
