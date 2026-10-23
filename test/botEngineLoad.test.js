"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createBotHost } = require("../src/botHost");

test("the hosted bot engine loads under Node's default TypeScript stripping", async () => {
  const errors = [];
  // Use the real loader: the lifecycle tests inject a fake stack and cannot
  // detect browser imports that Node cannot run (e.g. parameter properties).
  const host = createBotHost({ errorLogger: error => errors.push(error) });
  // An invalid document stops after loading and decoding, before any pilot,
  // network request, session or running bot can be created.
  const result = await host.start({ doc: null });
  assert.deepEqual(errors, []);
  assert.equal(result.code, "BOTSCRIPT_INVALID");
});
