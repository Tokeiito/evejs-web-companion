"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const manifest = require("../contracts/evejs-web-bridge-contract.json");
const policy = require("../src/bridgeCallPolicy");

function digest(values) {
  return crypto.createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

test("the shared bridge manifest pins the web write boundary", () => {
  const actual = [...policy.BRIDGE_WRITE_PAIR_KEYS].sort();
  assert.deepEqual(actual, manifest.bffWritePolicy.pairs);
  assert.equal(manifest.bffWritePolicy.count, actual.length);
  assert.equal(manifest.bffWritePolicy.sha256, digest(actual));
  // The generic call makes the page's own writes, for a held pilot and when the page says it means them, and
  // no other (bridgeCallPolicy.js, PAGE_WRITE_PAIR_KEYS). The manifest names which: each a write of the policy's.
  assert.deepEqual(manifest.boundary.genericBridgeWrites, [...policy.PAGE_WRITE_PAIR_KEYS].sort());
  assert.deepEqual(manifest.boundary.genericBridgeWrites.filter((pair) => !actual.includes(pair)), []);
  assert.equal(manifest.boundary.genericBridgeAllowsWrites, policy.PAGE_WRITE_PAIR_KEYS.length > 0);
  assert.deepEqual(manifest.boundary.browserSessionFields, policy.SAFE_BROWSER_SESSION_FIELDS);
});

test("the pinned EveJS allowlist is independently counted and hashed", () => {
  assert.equal(manifest.gatewayAllowlist.count, manifest.gatewayAllowlist.pairs.length);
  assert.equal(manifest.gatewayAllowlist.sha256, digest(manifest.gatewayAllowlist.pairs));
});
