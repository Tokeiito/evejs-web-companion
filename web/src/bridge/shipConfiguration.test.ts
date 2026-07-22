// R71 — decoding ship.GetShipConfiguration, against REAL CAPTURED BYTES.
//
// LIVE_CONFIG is verbatim from a live read (rrfarmer → Farmer 140000005) on
// 2026-07-22: a bare marshaled dict of six boolean sharing flags, all false.

import test from "node:test";
import assert from "node:assert/strict";

import type { JsonValue } from "./wire.ts";
import { decodeShipConfiguration } from "./shipConfiguration.ts";

const LIVE_CONFIG: JsonValue = {
  type: "dict",
  entries: [
    ["allowFleetSMBUsage", false],
    ["SMB_AllowFleetAccess", false],
    ["allowCorpSMBUsage", false],
    ["SMB_AllowCorpAccess", false],
    ["FleetHangar_AllowFleetAccess", false],
    ["FleetHangar_AllowCorpAccess", false],
  ],
};

test("decodeShipConfiguration reads Farmer's live all-false flags", () => {
  assert.deepEqual(decodeShipConfiguration(LIVE_CONFIG), {
    allowFleetSMBUsage: false,
    smbAllowFleetAccess: false,
    allowCorpSMBUsage: false,
    smbAllowCorpAccess: false,
    fleetHangarAllowFleetAccess: false,
    fleetHangarAllowCorpAccess: false,
  });
});

test("decodeShipConfiguration reads a mixed set of enabled flags", () => {
  const config = decodeShipConfiguration({
    type: "dict",
    entries: [
      ["allowFleetSMBUsage", true],
      ["SMB_AllowFleetAccess", true],
      ["allowCorpSMBUsage", false],
      ["SMB_AllowCorpAccess", false],
      ["FleetHangar_AllowFleetAccess", true],
      ["FleetHangar_AllowCorpAccess", false],
    ],
  });
  assert.equal(config?.allowFleetSMBUsage, true);
  assert.equal(config?.smbAllowFleetAccess, true);
  assert.equal(config?.fleetHangarAllowFleetAccess, true);
  assert.equal(config?.allowCorpSMBUsage, false);
  assert.equal(config?.fleetHangarAllowCorpAccess, false);
});

test("decodeShipConfiguration returns null for non-dict input (read failed / absent)", () => {
  assert.equal(decodeShipConfiguration(null), null);
  assert.equal(decodeShipConfiguration({ type: "list", items: [] } as JsonValue), null);
  // A missing flag reads as false, not absent — a partial dict still decodes.
  const partial = decodeShipConfiguration({ type: "dict", entries: [["allowFleetSMBUsage", true]] });
  assert.equal(partial?.allowFleetSMBUsage, true);
  assert.equal(partial?.allowCorpSMBUsage, false);
});
