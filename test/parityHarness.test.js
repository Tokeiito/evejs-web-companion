"use strict";

// The parity harness's own parts: how it compares two answers, and how it
// decides which reads it can make.
//
// The harness itself needs a live server and is run by hand; what it found is
// docs/game-port-parity-report.md. These pin the judgement it applies, so that
// the report means the same thing each time it is regenerated.

const test = require("node:test");
const assert = require("node:assert/strict");
const { compare, findUnmarshalable, kindsOf, openEnvelope, verdictOf } = require("../scripts/parity-compare");
const { compareAnswers, planReads, readCallSites, resolveArguments, splitArguments } = require("../scripts/parity-harness");
const { BRIDGE_WRITE_PAIR_KEYS } = require("../src/bridgeCallPolicy");
const contract = require("../contracts/evejs-web-bridge-contract.json");

const kinds = (gateway, wire) => kindsOf(compare(gateway, wire)).map(([kind]) => kind);
const verdict = (gateway, wire) => verdictOf(compare(gateway, wire));
const keyVal = (entries) => ({ type: "object", name: "util.KeyVal", args: { type: "dict", entries } });

// ── comparing ────────────────────────────────────────────────────────────────

test("the same answer is identical", () => {
  const answer = { type: "list", items: [keyVal([["key", 1000], ["keyName", "cash"]])] };
  assert.equal(verdict(answer, JSON.parse(JSON.stringify(answer))), "identical");
  assert.equal(verdict(null, null), "identical");
});

test("a value or a row count that changed between the two reads is 'moved', not a difference of shape", () => {
  assert.equal(verdict(keyVal([["balance", 10]]), keyVal([["balance", 12]])), "moved");
  assert.equal(verdict({ type: "list", items: [1, 2] }, { type: "list", items: [1, 2, 3] }), "moved");
  assert.equal(verdict([true, "a"], [false, "b"]), "moved");
  // A dict keyed by ids gaining or losing ids is data too.
  assert.equal(verdict({ type: "dict", entries: [[34, 1], [35, 2]] }, { type: "dict", entries: [[34, 1]] }), "moved");
});

test("two spellings the shared readers both accept are 'tolerated'", () => {
  // unwrapLong: a bare integer or a long wrapper, with digits or a number inside.
  assert.deepEqual(kinds({ type: "long", value: "0" }, 0), ["long-form"]);
  assert.deepEqual(kinds({ type: "long", value: 5 }, { type: "long", value: "5" }), []);
  assert.deepEqual(kinds({ type: "long", value: "134358883852740000" }, { type: "long", value: "134358883852740000" }), []);
  // unwrapReal: a bare number or a real wrapper.
  assert.deepEqual(kinds({ type: "real", value: 1939882211.6 }, 1939882211.6), ["real-form"]);
  assert.equal(verdict(keyVal([["bounty", { type: "real", value: 0 }], ["end", { type: "long", value: "0" }]]), keyVal([["bounty", 0], ["end", 0]])), "tolerated");
  // unwrapLong: the bare digits the gateway prints for a handler's bare BigInt.
  assert.deepEqual(kinds("134307936000000000", { type: "long", value: "134307936000000000" }), ["bare-bigint-string"]);
  assert.equal(verdict("134307936000000000", { type: "long", value: "134307936000000000" }), "tolerated");
  // ...but digits against text is still two different things.
  assert.equal(verdict("134307936000000000", "Jita"), "moved");
  assert.equal(verdict("134307936000000000", { type: "list", items: [] }), "divergent");
});

test("a packed row compares by column, whichever of its two forms the gateway used", () => {
  const columns = [["itemID", 20], ["typeID", 3]];
  const wire = { type: "packedrow", header: null, columns, fields: { itemID: 7, typeID: 34 }, values: [7, 34] };
  assert.equal(verdict({ type: "packedrow", header: null, columns, fields: { itemID: 7, typeID: 34 } }, wire), "identical");
  assert.equal(verdict({ type: "packedrow", header: null, columns, values: [7, 34] }, wire), "identical");
  assert.deepEqual(kinds({ type: "packedrow", header: null, columns, values: [7, 35] }, wire), ["value"]);
  assert.deepEqual(kinds({ type: "packedrow", header: null, columns, fields: { itemID: 7 } }, wire), ["keys"]);
});

