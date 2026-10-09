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
  assert.equal(judge(ok({ balance: 1 }), ok({ balance: 2 })).verdict, "moved");
});

test("the server's clock at a read, and a time the server measured its own answer to take, are not data: they differ every time, and are left out", () => {
  // Two reads a second apart read the clock a second apart.
  assert.equal(judge(ok({ skills: { serverNowMs: 1791572707422, total: 3 } }), ok({ skills: { serverNowMs: 1791572708614, total: 3 } })).verdict, "identical");
  assert.equal(judge(ok({ serverNowMs: 1 }), ok({ serverNowMs: 2 })).verdict, "identical");
  // A search answers how long it took beside what it found. The answer is the server's own KeyVal, whose fields
  // are a dict's entries: the shape below is what both BFFs answered for a search that found nothing. (This test
  // first had the fields as an object's own, which no answer has, and passed while the tool did nothing for the
  // real one: a pass in which the server took a millisecond one time and none the other read "moved".)
  const searched = (searchTime, found) => ok({ browse: { result: { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["contracts", { type: "list", items: found }], ["numFound", found.length], ["searchTime", searchTime], ["maxResults", 1000]] } } } });
  assert.equal(judge(searched(0, []), searched(10000, [])).verdict, "identical");
  assert.equal(judge(searched(0, [1]), searched(10000, [1])).verdict, "identical");
  // What it found is data all the same.
  assert.equal(judge(searched(0, [1]), searched(10000, [2])).verdict, "moved");
  assert.deepEqual(withoutVolatile({ serverNowMs: 5, browse: { searchTime: 7, found: 1 } }), { browse: { found: 1 } });
  assert.deepEqual(withoutVolatile({ type: "dict", entries: [["searchTime", 7], ["found", { type: "dict", entries: [["serverNowMs", 1], ["kept", 2]] }]] }),
    { type: "dict", entries: [["found", { type: "dict", entries: [["kept", 2]] }]] });
  // A dict keyed by something that is not a name keeps every entry, and a list of pairs that is no dict keeps its own.
  assert.deepEqual(withoutVolatile({ type: "dict", entries: [[7, "searchTime"], [["searchTime", 1], 2]] }), { type: "dict", entries: [[7, "searchTime"], [["searchTime", 1], 2]] });
  assert.deepEqual(withoutVolatile({ type: "list", items: [["searchTime", 7]] }), { type: "list", items: [["searchTime", 7]] });
  // Something of the BFF's own that has "entries" and is no dict is read as any object is.
  assert.deepEqual(withoutVolatile({ entries: [["searchTime", 7]], sampledAtMs: 5, more: { nowMs: 1, kept: 2 } }), { entries: [["searchTime", 7]], more: { kept: 2 } });
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

test("where the game port answers what the client reckons for itself, the difference is named, not taken for data that moved", () => {
  const capacity = (limit, used) => ({ type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["capacity", limit], ["used", used]] } });
  const inventory = (hangar, cargo) => ok({ ok: true, hangar: { capacity: hangar, error: null }, cargo: { capacity: cargo, error: null } });
  // A station hangar: the server's default limit on the gateway, the client's own figure on the game port.
  const hangar = judge(inventory(capacity(1000000, 250000), capacity(3900, 0.1)), inventory(capacity(9000000000000000, 250000), capacity(3900, 0.1)), "/api/bridge/inventory");
  assert.deepEqual([hangar.verdict, hangar.detail], ["tolerated", "client-reckoned ×1"]);
  // What is used of it is the same thing reckoned two ways, and a difference there is a difference.
  const used = judge(inventory(capacity(1000000, 250000), capacity(3900, 0.1)), inventory(capacity(9000000000000000, 250001), capacity(3900, 0.1)), "/api/bridge/inventory");
  assert.deepEqual([used.verdict, used.detail], ["divergent", "client-reckoned ×1, reckoned-differently ×1"]);
  // So is the cargo's capacity, which godma and the server should agree on, and what is used of that.
  for (const cargo of [capacity(4000, 0.1), capacity(3900, 0.2)]) {
    const differing = judge(inventory(capacity(1000000, 250000), capacity(3900, 0.1)), inventory(capacity(9000000000000000, 250000), cargo), "/api/bridge/inventory");
    assert.deepEqual([differing.verdict, differing.detail], ["divergent", "client-reckoned ×1, reckoned-differently ×1"]);
  }
  // On another route, or with the route not said, a number that differs is data that moved, as before.
  assert.equal(judge(inventory(capacity(1000000, 1), capacity(1, 1)), inventory(capacity(2000000, 1), capacity(1, 1)), "/api/bridge/assets").verdict, "moved");
  assert.equal(judge(inventory(capacity(1000000, 1), capacity(1, 1)), inventory(capacity(2000000, 1), capacity(1, 1))).verdict, "moved");
});

