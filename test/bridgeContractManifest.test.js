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
  assert.equal(manifest.boundary.genericBridgeAllowsWrites, false);
  assert.deepEqual(manifest.boundary.browserSessionFields, policy.SAFE_BROWSER_SESSION_FIELDS);
});

test("every web-classified write exists in the pinned EveJS allowlist", () => {
  const allowed = new Set(manifest.gatewayAllowlist.pairs);
  const missing = manifest.bffWritePolicy.pairs.filter((pair) => !allowed.has(pair));
  assert.deepEqual(missing, []);
  assert.equal(manifest.gatewayAllowlist.count, manifest.gatewayAllowlist.pairs.length);
  assert.equal(manifest.gatewayAllowlist.sha256, digest(manifest.gatewayAllowlist.pairs));
});
