import test from "node:test";
import assert from "node:assert/strict";

import { readKeyVal, readPlainJsonField, unwrapBool, unwrapLong, unwrapReal, type JsonValue } from "./wire.ts";

test("plain JSON fields are read directly without treating the envelope as util.KeyVal", () => {
  const result: JsonValue = { type: "list", items: [7, 8] };
  const envelope: JsonValue = { ok: true, applied: true, result };

  assert.equal(readPlainJsonField(envelope, "ok"), true);
  assert.equal(readPlainJsonField(envelope, "applied"), true);
  assert.equal(readPlainJsonField(envelope, "result"), result);
  assert.equal(readPlainJsonField(envelope, "missing"), undefined);
});

test("plain JSON reader rejects arrays/null and never descends into util.KeyVal", () => {
  const keyVal: JsonValue = {
    type: "object",
    name: "util.KeyVal",
    args: { type: "dict", entries: [["ok", true]] },
  };

  assert.equal(readPlainJsonField(null, "ok"), undefined);
  assert.equal(readPlainJsonField([], "ok"), undefined);
  assert.equal(readPlainJsonField(keyVal, "ok"), undefined);
  assert.equal(readKeyVal(keyVal, "ok"), true);
});

test("unwrapBool reads a boolean or a bare 0 or 1 and rejects everything else", () => {
  assert.deepEqual([unwrapBool(true), unwrapBool(false)], [true, false]);
  // The web gateway prints a packed row's BOOL column as the server holds it.
  assert.deepEqual([unwrapBool(1), unwrapBool(0)], [true, false]);
  for (const other of [2, -1, 0.5, "1", "true", "", null, undefined, [], {}, { type: "long", value: "1" }, Number.NaN]) {
    assert.equal(unwrapBool(other), null, JSON.stringify(other));
  }
});

test("unwrapReal reads a real wrapper or a bare number and rejects everything else", () => {
  assert.equal(unwrapReal({ type: "real", value: 100000.5 }), 100000.5);
  assert.equal(unwrapReal({ type: "real", value: 0 }), 0);
  assert.equal(unwrapReal(-42), -42);
  assert.equal(unwrapReal(null), null);
  assert.equal(unwrapReal(undefined), null);
  assert.equal(unwrapReal("100000.5"), null, "bare strings are not reals");
  assert.equal(unwrapReal({ type: "real", value: "100000.5" }), null);
  assert.equal(unwrapReal({ type: "long", value: 7 }), null);
});

test("unwrapLong reads the wrapper, a bare integer, and a bare string of digits", () => {
  assert.equal(unwrapLong({ type: "long", value: "134359051855730000" }), 134359051855730000n);
  assert.equal(unwrapLong({ type: "long", value: 7 }), 7n);
  assert.equal(unwrapLong(42), 42n);
  // The gateway prints some timestamps as bare digits (market history days,
  // dogma times) where the game port gives the wrapper. Both are the same long.
  assert.equal(unwrapLong("134359051818340000"), 134359051818340000n);
  assert.equal(unwrapLong("-5"), -5n);
  assert.equal(unwrapLong("0"), 0n);
});

test("unwrapLong rejects what is not an integer", () => {
  assert.equal(unwrapLong(""), null);
  assert.equal(unwrapLong("12.5"), null);
  assert.equal(unwrapLong("12a"), null);
  assert.equal(unwrapLong(" 12"), null, "no trimming: a padded string is text");
  assert.equal(unwrapLong("0x10"), null);
  assert.equal(unwrapLong(1.5), null);
  assert.equal(unwrapLong(null), null);
  assert.equal(unwrapLong(undefined), null);
  assert.equal(unwrapLong({ type: "real", value: 7 }), null);
  assert.equal(unwrapLong({ type: "long", value: "1.5" }), null);
});