test("where the two transports answer the sheet's clone in two forms, what the page reads of it is what is compared", () => {
  const kv = (entries) => ({ type: "object", name: "util.KeyVal", args: { type: "dict", entries } });
  const dict = (entries) => ({ type: "dict", entries });
  // The gateway: the server's whole clone answer, its implants keyed by item. The game port: the implants the
  // client's skill handler lists, keyed by slot, and nothing else.
  const whole = (implants) => ok({ ok: true, publicInfo: null, cloneInfo: kv([["homeStationID", 60003760], ["clones", dict([])], ["implants", dict(implants)], ["timeLastJump", "0"]]) });
  const listed = (implants) => ok({ ok: true, publicInfo: null, cloneInfo: kv([["implants", dict(implants)]]) });
  const implant = (typeID, slot, more = []) => kv([["typeID", typeID], ...more, ["slot", slot]]);
  const byItem = [[9988400109053, implant(9941, 2, [["name", ""]])], [9988400109052, implant(9899, 1, [["name", ""]])]];
  const same = judge(whole(byItem), listed([[1, implant(9899, 1)], [2, implant(9941, 2)]]), "/api/bridge/character-sheet");
  assert.deepEqual([same.verdict, same.detail], ["identical", ""]);
  // Another implant, one missing, or one in another slot is a difference, and is not put down to data that moved.
  for (const other of [[[1, implant(9899, 1)], [2, implant(10216, 2)]], [[1, implant(9899, 1)]], [[1, implant(9899, 1)], [3, implant(9941, 3)]], []]) {
    assert.equal(judge(whole(byItem), listed(other), "/api/bridge/character-sheet").verdict, "divergent", JSON.stringify(other));
  }
  // A clean clone on both is the same; no clone read on one of them is not.
  assert.equal(judge(whole([]), listed([]), "/api/bridge/character-sheet").verdict, "identical");
  assert.equal(judge(whole([]), ok({ ok: true, publicInfo: null, cloneInfo: null }), "/api/bridge/character-sheet").verdict, "divergent");
  // Nor is a clone answer with no implants to read the same as none: it is compared as it came.
  assert.equal(judge(ok({ ok: true, publicInfo: null, cloneInfo: kv([["homeStationID", 60003760]]) }), ok({ ok: true, publicInfo: null, cloneInfo: null }), "/api/bridge/character-sheet").verdict, "divergent");
  // The rest of the sheet is compared as it is.
  const named = judge(ok({ ok: true, publicInfo: "a", cloneInfo: null }), ok({ ok: true, publicInfo: "b", cloneInfo: null }), "/api/bridge/character-sheet");
  assert.notEqual(named.verdict, "identical");
  // On another route the two forms are two different answers.
  assert.notEqual(judge(whole(byItem), listed([[1, implant(9899, 1)], [2, implant(9941, 2)]]), "/api/bridge/assets").verdict, "identical");
});

test("a pilot in no fleet is the same answer on both transports, however each comes to say it", () => {
  const names = ["GetInitState", "GetWings", "GetMotd", "GetJoinRequests", "GetFleetComposition"];
  const reads = (cell) => Object.fromEntries(names.map((name) => [name, cell]));
  // The gateway asks and is refused five times; the game port takes the session's word and asks nothing.
  const refused = (message) => ok({ ok: true, characterID: 7, fleetID: null, reads: reads({ error: "CALL_REFUSED", message }), notifications: [] });
  const notAsked = ok({ ok: true, characterID: 7, fleetID: null, membership: "none", reads: reads({ error: "NOT_ASKED", message: null }), notifications: [] });
  for (const message of ["FleetNotInFleet", "FleetNotFound"]) {
    assert.deepEqual([judge(refused(message), notAsked, "/api/bridge/bound-fleet").verdict, judge(refused(message), notAsked, "/api/bridge/bound-fleet").detail], ["identical", ""], message);
  }
  // A read that failed for another reason is not "no fleet", and reads that were not asked with nobody saying why are not either.
  assert.notEqual(judge(refused("Gateway unavailable"), notAsked, "/api/bridge/bound-fleet").verdict, "identical");
  const unsaid = ok({ ok: true, characterID: 7, fleetID: null, reads: reads({ error: "NOT_ASKED", message: null }), notifications: [] });
  assert.notEqual(judge(refused("FleetNotInFleet"), unsaid, "/api/bridge/bound-fleet").verdict, "identical");
  // Nor is an answer with no reads in it, or the fleetless word on a read that failed some other way.
  assert.notEqual(judge(ok({ ok: true, characterID: 7, fleetID: null, reads: {}, notifications: [] }), notAsked, "/api/bridge/bound-fleet").verdict, "identical");
  const otherwise = ok({ ok: true, characterID: 7, fleetID: null, reads: reads({ error: "READ_FAILED", message: "FleetNotInFleet" }), notifications: [] });
  assert.notEqual(judge(otherwise, notAsked, "/api/bridge/bound-fleet").verdict, "identical");
  // One refusal among answers is not "no fleet" either.
  const partly = ok({ ok: true, characterID: 7, fleetID: null, reads: { ...reads({ error: "CALL_REFUSED", message: "FleetNotInFleet" }), GetMotd: { result: "hello" } }, notifications: [] });
  assert.notEqual(judge(partly, notAsked, "/api/bridge/bound-fleet").verdict, "identical");
  // A pilot in a fleet is compared read by read, as before; and so is this answer on any other route.
  const inFleet = (motd) => ok({ ok: true, characterID: 7, fleetID: "654500010000", reads: { ...reads({ result: null }), GetMotd: { result: motd } }, notifications: [] });
  assert.equal(judge(inFleet("hello"), inFleet("hello"), "/api/bridge/bound-fleet").verdict, "identical");
  assert.notEqual(judge(inFleet("hello"), inFleet("goodbye"), "/api/bridge/bound-fleet").verdict, "identical");
  assert.notEqual(judge(inFleet("hello"), notAsked, "/api/bridge/bound-fleet").verdict, "identical");
  assert.notEqual(judge(refused("FleetNotInFleet"), notAsked, "/api/bridge/assets").verdict, "identical");
});

