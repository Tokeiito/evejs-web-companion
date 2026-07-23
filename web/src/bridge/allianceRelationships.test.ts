// R83 allianceRegistry GetRelationships decoder against the REAL captured shape.
//
// The EMPTY dict is real-captured live on 2026-07-22: GetRelationships() returned
// {type:"dict", entries:[]} for BOTH Farmer (alliance-less) and Test Two (Elysian
// member) — Elysian seeds no standings — and the injected-allianceID probe
// (GetRelationships([99000000]) as Farmer) also returned empty, confirming the handler
// ignores args and is session-scoped. The POPULATED shape mirrors the exact server
// builder for Handle_GetRelationships (buildDict of [Number(ownerID), relationship]).

import test from "node:test";
import assert from "node:assert/strict";

import { decodeAllianceRelationships } from "./allianceRelationships.ts";
import type { JsonValue } from "./wire.ts";

// Real-captured empty answer (both accounts, and the injected-id probe).
const REAL_EMPTY: JsonValue = { type: "dict", entries: [] };

// Populated shape from the server builder: buildDict([Number(ownerID), relationship]).
const POPULATED: JsonValue = {
  type: "dict",
  entries: [
    [98000000, 5],
    [99000001, -10],
  ],
};

test("decodeAllianceRelationships returns [] for the real empty (session-scoped) answer", () => {
  assert.deepEqual(decodeAllianceRelationships(REAL_EMPTY), []);
  assert.deepEqual(decodeAllianceRelationships(null), []);
  // A non-dict (e.g. a list) is not a standings dict.
  assert.deepEqual(decodeAllianceRelationships({ type: "list", items: [] }), []);
});

test("decodeAllianceRelationships reads {ownerID -> relationship} pairs in wire order", () => {
  const rels = decodeAllianceRelationships(POPULATED);
  assert.equal(rels.length, 2);
  assert.equal(rels[0]!.ownerID, 98000000);
  assert.equal(rels[0]!.relationship, 5);
  assert.equal(rels[1]!.ownerID, 99000001);
  assert.equal(rels[1]!.relationship, -10);
});
