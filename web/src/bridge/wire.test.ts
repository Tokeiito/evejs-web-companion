import test from "node:test";
import assert from "node:assert/strict";

import { readKeyVal, readPlainJsonField, type JsonValue } from "./wire.ts";

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
