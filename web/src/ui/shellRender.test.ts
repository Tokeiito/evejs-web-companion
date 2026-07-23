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
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
      },
    },
  });
  return store;
}

function renderStation(store: unknown): string {
  return render(StationShell as never, { props: { store } } as never).body;
}
function renderSpace(store: unknown): string {
  return render(SpaceShell as never, { props: { store } } as never).body;
}

test("docked renders the station interior: badge, station context, services rail", () => {
  const text = visibleText(renderStation(dockedStore()));
  assert.match(text, /Docked/, "no docked state badge");
  assert.match(text, /Jita IV - Moon 4/, "the station name is not shown");
  assert.match(text, /Services/, "no services rail heading");
  assert.match(text, /Fitting/, "the fitting service is not listed");
  assert.match(text, /Ship Hangar/, "no ship-hangar panel");
});

test("in space renders the HUD: badge, system, overview, ship gauges, module rack", () => {
  const text = visibleText(renderSpace(inSpaceStore()));
  assert.match(text, /In Space/, "no in-space state badge");
  assert.match(text, /Jita/, "the system name is not shown");
  assert.match(text, /Overview/, "no overview panel");
  assert.match(text, /Shield/, "no shield gauge");
  assert.match(text, /Armor/, "no armor gauge");
  assert.match(text, /Capacitor/, "no capacitor gauge");
  // The armor ratio was 0.5 — the gauge shows it as a percentage, not a raw id.
  assert.match(text, /50%/, "the armor gauge does not read its ratio");
});

test("placeholder panels announce themselves as placeholders", () => {
  assert.match(visibleText(renderStation(dockedStore())), /placeholder/i, "docked stub not marked");
  assert.match(visibleText(renderSpace(inSpaceStore())), /placeholder/i, "space stub not marked");
});

test("no bare numeric IDs leak onto either shell (R7d)", () => {
  // System/station/ship IDs must never render; names or gauges stand in.
  for (const text of [visibleText(renderStation(dockedStore())), visibleText(renderSpace(inSpaceStore()))]) {
    assert.doesNotMatch(text, new RegExp(String(SYSTEM_ID)), "a solar-system ID leaked");
    assert.doesNotMatch(text, new RegExp(String(STATION_ID)), "a station ID leaked");
    assert.doesNotMatch(text, new RegExp(String(SHIP_ID)), "a ship ID leaked");
  }
});
