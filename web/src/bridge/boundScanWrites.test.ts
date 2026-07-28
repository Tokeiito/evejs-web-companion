// R104 Phase-4 bound probe/scan-control write-ack decoder tests — WB-SCAN
// (SignalTrackerRegister / SetProbeDestination / SetProbeRangeStep / ConeScan /
// RequestScans / ReconnectToLostProbes / DestroyProbe / RecoverProbes /
// SetActivityState). The HTTP ack is plain JSON; nested results stay marshaled.

import test from "node:test";
import assert from "node:assert/strict";

import { decodeDirectionalScanHitIDs, decodeScanWriteAck } from "./boundScanWrites.ts";
import type { JsonValue } from "./wire.ts";

test("R104 WB-SCAN — a null-returning probe verb decodes to {ok, applied, result:null}", () => {
  const ack = decodeScanWriteAck({ ok: true, applied: true, result: null });
  assert.deepEqual(ack, { ok: true, applied: true, result: null });
});

test("R104 WB-SCAN — a ConeScan directional-scan list is carried through untouched", () => {
  const scanList: JsonValue = {
    type: "list",
    items: [
      { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["itemID", 9000001]] } },
    ],
  };
  const ack = decodeScanWriteAck({ ok: true, applied: true, result: scanList });
  assert.equal(ack.applied, true);
  assert.deepEqual(ack.result, scanList);
});

test("R104 WB-SCAN — a RecoverProbes recovered-probeID list is carried through untouched", () => {
  const probeIDs: JsonValue = { type: "list", items: [70000001, 70000002] };
  const ack = decodeScanWriteAck({ ok: true, applied: true, result: probeIDs });
  assert.deepEqual(ack.result, probeIDs);
});

test("R104 WB-SCAN — a refused (unconfirmed) DestroyProbe is not-applied, not a throw", () => {
  const ack = decodeScanWriteAck({ ok: true, applied: false });
  assert.equal(ack.ok, true);
  assert.equal(ack.applied, false);
  assert.equal(ack.result, null);
});

test("ConeScan hit decoder — KeyVal rows yield ids; junk rows skipped; non-array is null", () => {
  const keyValRow = (id: unknown): JsonValue =>
    ({ type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["id", id], ["typeID", 587], ["groupID", 25]] } }) as JsonValue;
  const hits = decodeDirectionalScanHitIDs([keyValRow(555000), keyValRow("bad"), { junk: true } as unknown as JsonValue, keyValRow(555001)]);
  assert.deepEqual(hits, [555000, 555001]);
  assert.equal(decodeDirectionalScanHitIDs(null), null);
  assert.equal(decodeDirectionalScanHitIDs({ type: "dict", entries: [] } as unknown as JsonValue), null);
  assert.deepEqual(decodeDirectionalScanHitIDs([]), []);
});
