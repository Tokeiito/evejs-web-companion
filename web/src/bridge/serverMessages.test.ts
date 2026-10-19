// What the server tells the player unasked: OnRemoteMessage(msgID, dict), worded from the client's dialog where the
// page has it, else in this client's words (gameui.py OnRemoteMessage).

import test from "node:test";
import assert from "node:assert/strict";

import { REMOTE_MESSAGE, decodeRemoteMessage, serverMessageText } from "./serverMessages.ts";
import type { JsonValue } from "./wire.ts";

const dict = (entries: readonly (readonly [string, JsonValue])[]): JsonValue => ({ type: "dict", entries: entries as JsonValue });
const nameOf = (kind: string, id: number) => `${kind} ${id}`;

test("a CustomNotify is the server's own sentence; a CustomError is said as an error", () => {
  assert.equal(REMOTE_MESSAGE, "OnRemoteMessage");
  const notify = decodeRemoteMessage(["CustomNotify", dict([["notify", "Crimson Harvest is active."]])])!;
  assert.deepEqual([notify.kind, notify.words.dialog, notify.words.part], ["notice", "CustomNotify", "body"]);
  assert.equal(serverMessageText(notify, nameOf, null), "Crimson Harvest is active.");
  // A wstring is its text.
  const wrapped = decodeRemoteMessage(["CustomNotify", dict([["notify", { type: "wstring", value: "Sites spawned." }]])])!;
  assert.equal(serverMessageText(wrapped, nameOf, null), "Sites spawned.");
  const error = decodeRemoteMessage(["CustomError", dict([["error", "Nope."]])])!;
  assert.deepEqual([error.kind, serverMessageText(error, nameOf, null)], ["error", "Nope."]);
});

test("the client's own dialog wins where the page has it, filled from the dict", () => {
  const warp = decodeRemoteMessage(["FleetWarp", dict([["leader", "Test Pilot"]])])!;
  assert.equal(serverMessageText(warp, nameOf, null), "Following Test Pilot in warp.");
  const templates = { "dialog:FleetWarp/body": "Following {leader} in warp" };
  assert.equal(serverMessageText(warp, nameOf, { templates }), "Following Test Pilot in warp");
  assert.equal(serverMessageText(decodeRemoteMessage(["ShipInWarp", null])!, nameOf, null), "You cannot do that while warping.");
});

test("a dialog nobody has words for is not shown, and what names no dialog is nothing", () => {
  assert.equal(serverMessageText(decodeRemoteMessage(["SomeDialogNobodyWords", dict([])])!, nameOf, null), null);
  assert.equal(serverMessageText(decodeRemoteMessage(["CustomNotify", dict([["notify", "  "]])])!, nameOf, null), null);
  for (const args of [[], [7], ["has spaces"], [null, dict([])]] as JsonValue[][]) {
    assert.equal(decodeRemoteMessage(args), null, JSON.stringify(args));
  }
});
