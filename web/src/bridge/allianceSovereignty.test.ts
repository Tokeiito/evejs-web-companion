// R84 allianceRegistry sovereignty-config decoders (capital system / prime time) against
// REAL captured bytes.
//
// The fixtures are the EXACT retail shapes captured live through /api/bridge/call on
// 2026-07-22: as Test Two (a member of Elysian 99000000) GetCapitalSystemInfo returned all
// nulls (no capital set) and GetPrimeTimeInfo returned currentPrimeHour 2 (a real populated
// value); as Farmer INJECTING allianceID 99000000 GetPrimeTimeInfo returned 0 (the injected
// id ignored). The populated capital-transition fixture mirrors the builder
// (buildAllianceCapitalInfoPayload) exactly. validAfter FILETIMEs survive as raw strings.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeCapitalSystemInfo,
  decodePrimeTimeInfo,
} from "./allianceSovereignty.ts";
import type { JsonValue } from "./wire.ts";

function keyVal(entries: readonly (readonly [string, JsonValue])[]): JsonValue {
  return {
    type: "object",
    name: "util.KeyVal",
    args: { type: "dict", entries: entries.map((e) => [e[0], e[1]]) },
  };
}

// --- GetCapitalSystemInfo --------------------------------------------------

// Elysian's REAL capital info (no capital set), verbatim.
const REAL_CAPITAL_NULL = keyVal([
  ["currentCapitalSystem", null],
  ["newCapitalSystem", null],
  ["newCapitalSystemValidAfter", { type: "long", value: "0" }],
]);

// Builder-mirrored populated capital transition.
const CAPITAL_TRANSITION = keyVal([
  ["currentCapitalSystem", 30000142],
  ["newCapitalSystem", 30000144],
  ["newCapitalSystemValidAfter", { type: "long", value: "134274243506850000" }],
]);

test("decodeCapitalSystemInfo reads the real all-null capital state", () => {
  assert.deepEqual(decodeCapitalSystemInfo(REAL_CAPITAL_NULL), {
    currentCapitalSystem: null,
    newCapitalSystem: null,
    newCapitalSystemValidAfter: "0",
  });
});

test("decodeCapitalSystemInfo reads a capital transition, validAfter as a string", () => {
  const info = decodeCapitalSystemInfo(CAPITAL_TRANSITION)!;
  assert.equal(info.currentCapitalSystem, 30000142);
  assert.equal(info.newCapitalSystem, 30000144);
  assert.equal(info.newCapitalSystemValidAfter, "134274243506850000");
  assert.equal(typeof info.newCapitalSystemValidAfter, "string");
});

test("decodeCapitalSystemInfo returns null for a non-KeyVal value", () => {
  assert.equal(decodeCapitalSystemInfo(null), null);
  assert.equal(decodeCapitalSystemInfo({ type: "list", items: [] }), null);
});

// --- GetPrimeTimeInfo ------------------------------------------------------

// Test Two's REAL prime info (currentPrimeHour 2 — a real populated value), verbatim.
const REAL_PRIME_ELYSIAN = keyVal([
  ["currentPrimeHour", 2],
  ["newPrimeHour", 2],
  ["newPrimeHourValidAfter", { type: "long", value: "0" }],
]);

// Farmer's REAL prime info (alliance-less / injected id ignored -> 0), verbatim.
const REAL_PRIME_FARMER = keyVal([
  ["currentPrimeHour", 0],
  ["newPrimeHour", 0],
  ["newPrimeHourValidAfter", { type: "long", value: "0" }],
]);

test("decodePrimeTimeInfo reads Elysian's real populated prime hour (2)", () => {
  assert.deepEqual(decodePrimeTimeInfo(REAL_PRIME_ELYSIAN), {
    currentPrimeHour: 2,
    newPrimeHour: 2,
    newPrimeHourValidAfter: "0",
  });
});

test("decodePrimeTimeInfo reads the alliance-less 0-hour state", () => {
  assert.deepEqual(decodePrimeTimeInfo(REAL_PRIME_FARMER), {
    currentPrimeHour: 0,
    newPrimeHour: 0,
    newPrimeHourValidAfter: "0",
  });
});

test("decodePrimeTimeInfo returns null for a non-KeyVal value", () => {
  assert.equal(decodePrimeTimeInfo(null), null);
});
