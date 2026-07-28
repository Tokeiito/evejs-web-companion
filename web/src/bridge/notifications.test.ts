// notificationMgr decoder (goal R59) against REAL captured bytes.
//
// The fixtures below are VERBATIM notification DTOs captured live through
// GET /api/bridge/notifications from Farmer (character 140000005) on 2026-07-22
// (213 notifications, 22 typeIDs). Each is a util.KeyVal with a per-typeID `data`
// dict; the envelope is decoded, `data` is carried through untouched.
//
// ⚠ `created` is a FILETIME long past 2^53 — a bigint, never a lossy Number.
// ⚠ R7d: senderID is an entity id kept as a numeric field; the sweep proves it
// survives (and its companion proves the sweep is not vacuous).

import test from "node:test";
import assert from "node:assert/strict";

import { decodeNotificationWriteAck, decodeNotifications } from "./notifications.ts";
import type { JsonValue } from "./wire.ts";

/** The ordinary JSON object emitted by the BFF's Express response. */
function plainAck(fields: Record<string, JsonValue>): JsonValue {
  return { ...fields };
}

// VERBATIM live capture: a typeID-35 "item delivered" notification.
const N0: JsonValue = {
  type: "object",
  name: "util.KeyVal",
  args: {
    type: "dict",
    entries: [
      ["notificationID", 2877],
      ["typeID", 35],
      ["senderID", 1000113],
      ["receiverID", 140000005],
      ["processed", false],
      ["created", { type: "long", value: "134282765436910000" }],
      ["data", { type: "dict", entries: [["itemID", 9988400082811], ["payout", true]] }],
    ],
  },
};

// VERBATIM live capture: a typeID-13 "bill paid" notification with a rich data dict.
const N1: JsonValue = {
  type: "object",
  name: "util.KeyVal",
  args: {
    type: "dict",
    entries: [
      ["notificationID", 2759],
      ["typeID", 13],
      ["senderID", 1000035],
      ["receiverID", 140000005],
      ["processed", false],
      ["created", { type: "long", value: "134281701216410000" }],
      [
        "data",
        {
          type: "dict",
          entries: [
            ["billID", 35],
            ["billTypeID", 2],
            ["amount", 10000],
            ["interest", 0],
            ["debtorID", 98000001],
            ["creditorID", 1000035],
            ["dueDateTime", { type: "long", value: "134307621002740000" }],
            ["paidDateTime", { type: "long", value: "134281701216320000" }],
            ["paidByOwnerID", 98000001],
          ],
        },
      ],
    ],
  },
};

// VERBATIM live capture: a PROCESSED (already-read) notification.
const NP: JsonValue = {
  type: "object",
  name: "util.KeyVal",
  args: {
    type: "dict",
    entries: [
      ["notificationID", 2676],
      ["typeID", 35],
      ["senderID", 1000113],
      ["receiverID", 140000005],
      ["processed", true],
      ["created", { type: "long", value: "134281297282640000" }],
      ["data", { type: "dict", entries: [["itemID", 9988400076029], ["payout", true]] }],
    ],
  },
};

test("decodeNotifications on an empty array is empty (a real 'no notifications')", () => {
  assert.deepEqual(decodeNotifications([]), []);
});

test("decodeNotifications decodes the live notification envelope", () => {
  const [n0, n1] = decodeNotifications([N0, N1]);
  assert.deepEqual(
    { ...n0, created: n0!.created?.toString(), data: undefined },
    {
      notificationID: 2877,
      typeID: 35,
      senderID: 1000113,
      receiverID: 140000005,
      processed: false,
      created: "134282765436910000",
      data: undefined,
    },
  );
  assert.equal(n1!.typeID, 13);
  assert.equal(n1!.senderID, 1000035);
});

test("decodeNotifications keeps `created` a bigint past 2^53 (no precision loss)", () => {
  const [n0] = decodeNotifications([N0]);
  assert.equal(typeof n0!.created, "bigint");
  assert.equal(n0!.created, 134282765436910000n);
  assert.ok(n0!.created! > 9007199254740992n, "the FILETIME exceeds 2^53");
});

test("decodeNotifications carries the per-typeID `data` payload through untouched", () => {
  const [n1] = decodeNotifications([N1]);
  // The rich bill dict is preserved exactly as captured, not schema'd or dropped.
  assert.deepEqual(n1!.data, (N1 as { args: { entries: JsonValue[][] } }).args.entries[6]![1]);
});

test("decodeNotifications reads the processed flag (already-read notification)", () => {
  const [np] = decodeNotifications([NP]);
  assert.equal(np!.processed, true);
  assert.equal(np!.notificationID, 2676);
});

test("decodeNotifications drops a non-KeyVal row and tolerates a non-array", () => {
  assert.deepEqual(decodeNotifications(null), []);
  assert.deepEqual(decodeNotifications({ type: "list", items: [] } as unknown as JsonValue), []);
  // A stray non-KeyVal entry is dropped; the real one still decodes.
  const decoded = decodeNotifications([42 as unknown as JsonValue, N0]);
  assert.equal(decoded.length, 1);
  assert.equal(decoded[0]!.notificationID, 2877);
});

// R7d id-sweep: senderID survives as a numeric field.
function senderIDs(list: ReturnType<typeof decodeNotifications>): number[] {
  return list.map((n) => n.senderID);
}

test("R7d: decoded notifications preserve senderID as a numeric field", () => {
  const ids = senderIDs(decodeNotifications([N0, N1]));
  assert.ok(ids.includes(1000113), "N0 senderID preserved");
  assert.ok(ids.includes(1000035), "N1 senderID preserved");
});

test("the notification senderID extractor actually reads the decoded content", () => {
  // Companion: distinct ids yield distinct output, so the sweep is not vacuous.
  const ids = senderIDs([
    { notificationID: 1, typeID: 1, senderID: 77, receiverID: 0, processed: false, created: null, data: null },
  ]);
  assert.deepEqual(ids, [77]);
});

// --- R87 write acks (Phase-3 notificationMgr WRITES) -------------------------

test("R87 — a notification write ack decodes to {ok, applied}", () => {
  const ack = decodeNotificationWriteAck(plainAck({ ok: true, applied: true, result: null }));
  assert.deepEqual(ack, { ok: true, applied: true });
});

test("R87 — a declined notification write is read as not-applied, not a throw", () => {
  const ack = decodeNotificationWriteAck(plainAck({ ok: true, applied: false }));
  assert.equal(ack.ok, true);
  assert.equal(ack.applied, false);
});
