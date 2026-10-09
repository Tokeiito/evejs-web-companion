// Where the pilot's session is.

import test from "node:test";
import assert from "node:assert/strict";

import { sessionPlace } from "./sessionPlace.ts";

const STATION = 60000004;
const STRUCTURE = 1030000000001;
const SYSTEM = 30002780;
const ELSEWHERE = 30002778;

test("with nothing known of the pilot there is nowhere", () => {
  assert.deepEqual(sessionPlace(null, null), { locationID: null, stationID: null, solarSystemID: null });
});

test("before any flight status is read, the pilot is where it was selected", () => {
  assert.deepEqual(sessionPlace(null, { stationID: STATION, structureID: null, solarSystemID: SYSTEM }), { locationID: STATION, stationID: STATION, solarSystemID: SYSTEM });
  // A structure is a place to be, and not a station.
  assert.deepEqual(sessionPlace(null, { stationID: null, structureID: STRUCTURE, solarSystemID: SYSTEM }), { locationID: STRUCTURE, stationID: null, solarSystemID: SYSTEM });
  assert.deepEqual(sessionPlace(null, { stationID: null, structureID: null, solarSystemID: SYSTEM }), { locationID: SYSTEM, stationID: null, solarSystemID: SYSTEM });
});

test("once the flight status is read it is believed over where the pilot was selected", () => {
  const selected = { stationID: STATION, structureID: null, solarSystemID: SYSTEM };
  // Undocked: in no station, and in the solar system.
  assert.deepEqual(sessionPlace({ docked: false, stationID: null, structureID: null, solarSystemID: SYSTEM }, selected), { locationID: SYSTEM, stationID: null, solarSystemID: SYSTEM });
  // Jumped away.
  assert.deepEqual(sessionPlace({ docked: false, stationID: null, structureID: null, solarSystemID: ELSEWHERE }, selected), { locationID: ELSEWHERE, stationID: null, solarSystemID: ELSEWHERE });
  // Docked somewhere else.
  assert.deepEqual(sessionPlace({ docked: true, stationID: 60000019, structureID: null, solarSystemID: ELSEWHERE }, selected), { locationID: 60000019, stationID: 60000019, solarSystemID: ELSEWHERE });
  assert.deepEqual(sessionPlace({ docked: true, stationID: null, structureID: STRUCTURE, solarSystemID: SYSTEM }, selected), { locationID: STRUCTURE, stationID: null, solarSystemID: SYSTEM });
});

test("a pilot that is flying is in no station, even if the status still names the last one", () => {
  assert.deepEqual(sessionPlace({ docked: false, stationID: STATION, structureID: STRUCTURE, solarSystemID: SYSTEM }, null), { locationID: SYSTEM, stationID: null, solarSystemID: SYSTEM });
});
