// The R5a flight-status decoder: plain scalars and long-aware IDs
// (docs/bridge-wire-contract.md decoder rule). Proves the docked/in-space
// derivation and that {type:"long"} ID wrappers decode instead of zeroing.

import test from "node:test";
import assert from "node:assert/strict";

import { decodeFlightStatus } from "./flight.ts";

test("decodes an in-space snapshot (plain scalars)", () => {
  const status = decodeFlightStatus({
    inSpace: true,
    docked: false,
    solarSystemID: 30000142,
    stationID: null,
    structureID: null,
    shipID: 9988400022009,
    shipMode: "WARP",
    shipSpeedFraction: 1,
  });
  assert.equal(status.inSpace, true);
  assert.equal(status.docked, false);
  assert.equal(status.solarSystemID, 30000142);
  assert.equal(status.stationID, null);
  assert.equal(status.shipID, 9988400022009);
  assert.equal(status.shipMode, "WARP");
  assert.equal(status.shipSpeedFraction, 1);
});

test("decodes a docked snapshot", () => {
  const status = decodeFlightStatus({
    inSpace: false,
    docked: true,
    solarSystemID: 30000142,
    stationID: 60003760,
    structureID: null,
    shipID: 9988400022009,
    shipMode: null,
    shipSpeedFraction: null,
  });
  assert.equal(status.inSpace, false);
  assert.equal(status.docked, true);
  assert.equal(status.stationID, 60003760);
  assert.equal(status.shipMode, null);
  assert.equal(status.shipSpeedFraction, null);
});

test("is long-aware: {type:'long'} ID wrappers decode instead of zeroing", () => {
  const status = decodeFlightStatus({
    inSpace: true,
    docked: false,
    // A forwarded OnSessionChanged carries long-encoded IDs; the decoder must
    // unwrap them, not fall back to 0/null.
    solarSystemID: { type: "long", value: 30000140 },
    shipID: { type: "long", value: "9988400022009" },
    shipMode: "STOP",
  });
  assert.equal(status.solarSystemID, 30000140);
  assert.equal(status.shipID, 9988400022009);
});

test("derives docked when the gateway omits the explicit flag", () => {
  const inSpace = decodeFlightStatus({ inSpace: true, stationID: null });
  assert.equal(inSpace.docked, false);
  const docked = decodeFlightStatus({ inSpace: false, stationID: 60003760 });
  assert.equal(docked.docked, true);
  const nowhere = decodeFlightStatus({ inSpace: false, stationID: null, structureID: null });
  assert.equal(nowhere.docked, false);
});

test("tolerates a malformed/empty snapshot", () => {
  const status = decodeFlightStatus(null);
  assert.equal(status.inSpace, false);
  assert.equal(status.docked, false);
  assert.equal(status.solarSystemID, null);
  assert.equal(status.shipID, null);
  assert.equal(status.shipMode, null);
});
