// The bundled examples must be programs the import gate ACCEPTS and the editor
// finds NOTHING to fix in — a preset that loads with a refusal or a red row is
// worse than no preset. Round-trips each through the codec (text and value) and
// the validator, and sweeps the copy for R7d/R9a.

import test from "node:test";
import assert from "node:assert/strict";

import { EXAMPLE_BOTS } from "./exampleBots.ts";
import { decodeScriptText, decodeScriptValue, encodeScriptDoc } from "./scriptCodec.ts";
import { validateScript } from "./validateScript.ts";

test("there are examples, each with distinct keys and plain copy", () => {
  assert.ok(EXAMPLE_BOTS.length >= 4);
  assert.equal(new Set(EXAMPLE_BOTS.map((e) => e.key)).size, EXAMPLE_BOTS.length);
  for (const example of EXAMPLE_BOTS) {
    assert.ok(example.label.length > 0 && example.blurb.length > 0);
    assert.doesNotMatch(example.label + example.blurb, /\d{5,}/, "no ids in preset copy");
  }
});

for (const example of EXAMPLE_BOTS) {
  test(`example "${example.label}" passes the codec and the validator clean`, () => {
    // The VALUE path (what the preset button uses).
    const decoded = decodeScriptValue(example.doc);
    assert.ok(decoded.ok, decoded.ok ? "" : decoded.refusal);
    if (!decoded.ok) return;
    assert.deepEqual(decoded.warnings, [], "a bundled example must need no tidying");
    assert.deepEqual(validateScript(decoded.doc), [], "the editor must find nothing to fix");

    // And the TEXT round-trip (export → import), so sharing an example works.
    const reimported = decodeScriptText(encodeScriptDoc(decoded.doc));
    assert.ok(reimported.ok);
  });
}
