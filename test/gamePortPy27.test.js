"use strict";

// src/gamePort/py27.js against the retail client's own interpreter.
//
// test/fixtures/py27Oracle.json holds what the client's python27.dll answered
// (scripts/build-py27-fixture.js). Nothing in it was computed by this
// repository, so agreeing with it means agreeing with the real client.

const test = require("node:test");
const assert = require("node:assert/strict");
const { dictOrder, hashKey } = require("../src/gamePort/py27");
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

test("a key with no Python 2.7 hash here is refused, not guessed", () => {
  assert.throws(() => hashKey(1.5), /No Python 2\.7 hash/);
  assert.throws(() => hashKey(null), /No Python 2\.7 hash/);
});
