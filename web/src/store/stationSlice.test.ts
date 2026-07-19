// The R2 station slice: character/online resets the panel for the fresh
// docked entry, the docked-read events populate it, and offline/logout clear
// it.

import test from "node:test";
import assert from "node:assert/strict";

import { createClientStore } from "./clientStore.ts";
import type { OnlineCharacterState, StationStatic } from "./types.ts";

const ONLINE: OnlineCharacterState = {
  characterID: 140000003,
  characterName: "Test Three",
  stationID: 60003760,
  structureID: null,
  solarSystemID: 30000142,
  corporationID: 98000000,
};

const STATION: StationStatic = {
  stationID: 60003760,
  stationName: "Jita IV - Moon 4 - Caldari Navy Assembly Plant",
  solarSystemName: "Jita",
  regionName: "The Forge",
  stationTypeID: 1529,
  stationTypeName: "Caldari Administrative Station",
  operationID: 26,
  security: 0.9,
};

test("character/online seeds the station slice and resets stale panel reads", () => {
  const store = createClientStore();
  store.apply({ type: "station/bits", bits: { ownerID: 1, stationID: 2, operationID: 3, stationTypeID: 4 } });
  store.apply({ type: "character/online", character: ONLINE, station: STATION });

  const slice = store.station.get();
  assert.deepEqual(slice.online, ONLINE);
  assert.deepEqual(slice.station, STATION);
  assert.equal(slice.bits, null, "stale bits must not survive a fresh docked entry");
  assert.deepEqual(slice.guests, []);
  assert.equal(slice.stationInfoCached, null);
});

test("docked-read events populate the panel on the live session", () => {
  const store = createClientStore();
  store.apply({ type: "character/online", character: ONLINE, station: STATION });
  store.apply({
    type: "station/bits",
    bits: { ownerID: 1000035, stationID: 60003760, operationID: 26, stationTypeID: 1529 },
  });
  store.apply({
    type: "station/guests",
    guests: [
      { characterID: 140000003, corporationID: 98000000, allianceID: null, warFactionID: null },
    ],
  });
  store.apply({ type: "station/info-cached", cached: true });

  const slice = store.station.get();
  assert.equal(slice.bits?.stationID, 60003760);
  assert.equal(slice.guests.length, 1);
  assert.equal(slice.guests[0]?.characterID, 140000003);
  assert.equal(slice.stationInfoCached, true);
});

test("character/offline and session/logged-out clear the station slice", () => {
  const store = createClientStore();
  store.apply({ type: "character/online", character: ONLINE, station: STATION });
  store.apply({ type: "character/offline" });
  assert.equal(store.station.get().online, null);

  store.apply({ type: "character/online", character: ONLINE, station: STATION });
  store.apply({ type: "session/logged-out" });
  assert.equal(store.station.get().online, null);
  assert.equal(store.station.get().station, null);
});

test("whole-store subscribers see one notification per applied station event", () => {
  const store = createClientStore();
  let notifications = -1; // subscribe fires synchronously once with current state
  store.subscribe(() => {
    notifications += 1;
  });
  store.apply({ type: "character/online", character: ONLINE, station: STATION });
  store.apply({ type: "station/info-cached", cached: true });
  assert.equal(notifications, 2);
  assert.equal(store.get().station.stationInfoCached, true);
});
