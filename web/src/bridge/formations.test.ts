// R71 — decoding beyonce.GetFormations, against REAL CAPTURED BYTES.
//
// ⚠ LIVE_REFERENCE is verbatim from a live read (rrfarmer → Farmer 140000005) on
// 2026-07-22: the top-level call returns a proxyCache CachedMethodCallResult whose
// args[1] is a CachedObject REFERENCE, NOT the inline formation shapes. The INLINE
// fixture is synthesized from the server's formation constant + the substream wrapper
// (proxyCache is always on live, so the inline form cannot be captured) to prove the
// decoder still yields shapes if the handler ever drops proxyCache.

import test from "node:test";
import assert from "node:assert/strict";

import type { JsonValue } from "./wire.ts";
import { decodeFormations } from "./formations.ts";

/** Verbatim live bytes: the proxyCache object reference. */
const LIVE_REFERENCE: JsonValue = {
  type: "object",
  name: { type: "rawstr", value: "carbon.common.script.net.objectCaching.CachedMethodCallResult" },
  args: [
    { type: "dict", entries: [[{ type: "rawstr", value: "versionCheck" }, { type: "rawstr", value: "run" }]] },
    {
      type: "object",
      name: { type: "rawstr", value: "carbon.common.script.net.cachedObject.CachedObject" },
      args: [
        [
          { type: "rawstr", value: "Method Call" },
          { type: "rawstr", value: "server" },
          [{ type: "rawstr", value: "beyonce" }, { type: "rawstr", value: "GetFormations" }],
        ],
        65450,
        [{ type: "long", value: "134292143514840000" }, 17867],
      ],
    },
    null,
  ],
};

/** Synthesized inline form: the CachedMethodCallResult substream carrying the shapes. */
const INLINE: JsonValue = {
  type: "object",
  name: { type: "rawstr", value: "carbon.common.script.net.objectCaching.CachedMethodCallResult" },
  args: [
    { type: "dict", entries: [] },
    {
      type: "substream",
      value: [
        ["Diamond", [[100, 0, 0], [0, 100, 0], [-100, 0, 0], [0, -100, 0]]],
        ["Arrow", [[100, 0, -50], [50, 0, 0], [-100, 0, -50], [-50, 0, 0]]],
      ],
    },
    { type: "list", items: [{ type: "long", value: "1" }, 1] },
  ],
};

test("decodeFormations surfaces the live proxyCache reference (formations empty)", () => {
  const result = decodeFormations(LIVE_REFERENCE);
  assert.deepEqual(result.formations, []);
  assert.notEqual(result.cacheReference, null);
  assert.equal(result.cacheReference?.nodeId, 65450);
  assert.equal(result.cacheReference?.version, 134292143514840000n);
  // the compound objectId is carried opaque so a future object-cache fetch can use it.
  assert.ok(Array.isArray(result.cacheReference?.objectId));
});

test("decodeFormations decodes the inline substream shapes when present", () => {
  const result = decodeFormations(INLINE);
  assert.equal(result.cacheReference, null);
  assert.equal(result.formations.length, 2);
  assert.equal(result.formations[0]!.name, "Diamond");
  assert.equal(result.formations[0]!.points.length, 4);
  assert.deepEqual(result.formations[0]!.points[1], { x: 0, y: 100, z: 0 });
  assert.equal(result.formations[1]!.name, "Arrow");
  assert.deepEqual(result.formations[1]!.points[0], { x: 100, y: 0, z: -50 });
});

test("decodeFormations tolerates a bare inline array and empty input", () => {
  const bare = decodeFormations([["Wedge", [[1, 2, 3]]]] as unknown as JsonValue);
  assert.equal(bare.formations.length, 1);
  assert.deepEqual(bare.formations[0], { name: "Wedge", points: [{ x: 1, y: 2, z: 3 }] });
  assert.deepEqual(decodeFormations(null), { formations: [], cacheReference: null });
});