// The gateway hands on the server's own {type:"tuple"} where the server built one, and the game port has every
// tuple off the wire as an array. Where the page's reader takes either, the two answers read the same.

const tuple = (...items) => ({ type: "tuple", items });
const listed = (...items) => ({ type: "list", items });

test("a tuple spelt two ways is tolerated where the page's reader takes either, and nowhere else", () => {
  // The journal: the answer is a tuple of two lists, each row of which is a tuple (agents.ts decodeJournal).
  const journalOnGateway = ok({ result: tuple(listed(tuple(1, 0, "Courier")), listed()) });
  const journalOnGamePort = ok({ result: [listed([1, 0, "Courier"]), listed()] });
  const journal = judge(journalOnGateway, journalOnGamePort, "/api/bridge/journal");
  assert.deepEqual([journal.verdict, journal.detail], ["tolerated", "tuple-read-either-way ×2"]);
  // Industry: each activity of a facility has a tuple of its lists of modifiers (industry.ts decodeFacilities).
  const facilities = (spelt) => ok({ facilities: { result: listed({ type: "object", name: "util.KeyVal", args: { facilityID: 7, activities: { 1: spelt([[0.98, null, null, null, 5]], []), 8: spelt([], []) } } }) } });
  const industry = judge(facilities((...lists) => tuple(...lists)), facilities((...lists) => lists), "/api/bridge/industry");
  assert.deepEqual([industry.verdict, industry.detail], ["tolerated", "tuple-read-either-way ×2"]);

  // The same two answers on a route with no such reader, and on none, are divergent as before.
  assert.equal(judge(journalOnGateway, journalOnGamePort, "/api/bridge/wallet").verdict, "divergent");
  assert.equal(judge(journalOnGateway, journalOnGamePort).verdict, "divergent");
  // A tuple spelt two ways somewhere else in the journal's answer, or in a facility's, is still divergent.
  assert.equal(judge(ok({ result: tuple(listed(), listed()), other: tuple(1) }), ok({ result: [listed(), listed()], other: [1] }), "/api/bridge/journal").verdict, "divergent");
  assert.equal(judge(ok({ result: tuple(listed(tuple(1, tuple(2))), listed()) }), ok({ result: [listed([1, [2]]), listed()] }), "/api/bridge/journal").verdict, "divergent");
  assert.equal(judge(ok({ facilities: { result: listed({ type: "object", name: "util.KeyVal", args: { tax: tuple(1) } }) } }), ok({ facilities: { result: listed({ type: "object", name: "util.KeyVal", args: { tax: [1] } }) } }), "/api/bridge/industry").verdict, "divergent");
  // Something that is no tuple at all where the tuple should be is no spelling of it.
  assert.equal(judge(ok({ result: tuple(listed(), listed()) }), ok({ result: "refused" }), "/api/bridge/journal").verdict, "divergent");
  // And it is the spelling alone that is taken either way: a row that says something else has moved.
  const moved = judge(ok({ result: tuple(listed(tuple(1, 0, "Courier")), listed()) }), ok({ result: [listed([2, 0, "Courier"]), listed()] }), "/api/bridge/journal");
  assert.equal(moved.verdict, "tolerated");
  assert.match(moved.detail, /value ×1/);
});

// The Market read's broker's fee rate: the game port works it out as the client does and the gateway has none.

test("the broker's fee rate the game port works out and the gateway cannot is the client's reckoning, and nothing else of the Market read is excused by it", () => {
  const read = (rate, more = {}) => ok({ ok: true, stationID: 60003760, brokersFeeRate: rate, cashBalance: { result: 5, error: null }, ...more });
  assert.equal(judge(read(null), read(0.0295803), "/api/bridge/market").verdict, "tolerated");
  assert.equal(judge(read(null), read(null), "/api/bridge/market").verdict, "identical");
  // Another route's field of that name is not excused, nor another field of this route's.
  assert.equal(judge(read(null), read(0.0295803), "/api/bridge/wallet").verdict, "divergent");
  assert.equal(judge(read(null, { stationID: null }), read(0.03, { stationID: 60003760 }), "/api/bridge/market").verdict, "divergent");
});