test("what a decoder could read differently is 'divergent', and says how", () => {
  // The gateway prints a handler's {type:"tuple"}; the game port can only send a tuple.
  assert.deepEqual(kinds({ type: "tuple", items: [1, 2] }, [1, 2]), ["tuple-form"]);
  // A byte string's wrapper is lost on the wire. No shared reader takes both; each decoder of bytes must.
  assert.deepEqual(kinds({ type: "bytes", value: { type: "Buffer", data: [7, 228] } }, { type: "Buffer", data: [7, 228] }), ["bytes-form"]);
  assert.deepEqual(kinds({ type: "bytes", value: { type: "Buffer", data: [7, 228] } }, { type: "Buffer", data: [7, 229] }), ["bytes-form", "value"]);
  assert.deepEqual(kinds({ type: "bytes", value: { type: "Buffer", data: [7, 228] } }, { type: "Buffer", data: [7] }), ["bytes-form", "count"]);
  assert.deepEqual(kinds({ type: "bytes", value: "not a buffer" }, { type: "Buffer", data: [7] }), ["shape"]);
  assert.deepEqual(kinds({ type: "rawstr", value: "util.Row" }, "util.Row"), ["string-form"]);
  assert.deepEqual(kinds(keyVal([["name", "a"]]), keyVal([["title", "a"]])), ["keys"]);
  assert.deepEqual(kinds({ type: "list", items: [] }, { type: "dict", entries: [] }), ["shape"]);
  assert.deepEqual(kinds([0, "CrpAccessDenied", {}], null), ["null-vs-value"]);
  for (const [gateway, wire] of [
    [{ type: "tuple", items: [1] }, [1]],
    [{ type: "bytes", value: { type: "Buffer", data: [7] } }, { type: "Buffer", data: [7] }],
    [{ type: "list", items: [] }, null],
  ]) {
    assert.equal(verdict(gateway, wire), "divergent");
  }
});

test("the verdict is the worst kind found, and the kinds are listed worst first", () => {
  const gateway = keyVal([["when", "134307936000000000"], ["roles", { type: "long", value: "0" }], ["count", 1]]);
  const wire = keyVal([["when", { type: "long", value: "134307936000000000" }], ["roles", 0], ["count", 2]]);
  assert.equal(verdict(gateway, wire), "tolerated");
  assert.deepEqual(kinds(gateway, wire), ["bare-bigint-string", "long-form", "value"]);
  const withTuple = (pair) => keyVal([...pair.args.entries, ["pair", pair === gateway ? { type: "tuple", items: [1] } : [1]]]);
  assert.equal(verdict(withTuple(gateway), withTuple(wire)), "divergent");
  assert.deepEqual(kinds(withTuple(gateway), withTuple(wire)), ["tuple-form", "bare-bigint-string", "long-form", "value"]);
});

test("the gateway's cached envelope is opened as the browser opens it", () => {
  const envelope = (carrier) => ({
    type: "object",
    name: { type: "rawstr", value: "carbon.common.script.net.objectCaching.CachedMethodCallResult" },
    args: [{ type: "dict", entries: [] }, carrier, null],
  });
  const rows = { type: "list", items: [1] };
  assert.deepEqual(openEnvelope(envelope({ type: "substream", value: rows })), { envelope: "inline", value: rows });
  // A reference into the object cache: the browser cannot follow it.
  const reference = { type: "object", name: "carbon.common.script.net.cachedObject.CachedObject", args: [["Method Call"], 65450, [1, 2]] };
  assert.deepEqual(openEnvelope(envelope(reference)), { envelope: "reference", value: null });
  assert.deepEqual(openEnvelope(rows), { envelope: null, value: rows });
  assert.deepEqual(openEnvelope(null), { envelope: null, value: null });
});

test("a bare object in a gateway answer is something the server cannot marshal", () => {
  // corpRegistry.CanLeaveCurrentCorporation, as the gateway printed it.
  assert.equal(findUnmarshalable([0, "CrpAccessDenied", {}]), "$[2]");
  assert.equal(findUnmarshalable(keyVal([["extra", { nested: 1 }]])), "$.args.entries[0][1]");
  // A packed row's named fields are a bare object on purpose; the marshaller packs them.
  assert.equal(findUnmarshalable({ type: "packedrow", header: null, columns: [], fields: { itemID: 7 } }), null);
  assert.equal(findUnmarshalable({ type: "Buffer", data: [1, 2] }), null);
  assert.equal(findUnmarshalable(keyVal([["a", [1, "two", null]]])), null);
});

