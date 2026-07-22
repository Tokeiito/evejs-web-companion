// R72 — decoding the /api/bridge/gateway-binds reachability envelope, against
// REAL CAPTURED BYTES.
//
// LIVE_ENVELOPE is verbatim from a live probe (rrfarmer → Farmer 140000005) on
// 2026-07-22: all five gateway binds resolved; the skills gateway carried the
// session-scoped Moniker (bindParam = the session's OWN character 140000005).

import test from "node:test";
import assert from "node:assert/strict";

import type { JsonValue } from "./wire.ts";
import { decodeGatewayBinds } from "./gatewayBinds.ts";

const LIVE_ENVELOPE: JsonValue = {
  ok: true,
  gateways: {
    skillHandler: {
      bound: true,
      moniker: {
        type: "object",
        name: "carbon.common.script.net.moniker.Moniker",
        args: ["skillHandler", null, 140000005, null],
      },
    },
    dogma: { bound: true, service: "dogmaIM", method: "MachoBindObject" },
    entity: { bound: true, service: "entity", method: "MachoBindObject" },
    systemScan: { bound: true, service: "scanMgr", method: "GetSystemScanMgr" },
    fleet: { bound: true, service: "fleetObjectHandler", method: "MachoBindObject" },
  },
};

test("decodeGatewayBinds: every live gateway is reachable", () => {
  const r = decodeGatewayBinds(LIVE_ENVELOPE);
  assert.equal(r.skillHandler.reachable, true);
  assert.equal(r.dogma.reachable, true);
  assert.equal(r.entity.reachable, true);
  assert.equal(r.systemScan.reachable, true);
  assert.equal(r.fleet.reachable, true);
  for (const g of [r.dogma, r.entity, r.systemScan, r.fleet, r.skillHandler]) {
    assert.equal(g.error, null);
  }
});

test("decodeGatewayBinds: the skills Moniker is captured, session-scoped, id kept as data", () => {
  const r = decodeGatewayBinds(LIVE_ENVELOPE);
  // The Phase-2 skill reads address this service name.
  assert.equal(r.skillHandler.monikerService, "skillHandler");
  // The bind param is the session's OWN character — kept as a number (data), not a label.
  assert.equal(r.skillHandler.characterId, 140000005);
  assert.equal(typeof r.skillHandler.characterId, "number");
});

test("decodeGatewayBinds: a long-wrapped character id is unwrapped, not zeroed", () => {
  const r = decodeGatewayBinds({
    gateways: {
      skillHandler: {
        bound: true,
        moniker: {
          type: "object",
          name: "carbon.common.script.net.moniker.Moniker",
          args: ["skillHandler", null, { type: "long", value: "140000005" }, null],
        },
      },
    },
  } as JsonValue);
  assert.equal(r.skillHandler.characterId, 140000005);
});

test("decodeGatewayBinds: an unresolved gateway is reachable:false with its error code", () => {
  const r = decodeGatewayBinds({
    gateways: {
      // A bind that failed (no fleet in space, say) surfaces its code, not an exception.
      fleet: { bound: false, error: "BIND_FAILED" },
      // A gateway missing from the envelope entirely is simply not reachable.
    },
  } as JsonValue);
  assert.equal(r.fleet.reachable, false);
  assert.equal(r.fleet.error, "BIND_FAILED");
  assert.equal(r.dogma.reachable, false);
  assert.equal(r.dogma.error, null);
  // The skills gateway, absent here, has no moniker — ids stay null, never fabricated.
  assert.equal(r.skillHandler.reachable, false);
  assert.equal(r.skillHandler.monikerService, null);
  assert.equal(r.skillHandler.characterId, null);
});

test("decodeGatewayBinds: null / malformed input never throws", () => {
  const r = decodeGatewayBinds(null);
  assert.equal(r.skillHandler.reachable, false);
  assert.equal(r.dogma.reachable, false);
  assert.equal(r.skillHandler.characterId ?? null, null);
});
