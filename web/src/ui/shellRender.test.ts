// The two shells as they actually RENDER (SSR), so the docked/in-space split is
// checked against real output rather than trusted. The point of this pass is
// that the WHOLE UI follows the state: docked must render the station interior
// (services rail + station context), in space must render the HUD (viewport +
// overview + ship gauges). Each also proves the placeholder is visibly a
// placeholder, and the standing R7d invariant (no bare numeric IDs on screen).

import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./svelteSsrHook.ts", import.meta.url);

const { render } = await import("svelte/server");
const { createClientStore } = await import("../store/clientStore.ts");
const StationShell = (await import("./StationShell.svelte")).default;
const SpaceShell = (await import("./SpaceShell.svelte")).default;
const Neocom = (await import("./Neocom.svelte")).default;
const PanelHost = (await import("./PanelHost.svelte")).default;
const TargetBracket = (await import("./TargetBracket.svelte")).default;
const ShipHangar = (await import("./ShipHangar.svelte")).default;

/** A flow stub — the server generator never runs onMount / handlers. */
function fakeFlow(): unknown {
  return new Proxy({}, { get: () => async () => {} });
}

const SHIP_ID = 9001;
const SHIP_TYPE_ID = 622;
const STATION_ID = 60000358;
const SYSTEM_ID = 30000142;

/** Everything visible to a player, markup + images stripped. */
function visibleText(body: string): string {
  return body
    .replace(/<img[^>]*>/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dockedStore(): unknown {
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

function inSpaceStore(): unknown {
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
        armorRatio: 0.5,
        hullRatio: 1,
        capacitorRatio: 0.75,
        shieldCapacity: 400,
        armorCapacity: 300,
        hullCapacity: 600,
        radius: 100,
        maxVelocity: 300,
        activeModuleIDs: [],
        overloadedModuleIDs: [],
        moduleDamage: {},
        weaponBanks: {},
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
      },
    },
  });
  return store;
}

function renderStation(store: unknown): string {
  return render(StationShell as never, {
    props: { store, flow: fakeFlow(), onOpen: () => {} },
  } as never).body;
}
function renderSpace(store: unknown): string {
  return render(SpaceShell as never, {
    props: { store, flow: fakeFlow(), onOpen: () => {} },
  } as never).body;
}

test("docked renders the station interior: badge, station context, services rail", () => {
  const text = visibleText(renderStation(dockedStore()));
  assert.match(text, /Docked/, "no docked state badge");
  assert.match(text, /Jita IV - Moon 4/, "the station name is not shown");
  assert.match(text, /Services/, "no services rail heading");
  assert.match(text, /Fitting/, "the fitting service is not listed");
  assert.match(text, /Hangar/, "no ship/item hangar shortcut");
  // Travel + Bots moved into the docked services rail.
  assert.match(text, /Travel/, "Travel is not in the docked services");
  assert.match(text, /Bots/, "Bots is not in the docked services");
  // The Undock control is present.
  assert.match(text, /Undock/, "no undock control");
});

test("in space renders the HUD: badge, system, ship gauges, module rack, nav", () => {
  const text = visibleText(renderSpace(inSpaceStore()));
  assert.match(text, /In Space/, "no in-space state badge");
  assert.match(text, /Jita/, "the system name is not shown");
  assert.match(text, /Shield/, "no shield gauge");
  assert.match(text, /Armor/, "no armor gauge");
  assert.match(text, /Capacitor/, "no capacitor gauge");
  // The armor ratio was 0.5 — the gauge shows it as a percentage, not a raw id.
  assert.match(text, /50%/, "the armor gauge does not read its ratio");
  assert.match(text, /Modules/, "no module rack");
  // The HUD dock's nav opens Mining as a full panel.
  assert.match(text, /Mining/, "no mining nav control");
  // The Dock control is present (disabled here — no station on this empty grid).
  assert.match(text, /Dock/, "no dock control");
});

test("the module rack renders real high/mid/low rows (no longer a placeholder)", () => {
  const text = visibleText(renderSpace(inSpaceStore()));
  // The three EVE activation racks are always drawn...
  assert.match(text, /High/, "no high rack row");
  assert.match(text, /Mid/, "no mid rack row");
  assert.match(text, /Low/, "no low rack row");
  // ...and with no fit loaded (this store never loaded fitting) the neutral hint
  // shows instead of an invented module — and the "placeholder" pill is gone.
  assert.match(text, /fitting has loaded/, "no empty-rack hint");
  assert.doesNotMatch(text, /placeholder/i, "the module rack still claims to be a placeholder");
});

