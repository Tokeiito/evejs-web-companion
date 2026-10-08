"use strict";

// scripts/bff-parity.js compares what the BFF answers on each transport. The
// script needs two running BFFs and a live server; these pin how it judges a
// pair, so its verdicts mean the same thing each time it is run.

const test = require("node:test");
const assert = require("node:assert/strict");
const { DOCKED_ROUTES, judge, withEnvelopesOpened, withoutVolatile } = require("../scripts/bff-parity");

const ok = (payload) => ({ status: 200, payload });
const rowset = { type: "object", name: "eve.common.script.sys.rowset.Rowset", args: { type: "dict", entries: [["lines", { type: "list", items: [] }]] } };
/** The gateway's cached-answer envelope around a value, as the BFF receives it. */
const envelope = (value) => ({
  type: "object",
  name: { type: "rawstr", value: "carbon.common.script.net.objectCaching.CachedMethodCallResult" },
  args: [{ type: "dict", entries: [] }, { type: "substream", value }, [134359051855730000, 1]],
});
/** The envelope when it only points into the server's object cache. */
const reference = () => ({
  type: "object",
  name: { type: "rawstr", value: "carbon.common.script.net.objectCaching.CachedMethodCallResult" },
  args: [{ type: "dict", entries: [] }, { type: "object", name: "carbon.common.script.net.cachedObject.CachedObject", args: [] }, [1, 1]],
});

test("the same answer on both transports is identical", () => {
  assert.equal(judge(ok({ ok: true, rows: [1, 2] }), ok({ ok: true, rows: [1, 2] })).verdict, "identical");
});

test("a cached envelope anywhere in an answer is opened before comparing, as the browser opens it", () => {
  const viaGateway = ok({ ok: true, ownOrders: { result: envelope(rowset) }, list: [envelope(rowset)] });
  const viaGamePort = ok({ ok: true, ownOrders: { result: rowset }, list: [rowset] });
  assert.equal(judge(viaGateway, viaGamePort).verdict, "identical");
  // An envelope inside an envelope's answer is opened too.
  assert.deepEqual(withEnvelopesOpened({ a: envelope({ b: envelope(7) }) }), { a: { b: 7 } });
});

test("where the gateway could only point at the object cache, the game port having the object is a gain, not a divergence", () => {
  const references = [];
  assert.deepEqual(withEnvelopesOpened({ station: reference(), n: 1 }, "$", references), { station: null, n: 1 });
  assert.deepEqual(references, ["$.station"]);
  const outcome = judge(ok({ station: reference() }), ok({ station: rowset }));
  assert.equal(outcome.verdict, "tolerated");
  assert.equal(outcome.detail, "gained ×1");
  // A null that was never a reference is still a difference.
  assert.equal(judge(ok({ station: null }), ok({ station: rowset })).verdict, "divergent");
});

test("spellings the readers take either of are tolerated, and a spelling they do not share is divergent", () => {
  assert.equal(judge(ok({ cash: { type: "real", value: 5.5 } }), ok({ cash: 5.5 })).verdict, "tolerated");
  assert.equal(judge(ok({ when: "134359051855730000" }), ok({ when: { type: "long", value: "134359051855730000" } })).verdict, "tolerated");
  const tuple = judge(ok({ result: { type: "tuple", items: [1] } }), ok({ result: [1] }));
  assert.equal(tuple.verdict, "divergent");
  assert.equal(tuple.detail, "tuple-form ×1");
});

test("data that moved between the two reads is 'moved'", () => {
  assert.equal(judge(ok({ serverNowMs: 1 }), ok({ serverNowMs: 2 })).verdict, "moved");
});

test("fields that differ on every request by design are left out of the comparison", () => {
  assert.deepEqual(withoutVolatile({ ok: true, droneRecoveryCheckID: "a", space: { sampledAtMs: 5, entities: [{ sampledAtMs: 1, id: 2 }] } }),
    { ok: true, space: { entities: [{ id: 2 }] } });
  assert.equal(judge(ok({ droneRecoveryCheckID: "a", n: 1 }), ok({ droneRecoveryCheckID: "b", n: 1 })).verdict, "identical");
});

test("a route that answers on one transport and fails on the other says so", () => {
  const outcome = judge(ok({ ok: true }), { status: 501, payload: { ok: false, error: "PILOT_TRANSPORT_UNAVAILABLE" } });
  assert.equal(outcome.verdict, "status differs");
  assert.match(outcome.detail, /^200 against 501: .*PILOT_TRANSPORT_UNAVAILABLE/);
});

test("the routes compared are reads the web client's docked panels make", () => {
  assert.ok(DOCKED_ROUTES.length >= 20);
  for (const route of DOCKED_ROUTES) assert.match(route, /^\/api\/bridge\//);
  assert.equal(new Set(DOCKED_ROUTES).size, DOCKED_ROUTES.length);
});
