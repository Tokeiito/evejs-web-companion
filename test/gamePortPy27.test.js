"use strict";

// src/gamePort/py27.js against the retail client's own interpreter.
//
// test/fixtures/py27Oracle.json holds what the client's python27.dll answered
// (scripts/build-py27-fixture.js). Nothing in it was computed by this
// repository, so agreeing with it means agreeing with the real client.

const test = require("node:test");
const assert = require("node:assert/strict");
const { Dict, dictOrder, hashKey, keywordOrder, monikerKeywordOrder } = require("../src/gamePort/py27");
const oracle = require("./fixtures/py27Oracle.json");

/** "s:name" -> "name"; "i:123" -> 123, or a BigInt when a number would lose digits. */
function untag(tagged) {
  if (tagged.startsWith("s:")) return tagged.slice(2);
  const integer = BigInt(tagged.slice(2));
  return integer >= BigInt(Number.MIN_SAFE_INTEGER) && integer <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(integer)
    : integer;
}
const tag = (key) => (typeof key === "string" ? `s:${key}` : `i:${key}`);

test("the oracle is the interpreter the retail client runs", () => {
  assert.match(oracle.interpreter, /^2\.7\.\d+ Stackless .*64 bit/);
  // A 32-bit C long: the reason hashes here are not what Linux Python 2.7 gives.
  assert.equal(oracle.maxint, 2147483647);
  assert.ok(oracle.hashes.length > 1000 && oracle.dicts.length > 40);
});

test("hash() of every recorded key matches the client's", () => {
  for (const [tagged, expected] of oracle.hashes) {
    assert.equal(hashKey(untag(tagged)), expected, tagged);
  }
});

test("a dict written as a literal iterates in the client's order", () => {
  for (const { keys, literal } of oracle.dicts) {
    const order = dictOrder(keys.map(untag), { presized: keys.length }).map(tag);
    assert.deepEqual(order, literal, `${keys.length} keys starting ${keys[0]}`);
  }
});

test("a dict filled one key at a time iterates in the client's order", () => {
  for (const { keys, inserted } of oracle.dicts) {
    assert.deepEqual(dictOrder(keys.map(untag)).map(tag), inserted, `${keys.length} keys starting ${keys[0]}`);
  }
});

test("the two ways of building a dict really do differ, so both are being tested", () => {
  const differing = oracle.dicts.filter(({ literal, inserted }) => literal.join() !== inserted.join());
  assert.ok(differing.length > 5, `only ${differing.length} of ${oracle.dicts.length} cases tell them apart`);
  // The login dict is one of them: getting this wrong reorders the login packet.
  assert.notDeepEqual(oracle.dicts[0].literal, oracle.dicts[0].inserted);
});

test("a call's keywords go out in the client's order, by either of its two call paths", () => {
  assert.ok(oracle.keywords.length > 400);
  for (const { written, viaFunction, viaObject } of oracle.keywords) {
    // A remote service's method is a plain function; a bound object's is an object with __call__.
    assert.deepEqual(keywordOrder(written, { via: "function" }), viaFunction, `function: ${written}`);
    assert.deepEqual(keywordOrder(written, { via: "object" }), viaObject[0], `object: ${written}`);
    // And with one or two more **keywords functions on the way down.
    assert.deepEqual(keywordOrder(written, { via: "object", hops: 1 }), viaObject[1], `object+1: ${written}`);
    assert.deepEqual(keywordOrder(written, { via: "object", hops: 2 }), viaObject[2], `object+2: ${written}`);
  }
});

test("the two call paths, and the number of layers, really do change the order", () => {
  const pathsDiffer = oracle.keywords.filter(({ viaFunction, viaObject }) => viaFunction.join() !== viaObject[0].join());
  const layersDiffer = oracle.keywords.filter(({ viaObject }) => viaObject[0].join() !== viaObject[1].join());
  assert.ok(pathsDiffer.length > 20, `paths differ in ${pathsDiffer.length}`);
  assert.ok(layersDiffer.length > 20, `layers differ in ${layersDiffer.length}`);
  // And most calls with keywords do not go out in the order they were written.
  const reordered = oracle.keywords.filter(({ written, viaFunction }) => [...written, "machoVersion"].join() !== viaFunction.join());
  assert.ok(reordered.length > oracle.keywords.length / 2);
});

test("a copied dict has the table size the client's interpreter gives it", () => {
  // Measured in the client's python27.dll with sys.getsizeof: copying n entries
  // gives 8 slots up to five, then 32, 64, 128.
  const slots = (count) => {
    const dict = new Dict();
    for (let key = 0; key < count; key += 1) dict.set(key);
    return dict.copy().table.length;
  };
  assert.deepEqual([0, 1, 5, 6, 7, 8, 15, 16, 31, 32].map(slots), [8, 8, 8, 32, 32, 64, 64, 128, 128, 256]);
});

test("a key with no Python 2.7 hash here is refused, not guessed", () => {
  assert.throws(() => hashKey(1.5), /No Python 2\.7 hash/);
  assert.throws(() => hashKey(null), /No Python 2\.7 hash/);
});

test("the keywords of a call that rides along with a Moniker's bind go in the order the client's own Python gives them", () => {
  // moniker.py: MonikerCallWrap.__call__ collects them, Bind builds them anew without machoTimeout and
  // noCallThrottling, and nothing is added. Asked of the client's python27.dll for every case.
  assert.ok(oracle.keywords.every(({ viaMoniker }) => Array.isArray(viaMoniker)));
  for (const { written, viaMoniker } of oracle.keywords) {
    assert.deepEqual(monikerKeywordOrder(written), viaMoniker, `moniker: ${written}`);
  }
  // The cases tell this path from a bound object's own, and from the order written.
  const kept = (names) => names.filter((name) => name !== "machoVersion" && name !== "machoTimeout" && name !== "noCallThrottling");
  const unlikeObject = oracle.keywords.filter(({ viaObject, viaMoniker }) => kept(viaObject[0]).join() !== viaMoniker.join());
  const unlikeWritten = oracle.keywords.filter(({ written, viaMoniker }) => kept(written).join() !== viaMoniker.join());
  assert.ok(unlikeObject.length > 5 && unlikeWritten.length > 50, `${unlikeObject.length} and ${unlikeWritten.length}`);
  // The two the client keeps to itself are never sent; one of them alone leaves none.
  assert.deepEqual([monikerKeywordOrder(["machoTimeout"]), monikerKeywordOrder(["passive", "noCallThrottling"]), monikerKeywordOrder([])], [[], ["passive"], []]);
});
