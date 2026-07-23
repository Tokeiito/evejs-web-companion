// Calendar decoder (goal R59) against REAL captured bytes + the server's own
// populated response-row shape.
//
// The event + event-details fixtures are VERBATIM live captures through
// GET /api/bridge/calendar from Farmer (character 140000005) on 2026-07-22: one
// real event ("Make a wish", eventID 980000000006, ownerID 1) in month 2026-07,
// and its details. responsesForCharacter and responsesToEvent were EMPTY live
// (Farmer responded to nothing; no one responded to that event) — the empty path
// is asserted directly. The POPULATED response rows mirror the server's
// buildCharacterResponseRow / buildEventResponseRow (eve.js calendarPayloads.js) —
// util.KeyVal{eventID,status} and util.KeyVal{characterID,status} — the same
// KeyVal wire primitive proven live in the event capture.
//
// ⚠ eventDateTime / dateModified are FILETIME longs (bigint). R7d: ownerID /
// creatorID / characterID / eventID survive as numeric fields.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeCalendarEventCreatedAck,
  decodeCalendarWriteAck,
  decodeEventDetails,
  decodeEventList,
  decodeResponsesForCharacter,
  decodeResponsesToEvent,
} from "./calendar.ts";
import type { JsonValue } from "./wire.ts";

function keyVal(entries: readonly [string, JsonValue][]): JsonValue {
  return { type: "object", name: "util.KeyVal", args: { type: "dict", entries } };
}
function list(items: readonly JsonValue[]): JsonValue {
  return { type: "list", items };
}

// VERBATIM live capture: calendarProxy.GetEventList(7, 2026) — a 3-tuple whose
// first element is the month's events (one real event here).
const EVENT_LIST_LIVE: JsonValue = [
  list([
    keyVal([
      ["eventID", 980000000006],
      ["ownerID", 1],
      ["eventDateTime", { type: "long", value: "134282418600000000" }],
      ["eventDuration", 11],
      ["eventTitle", "Make a wish"],
      ["importance", 0],
      ["dateModified", { type: "long", value: "134274243506890000" }],
      ["isDeleted", false],
      ["flag", 8],
      ["autoEventType", null],
    ]),
  ]),
  null,
  null,
];

// VERBATIM live capture: calendarProxy.GetEventDetails(980000000006, 1).
const EVENT_DETAILS_LIVE: JsonValue = keyVal([
  ["eventText", "The clock reads 11:11 — make a wish."],
  ["creatorID", 1],
]);

// The EXACT live empty captures.
const RESPONSES_FOR_CHARACTER_EMPTY = list([]);
const RESPONSES_TO_EVENT_EMPTY = list([]);

test("decodeEventList decodes the live month event from the 3-tuple", () => {
  const events = decodeEventList(EVENT_LIST_LIVE);
  assert.equal(events.length, 1);
  const event = events[0]!;
  assert.equal(event.eventID, 980000000006);
  assert.equal(event.ownerID, 1);
  assert.equal(event.eventTitle, "Make a wish");
  assert.equal(event.eventDuration, 11);
  assert.equal(event.importance, 0);
  assert.equal(event.isDeleted, false);
  assert.equal(event.flag, 8);
  assert.equal(event.autoEventType, null);
  // The FILETIMEs are bigints.
  assert.equal(event.eventDateTime, 134282418600000000n);
  assert.equal(event.dateModified, 134274243506890000n);
});

test("decodeEventList on an empty month tuple is empty (a real 'no events')", () => {
  assert.deepEqual(decodeEventList([list([]), null, null]), []);
  assert.deepEqual(decodeEventList(null), []);
});

test("decodeEventList drops a row with no positive eventID", () => {
  const events = decodeEventList([list([keyVal([["eventID", 0], ["eventTitle", "ghost"]])]), null, null]);
  assert.deepEqual(events, []);
});

test("decodeEventDetails decodes the live event body + creator", () => {
  assert.deepEqual(decodeEventDetails(EVENT_DETAILS_LIVE), {
    eventText: "The clock reads 11:11 — make a wish.",
    creatorID: 1,
  });
});

test("decodeEventDetails on a refused/absent read is null (a real 'no such event')", () => {
  assert.equal(decodeEventDetails(null), null);
  assert.equal(decodeEventDetails({ type: "list", items: [] }), null);
});

test("decodeResponsesForCharacter on the live empty capture is empty", () => {
  assert.deepEqual(decodeResponsesForCharacter(RESPONSES_FOR_CHARACTER_EMPTY), []);
});

test("decodeResponsesForCharacter decodes the server's {eventID,status} rows", () => {
  const rows = decodeResponsesForCharacter(
    list([keyVal([["eventID", 980000000006], ["status", 1]]), keyVal([["eventID", 980000000009], ["status", 2]])]),
  );
  assert.deepEqual(rows, [
    { eventID: 980000000006, status: 1 },
    { eventID: 980000000009, status: 2 },
  ]);
});

test("decodeResponsesToEvent on the live empty capture is empty (no one responded)", () => {
  assert.deepEqual(decodeResponsesToEvent(RESPONSES_TO_EVENT_EMPTY), []);
});

test("decodeResponsesToEvent decodes the server's {characterID,status} rows", () => {
  const rows = decodeResponsesToEvent(
    list([keyVal([["characterID", 140000005], ["status", 1]]), keyVal([["characterID", 140000178], ["status", 0]])]),
  );
  assert.deepEqual(rows, [
    { characterID: 140000005, status: 1 },
    { characterID: 140000178, status: 0 },
  ]);
});

// R7d id-sweep: ownerID / creatorID / characterID survive as numeric fields.
test("R7d: calendar decoders preserve owner/creator/character ids as numeric fields", () => {
  assert.equal(decodeEventList(EVENT_LIST_LIVE)[0]!.ownerID, 1);
  assert.equal(decodeEventDetails(EVENT_DETAILS_LIVE)!.creatorID, 1);
  const responders = decodeResponsesToEvent(list([keyVal([["characterID", 140000178], ["status", 1]])]));
  assert.equal(responders[0]!.characterID, 140000178);
});

test("the calendar id assertions actually read distinct decoded content (not vacuous)", () => {
  // Companion: a different owner id decodes to a different value.
  const events = decodeEventList([list([keyVal([["eventID", 7], ["ownerID", 42]])]), null, null]);
  assert.equal(events[0]!.ownerID, 42);
});

// --- R87 write acks (Phase-3 calendarMgr WRITES) -----------------------------

test("R87 — a plain calendar write ack decodes to {ok, applied}", () => {
  const ack = decodeCalendarWriteAck(keyVal([["ok", true], ["applied", true], ["result", null]]));
  assert.deepEqual(ack, { ok: true, applied: true });
});

test("R87 — a declined calendar write is read as not-applied, not a throw", () => {
  const ack = decodeCalendarWriteAck(keyVal([["ok", true], ["applied", false]]));
  assert.equal(ack.applied, false);
});

test("R87 — a Create*Event ack carries the new eventID", () => {
  const ack = decodeCalendarEventCreatedAck(keyVal([["ok", true], ["applied", true], ["eventID", 980000000042]]));
  assert.deepEqual(ack, { ok: true, applied: true, eventID: 980000000042 });
});

test("R87 — a create the server declined has a null eventID and applied false", () => {
  const ack = decodeCalendarEventCreatedAck(keyVal([["ok", true], ["applied", false], ["eventID", null]]));
  assert.equal(ack.applied, false);
  assert.equal(ack.eventID, null);
});
