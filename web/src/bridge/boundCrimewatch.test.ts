// R78 — decoding the 4 RB-CRIME bound reads, against REAL CAPTURED BYTES.
//
// The EMPTY fixtures are VERBATIM from a live capture on 2026-07-22 (Farmer
// 140000005: sec 0.1404, clean crimewatch state, empty transaction history). The
// POPULATED timer + flagged-set fixtures mirror the SERVER's own encoders
// (crimewatchState.buildTimerTuple → [code+2, FILETIME long] when active;
// serviceHelpers.buildPythonSet → objectex1 __builtin__.set whose members ride
// header[1][0].items) — Farmer's live state was clean, so the ACTIVE/POPULATED row
// shape is taken from the real server code path, not guessed.
//
// The bigint fixtures matter: an active-timer FILETIME and a > 2^53 flagged charID
// are asserted as EXACT decimal strings — a decoder that routed them through Number
// would be caught here (R7d).

import test from "node:test";
import assert from "node:assert/strict";

import type { JsonValue } from "./wire.ts";
import {
  decodeClientStates,
  decodeSecurityStatus,
  decodeSecurityStatusTransactions,
  decodeBoundCrimewatch,
} from "./boundCrimewatch.ts";

// --- real captured bytes ----------------------------------------------------

function pythonSet(members: readonly JsonValue[]): JsonValue {
  return {
    type: "objectex1",
    header: [
      { type: "token", value: "__builtin__.set" },
      [{ type: "list", items: [...members] }],
    ],
    list: [],
    dict: [],
  };
}

// Farmer's clean GetClientStates, VERBATIM from the live capture.
const EMPTY_CLIENT_STATES: JsonValue = [
  [
    [100, null],
    [200, null],
    [400, null],
    [300, null],
    [500, null],
  ],
  { type: "dict", entries: [] },
  [pythonSet([]), pythonSet([])],
  2,
];

// --- GetClientStates --------------------------------------------------------

test("decodeClientStates reads Farmer's clean live state (idle timers, no flags, safety full)", () => {
  const states = decodeClientStates(EMPTY_CLIENT_STATES);
  assert.deepEqual(
    states.timers,
    [
      { state: 100, expiry: null },
      { state: 200, expiry: null },
      { state: 400, expiry: null },
      { state: 300, expiry: null },
      { state: 500, expiry: null },
    ],
  );
  assert.deepEqual(states.criminals.members, []);
  assert.deepEqual(states.suspects.members, []);
  assert.equal(states.safetyLevel, 2);
});

test("decodeClientStates decodes an ACTIVE timer's FILETIME as an EXACT string (R7d)", () => {
  // Server buildTimerTuple: an active timer is [code+2, buildFiletimeFromExpiryMs]
  // — a {type:long} FILETIME that exceeds 2^53 and must survive as an exact string.
  const bigFiletime = "133700000000000007"; // > 2^53 and NOT float-representable
  const states = decodeClientStates([
    [
      [102, { type: "long", value: bigFiletime }],
      [200, null],
    ],
    { type: "dict", entries: [] },
    [pythonSet([]), pythonSet([])],
    1,
  ]);
  assert.deepEqual(states.timers, [
    { state: 102, expiry: bigFiletime },
    { state: 200, expiry: null },
  ]);
  assert.equal(states.safetyLevel, 1);
});

test("decodeClientStates keeps flagged-set charIDs as data, big ids as exact strings (R7d)", () => {
  const bigCharID = "98000000000000001"; // > Number.MAX_SAFE_INTEGER
  const states = decodeClientStates([
    [],
    { type: "dict", entries: [] },
    [
      pythonSet([140000009, { type: "long", value: bigCharID }]),
      pythonSet([140000002]),
    ],
    2,
  ]);
  assert.deepEqual(states.criminals.members, [140000009, bigCharID]);
  assert.deepEqual(states.suspects.members, [140000002]);
});

