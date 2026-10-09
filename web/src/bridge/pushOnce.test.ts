// What the server said once, taken once.

import test from "node:test";
import assert from "node:assert/strict";

import { PUSHES_REMEMBERED, createPushLedger } from "./pushOnce.ts";

const at = (sequence: unknown, epoch: unknown = "epoch-1") => ({ epoch, sequence });

test("a push is taken the first time its cursor is seen, and not again", () => {
  const ledger = createPushLedger();
  assert.equal(ledger.take(at(5)), true);
  assert.equal(ledger.take(at(5)), false);
  assert.equal(ledger.take(at(5)), false);
  // Its neighbours are their own pushes, in whatever order they come.
  assert.equal(ledger.take(at(7)), true);
  assert.equal(ledger.take(at(6)), true);
  assert.equal(ledger.take(at(6)), false);
  assert.equal(ledger.take(at(7)), false);
});

test("a push with no cursor, or none that is a stream's, is always taken", () => {
  const ledger = createPushLedger();
  for (const cursor of [undefined, null, 5, "5", [], {}, at(undefined), at(null), at("5"), at(0), at(-1), at(1.5), at(2 ** 60), at(5, ""), at(5, null), at(5, 7)]) {
    assert.equal(ledger.take(cursor), true, JSON.stringify(cursor));
    assert.equal(ledger.take(cursor), true, JSON.stringify(cursor));
  }
  // And none of that was remembered as number 5.
  assert.equal(ledger.take(at(5)), true);
});

test("another BFF process numbers its events afresh, and so does a new session", () => {
  const ledger = createPushLedger();
  assert.equal(ledger.take(at(1)), true);
  assert.equal(ledger.take(at(2)), true);
  // A new epoch: the same numbers are other events.
  assert.equal(ledger.take(at(1, "epoch-2")), true);
  assert.equal(ledger.take(at(1, "epoch-2")), false);
  // And the old epoch's are forgotten with it.
  assert.equal(ledger.take(at(2)), true);
  assert.equal(ledger.take(at(2)), false);

  ledger.clear();
  assert.equal(ledger.take(at(2)), true);
  assert.equal(ledger.take(at(2)), false);
});

test("only so many are remembered, and the oldest are forgotten first", () => {
  const ledger = createPushLedger(3);
  for (const sequence of [1, 2, 3]) assert.equal(ledger.take(at(sequence)), true);
  for (const sequence of [1, 2, 3]) assert.equal(ledger.take(at(sequence)), false);
  // A fourth pushes the first out, and no other.
  assert.equal(ledger.take(at(4)), true);
  assert.equal(ledger.take(at(2)), false);
  assert.equal(ledger.take(at(3)), false);
  assert.equal(ledger.take(at(4)), false);
  assert.equal(ledger.take(at(1)), true);
  // Which pushed the second out in turn.
  assert.equal(ledger.take(at(2)), true);
});

test("as many are remembered as an answer can bring, and more", () => {
  assert.equal(PUSHES_REMEMBERED >= 2 * 4096, true);
  const ledger = createPushLedger();
  for (let sequence = 1; sequence <= PUSHES_REMEMBERED; sequence += 1) ledger.take(at(sequence));
  assert.equal(ledger.take(at(1)), false);
  assert.equal(ledger.take(at(PUSHES_REMEMBERED)), false);
});
