"use strict";

// Reads a recording made by scripts/record-destiny.js for the tests that are
// built on one: every notification, the destiny events inside them, and the
// state blobs those carry.

const zlib = require("node:zlib");
const { marshalDecode } = require("../../src/gameProtocol/marshal");
const { TYPE, parsePacket } = require("../../src/gamePort/packets");
const { readNotification } = require("../../src/gamePort/session");

const text = (value) => (Buffer.isBuffer(value) ? value.toString("latin1") : value);

/** Every notification in the recording, in order, with when it arrived and what was being done. */
function notifications(fixture) {
  const out = [];
  for (const frame of fixture.frames) {
    if (frame.from !== "server") continue;
    let payload = Buffer.from(frame.hex, "hex");
    // machoNet: anything that does not start "~" is zlib; the handshake's raw values are neither.
    if (payload[0] !== 0x7e) {
      try {
        payload = zlib.inflateSync(payload);
      } catch {
        continue;
      }
    }
    let packet = null;
    try {
      packet = parsePacket(marshalDecode(payload));
    } catch {
      continue;
    }
    if (packet && packet.command === TYPE.NOTIFICATION) out.push({ atMs: frame.atMs, during: frame.during, ...readNotification(packet) });
  }
  return out;
}

/** Every answer to a call in the recording, in order, with when it arrived and what was being done: { atMs, during, value }. */
function answers(fixture) {
  const out = [];
  for (const frame of fixture.frames) {
    if (frame.from !== "server") continue;
    let payload = Buffer.from(frame.hex, "hex");
    if (payload[0] !== 0x7e) {
      try {
        payload = zlib.inflateSync(payload);
      } catch {
        continue;
      }
    }
    let packet = null;
    try {
      packet = parsePacket(marshalDecode(payload));
    } catch {
      continue;
    }
    if (!packet || packet.command !== TYPE.CALL_RSP) continue;
    // The answer travels as a substream: the value is what is inside it.
    const body = packet.body[0];
    out.push({ atMs: frame.atMs, during: frame.during, value: body && body.type === "substream" ? body.value : body });
  }
  return out;
}

/** Each DoDestinyUpdate as the client receives it: { atMs, during, entries: [[stamp, [name, args]]], waitForBubble }. */
function destinyUpdates(fixture) {
  return notifications(fixture)
    .filter((notification) => notification.method === "DoDestinyUpdate")
    .map((notification) => ({
      atMs: notification.atMs,
      during: notification.during,
      entries: notification.args[0].items.map(([stamp, [name, args]]) => [stamp, [text(name), args]]),
      waitForBubble: notification.args[1],
    }));
}

/** The (stamp, name, args) events of every update, flattened, in order. */
function destinyEvents(fixture) {
  return destinyUpdates(fixture).flatMap((update) => update.entries.map(([stamp, [name, args]]) => ({ stamp, name, args, waitForBubble: update.waitForBubble, during: update.during })));
}

/** One field of a util.KeyVal as the wire decodes it. */
const keyValField = (keyVal, name) => (keyVal.args.entries.find(([key]) => text(key) === name) || [])[1];

/** A slim item's fields, whether it came as a dict, a SlimItem object, or the first of a (slim, damage) pair. */
function slimFields(slim) {
  const item = Array.isArray(slim) ? slim[0] : slim;
  const dict = item.type === "object" ? item.args : item;
  return new Map(dict.entries.map(([key, value]) => [text(key), value]));
}

/** The state blobs of the recording, in order: { name, stamp, blob, slims }. */
function stateBlobs(fixture) {
  const blobs = [];
  for (const event of destinyEvents(fixture)) {
    if (event.name === "SetState") {
      blobs.push({ name: event.name, stamp: event.stamp, blob: keyValField(event.args[0], "state"), slims: keyValField(event.args[0], "slims").items });
    } else if (event.name === "AddBalls2" || event.name === "AddBalls") {
      blobs.push({ name: event.name, stamp: event.stamp, blob: event.args[0][0], slims: event.args[0][1].items });
    }
  }
  return blobs;
}

module.exports = { answers, destinyEvents, destinyUpdates, keyValField, notifications, slimFields, stateBlobs, text };