test("decodeClientStates tolerates a non-array result (a real absence, not a throw)", () => {
  const states = decodeClientStates(undefined);
  assert.deepEqual(states.timers, []);
  assert.deepEqual(states.criminals.members, []);
  assert.deepEqual(states.suspects.members, []);
  assert.equal(states.safetyLevel, 0);
});

// --- GetMySecurityStatus / GetCharacterSecurityStatus -----------------------

test("decodeSecurityStatus reads Farmer's live sec-status float verbatim", () => {
  assert.equal(decodeSecurityStatus(0.1404), 0.1404);
});

test("decodeSecurityStatus reads a clean 0 and a negative sec status", () => {
  assert.equal(decodeSecurityStatus(0), 0);
  assert.equal(decodeSecurityStatus(-4.7), -4.7);
});

test("decodeSecurityStatus returns null for a genuinely absent read", () => {
  assert.equal(decodeSecurityStatus(undefined), null);
  assert.equal(decodeSecurityStatus(null), null);
});

// --- GetSecurityStatusTransactions ------------------------------------------

test("decodeSecurityStatusTransactions reads the EMPTY live history", () => {
  // VERBATIM live capture: the handler returns buildList([]) unconditionally.
  assert.deepEqual(decodeSecurityStatusTransactions({ type: "list", items: [] }), []);
});

test("decodeSecurityStatusTransactions passes list items through when present", () => {
  const rows: readonly JsonValue[] = [{ type: "object", name: "util.Row", args: { type: "dict", entries: [] } }];
  assert.deepEqual(decodeSecurityStatusTransactions({ type: "list", items: [...rows] }), rows);
});

test("decodeSecurityStatusTransactions returns [] for a non-list result", () => {
  assert.deepEqual(decodeSecurityStatusTransactions(undefined), []);
  assert.deepEqual(decodeSecurityStatusTransactions(42), []);
});

// --- envelope ---------------------------------------------------------------

test("decodeBoundCrimewatch folds the live 4-read envelope into typed data", () => {
  const raw: JsonValue = {
    ok: true,
    characterID: 140000005,
    reads: {
      GetClientStates: { result: EMPTY_CLIENT_STATES },
      GetMySecurityStatus: { result: 0.1404 },
      GetCharacterSecurityStatus: { result: 0.1404 },
      GetSecurityStatusTransactions: { result: { type: "list", items: [] } },
    },
  };
  const decoded = decodeBoundCrimewatch(raw);
  assert.equal(decoded.clientStates.error, null);
  assert.equal(decoded.clientStates.value.safetyLevel, 2);
  assert.equal(decoded.mySecurityStatus.error, null);
  assert.equal(decoded.mySecurityStatus.value, 0.1404);
  assert.equal(decoded.characterSecurityStatus.value, 0.1404);
  assert.deepEqual(decoded.securityStatusTransactions.value, []);
});

test("decodeBoundCrimewatch carries a per-read error through and still yields a typed empty value", () => {
  const raw: JsonValue = {
    ok: true,
    characterID: 140000005,
    reads: {
      GetClientStates: { error: "READ_FAILED", message: "boom" },
      GetMySecurityStatus: { result: 0 },
      GetCharacterSecurityStatus: { error: "CALL_FAILED" },
      GetSecurityStatusTransactions: { result: { type: "list", items: [] } },
    },
  };
  const decoded = decodeBoundCrimewatch(raw);
  assert.equal(decoded.clientStates.error, "READ_FAILED");
  assert.deepEqual(decoded.clientStates.value.timers, []);
  assert.equal(decoded.clientStates.value.safetyLevel, 0);
  assert.equal(decoded.mySecurityStatus.error, null);
  assert.equal(decoded.mySecurityStatus.value, 0);
  assert.equal(decoded.characterSecurityStatus.error, "CALL_FAILED");
  assert.equal(decoded.characterSecurityStatus.value, null);
});

test("decodeBoundCrimewatch tolerates a missing envelope", () => {
  const decoded = decodeBoundCrimewatch(null);
  assert.deepEqual(decoded.clientStates.value.timers, []);
  assert.equal(decoded.mySecurityStatus.value, null);
  assert.deepEqual(decoded.securityStatusTransactions.value, []);
});
