// R100 Phase-4 bound dogma module-op write-ack decoder tests — WB-DOGMA batch A
// (target-drop / overload / stop-overload / nanite module-repair / weapon-bank
// link/merge). PLUMBING ONLY. None fired live.

import test from "node:test";
import assert from "node:assert/strict";

import { decodeDogmaModuleWriteAck } from "./boundDogmaWrites.ts";
import type { JsonValue } from "./wire.ts";

function plainAck(fields: Record<string, JsonValue>): JsonValue {
  return { ...fields };
}

test("R100 — a null-returning module-op write (RemoveTargets/ClearTargets) decodes to {ok, applied, result:null}", () => {
  const ack = decodeDogmaModuleWriteAck(plainAck({ ok: true, applied: true, result: null }));
  assert.deepEqual(ack, { ok: true, applied: true, result: null });
});

test("R100 — an Overload/StopOverload ack carries the moduleID return through untouched", () => {
  const ack = decodeDogmaModuleWriteAck(plainAck({ ok: true, applied: true, result: 7400000020 }));
  assert.equal(ack.applied, true);
  assert.equal(ack.result, 7400000020);
});

test("R100 — an InitiateModuleRepairMany triple return is passed through untouched", () => {
  const triple: JsonValue = {
    type: "list",
    items: [
      { type: "list", items: [7400000020] },
      { type: "list", items: [] },
      { type: "list", items: [] },
    ],
  };
  const ack = decodeDogmaModuleWriteAck(plainAck({ ok: true, applied: true, result: triple }));
  assert.equal(ack.applied, true);
  assert.deepEqual(ack.result, triple);
});

test("R100 — a refused (unconfirmed) write is not-applied, not a throw", () => {
  const ack = decodeDogmaModuleWriteAck(plainAck({ ok: true, applied: false }));
  assert.equal(ack.ok, true);
  assert.equal(ack.applied, false);
  assert.equal(ack.result, null);
});

// --- R101 WB-DOGMA batch B (CLOSES WB-DOGMA) reuse the SAME uniform ack --------
// The 11 batch-B writes (weapon-bank peel/unlink/link-all/unlink-all/destroy,
// probe launch, drone settings, and the char-brain inject-skill / inject-implant /
// destroy-implant / use-booster ops) fold their varied server returns into the
// SAME {ok, applied, result} ack, so decodeDogmaModuleWriteAck decodes them too.
// None fired live (educated guess from the dogmaService handler code):
//   PeelAndLink / LinkAllWeapons / UnlinkAllModules  → a weapon-bank state dict
//   UnlinkModule                                     → the peeled moduleID (a number)
//   DestroyWeaponBank / LaunchProbes / InjectImplant /
//     DestroyImplant / UseBooster                    → null
//   ChangeDroneSettings                              → a boolean
//   InjectSkillIntoBrain                             → the injector's result value

test("R101 — a PeelAndLink weapon-bank state dict is carried through untouched", () => {
  const bankDict: JsonValue = {
    type: "object",
    name: "util.KeyVal",
    args: { type: "dict", entries: [["banks", { type: "list", items: [7400000020, 7400000021] }]] },
  };
  const ack = decodeDogmaModuleWriteAck(plainAck({ ok: true, applied: true, result: bankDict }));
  assert.equal(ack.applied, true);
  assert.deepEqual(ack.result, bankDict);
});

test("R101 — an UnlinkModule peeledModuleID number return passes through", () => {
  const ack = decodeDogmaModuleWriteAck(plainAck({ ok: true, applied: true, result: 7400000021 }));
  assert.equal(ack.applied, true);
  assert.equal(ack.result, 7400000021);
});

test("R101 — a null-returning brain op (InjectImplant/DestroyImplant/UseBooster) decodes to {ok, applied, result:null}", () => {
  const ack = decodeDogmaModuleWriteAck(plainAck({ ok: true, applied: true, result: null }));
  assert.deepEqual(ack, { ok: true, applied: true, result: null });
});

test("R101 — a ChangeDroneSettings boolean return passes through", () => {
  const ack = decodeDogmaModuleWriteAck(plainAck({ ok: true, applied: true, result: true }));
  assert.equal(ack.applied, true);
  assert.equal(ack.result, true);
});