test("answers are judged pair by pair: gained, refused alike, unmarshalable", () => {
  const read = (key) => ({ key, pair: key, args: [] });
  const answered = (value) => ({ ok: true, value });
  const refused = (code, message, reason = null) => ({ ok: false, code, message, reason });
  const reference = {
    type: "object", name: "carbon.common.script.net.objectCaching.CachedMethodCallResult",
    args: [{ type: "dict", entries: [] }, { type: "object", name: "carbon.common.script.net.cachedObject.CachedObject", args: [] }, null],
  };
  const reads = ["same", "cached", "broken", "alike", "unlike", "one", "late"].map(read);
  const fromGateway = new Map([
    ["same", answered(1)], ["cached", answered(reference)], ["broken", answered([0, "X", {}])],
    ["alike", refused("CALL_REFUSED", "CrpAccessDenied")], ["unlike", refused("CALL_FAILED", "boom")],
    ["one", answered(1)], ["late", answered(1)],
  ]);
  const fromGamePort = new Map([
    ["same", answered(1)], ["cached", answered({ type: "list", items: [] })], ["broken", answered(null)],
    ["alike", refused("GAME_CALL_REFUSED", "x was refused by the server: CrpAccessDenied", "CrpAccessDenied")],
    ["unlike", refused("GAME_CALL_REFUSED", "x was refused", "Other")],
    ["one", refused("GAME_CALL_REFUSED", "x was refused", "Nope")],
  ]);
  const verdicts = Object.fromEntries(compareAnswers(reads, fromGateway, fromGamePort).map((result) => [result.key, result.verdict]));
  assert.deepEqual(verdicts, {
    same: "identical",
    cached: "gained",
    broken: "server cannot marshal",
    alike: "refused alike",
    unlike: "refused differently",
    one: "refused by one",
    late: "not reached",
  });
});

// ── planning ─────────────────────────────────────────────────────────────────

const FACTS = { characterID: 140000001, corporationID: 1000044, stationID: 60003760, solarSystemID: 30000142, shipID: 9988400103291 };

test("an argument list is resolved only when every part is a constant or a fact about the session", () => {
  assert.deepEqual(splitArguments("1000, null, [a, b], f(x, y)"), ["1000", "null", "[a, b]", "f(x, y)"]);
  assert.deepEqual(resolveArguments("[]", FACTS), []);
  assert.deepEqual(resolveArguments("[1000, null, null, 0]", FACTS), [1000, null, null, 0]);
  assert.deepEqual(resolveArguments("[false, true]", FACTS), [false, true]);
  assert.deepEqual(resolveArguments("[charID]", FACTS), [140000001]);
  assert.deepEqual(resolveArguments("[facilityID, held.characterID]", FACTS), null, "facilityID is a player's choice");
  assert.deepEqual(resolveArguments("[agentID]", FACTS), null);
  assert.deepEqual(resolveArguments("offersArgs", FACTS), null, "a variable, not a list");
  assert.deepEqual(resolveArguments("[stationID]", { ...FACTS, stationID: null }), null, "a fact the session does not have");
});

test("the call sites are the BFF's own top-level reads, never a write", () => {
  const source = `
    await heldTopLevelCall(held, req.webSessionID, "account", "GetCashBalance", [0], null);
    await heldTopLevelCall(held, req.webSessionID, "account", "GetCashBalance", [
      0], null);
    await heldTopLevelCall(held, req.webSessionID, "agentMgr", "GetAgentByID", [agentID], null);
    await heldTopLevelCall(held, req.webSessionID, "dogmaIM", "Activate", [itemID, effect, null, repeat], null);
    await heldTopLevelCall(held, req.webSessionID, "noSuchService", "Read", [], null);
  `;
  const sites = readCallSites(source);
  assert.deepEqual([...sites.keys()].sort(), ["account.GetCashBalance", "agentMgr.GetAgentByID"]);
  assert.deepEqual([...sites.get("account.GetCashBalance")], ["[0]", "[ 0]"]);
});

test("the plan accounts for every read the gateway allows, once", () => {
  const { reads, skipped } = planReads(FACTS);
  const writes = new Set(BRIDGE_WRITE_PAIR_KEYS);
  const allowedReads = contract.gatewayAllowlist.pairs.filter((pair) => !writes.has(pair));
  const planned = new Set([...reads.map((read) => read.pair), ...skipped.map((entry) => entry.pair)]);
  assert.deepEqual([...planned].sort(), [...allowedReads].sort());
  assert.equal(reads.filter((read) => writes.has(read.pair)).length, 0, "no write is ever planned");
  assert.ok(reads.length > 150, `${reads.length} reads can be made`);
  assert.ok(skipped.every((entry) => typeof entry.reason === "string" && entry.reason.length > 0));
  // The inventory is read on two objects, so its pairs appear once per object.
  assert.deepEqual(reads.filter((read) => read.pair === "invbroker.List").map((read) => read.key), ["invbroker.List (station hangar)", "invbroker.List (ship cargo)"]);
  assert.equal(new Set(reads.map((read) => read.key)).size, reads.length, "every read has its own key");
});