test("the ship-hangar summary renders (docked home content)", () => {
  const text = visibleText(
    render(ShipHangar as never, { props: { store: createClientStore(), onOpen: () => {} } } as never).body,
  );
  assert.match(text, /Ship Hangar/, "no ship-hangar heading");
});

test("the target bracket names a locked target and shows its condition", () => {
  const store = createClientStore();
  const target = {
    kind: "ship",
    itemID: 7777,
    typeID: 587,
    groupID: null,
    categoryID: null,
    name: "Guristas Wight",
    ownerID: null,
    radius: 30,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    isSelf: false,
    shieldRatio: 0.4,
    armorRatio: 0.9,
    hullRatio: 1,
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
    isNpc: true,
    npcEntityType: "npc",
  };
  store.apply({
    type: "space/snapshot",
    snapshot: {
      inSpace: true,
      solarSystemID: SYSTEM_ID,
      shipID: SHIP_ID,
      sampledAtMs: 1_700_000_000_000,
      entities: [target],
      ship: null,
    },
  } as never);
  store.apply({ type: "targeting/targets", targetIDs: [7777] } as never);

  const text = visibleText(render(TargetBracket as never, { props: { store } } as never).body);
  assert.match(text, /Guristas Wight/, "the locked target's name is missing");
  assert.match(text, /40%/, "the target's shield condition is missing");
  // The target's own itemID must never render (R7d).
  assert.doesNotMatch(text, /7777/, "a target itemID leaked");
});

function renderNeocom(isDocked: boolean): string {
  return render(Neocom as never, {
    props: { isDocked, openIds: new Set(), focusedId: null, onSelect: () => {} },
  } as never).body;
}

test("the neocom launches every openable panel for the current state (badge tracks state)", () => {
  const docked = visibleText(renderNeocom(true));
  const space = visibleText(renderNeocom(false));
  // The static set — reachable docked or in space — is in both.
  for (const label of ["Market", "Wallet", "Mail", "Skills", "Standings", "Planets"]) {
    assert.match(docked, new RegExp(label), `${label} missing from the docked neocom`);
    assert.match(space, new RegExp(label), `${label} missing from the in-space neocom`);
  }
  // No state badge in the rail: the workspace header's badge and the character
  // chips already carry docked/in-space — the rail proves its state through
  // WHICH tabs it offers (asserted below), not a third label.
  assert.doesNotMatch(docked, /Docked/);
  assert.doesNotMatch(space, /In Space/);
  // The windowing refactor makes the neocom the launcher for the state's panels,
  // so state-specific tabs DO appear now — but only in their own state.
  assert.match(space, /Flight/, "the in-space Flight tab is missing from the in-space neocom");
  assert.doesNotMatch(docked, /Flight/, "an in-space-only tab leaked into the docked neocom");
  assert.match(docked, /Fitting/, "the docked Fitting tab is missing from the docked neocom");
  assert.doesNotMatch(space, /Fitting/, "a docked-only tab leaked into the in-space neocom");
  // The two fixed-chrome panels live in the top-right dock panel, not the rail.
  assert.doesNotMatch(space, /Around Your Ship/, "the overview (chrome) leaked into the neocom");
});

test("the panel host renders the real panel for a selected tab (static or state-specific)", () => {
  const wallet = render(PanelHost as never, {
    props: { store: createClientStore(), flow: fakeFlow(), tab: "wallet" },
  } as never).body;
  const market = render(PanelHost as never, {
    props: { store: createClientStore(), flow: fakeFlow(), tab: "market" },
  } as never).body;
  // A state-specific tab (Fitting is docked-only) resolves through the same host.
  const fitting = render(PanelHost as never, {
    props: { store: createClientStore(), flow: fakeFlow(), tab: "fitting" },
  } as never).body;
  assert.ok(wallet.length > 0, "the wallet panel rendered nothing");
  assert.notEqual(wallet, market, "wallet and market rendered identical output");
  assert.notEqual(wallet, fitting, "wallet and fitting rendered identical output");
});

test("no bare numeric IDs leak onto either shell (R7d)", () => {
  // System/station/ship IDs must never render; names or gauges stand in.
  for (const text of [visibleText(renderStation(dockedStore())), visibleText(renderSpace(inSpaceStore()))]) {
    assert.doesNotMatch(text, new RegExp(String(SYSTEM_ID)), "a solar-system ID leaked");
    assert.doesNotMatch(text, new RegExp(String(STATION_ID)), "a station ID leaked");
    assert.doesNotMatch(text, new RegExp(String(SHIP_ID)), "a ship ID leaked");
  }
});
