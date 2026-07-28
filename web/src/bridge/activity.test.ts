import test from "node:test";
import assert from "node:assert/strict";

import {
  calendarResponseText,
  decodeActivityCalendar,
  decodeActivityNotifications,
  filetimeToUnixMs,
  liveActivityTitle,
  notificationTitle,
} from "./activity.ts";
import type { JsonValue } from "./wire.ts";

function keyVal(entries: readonly [string, JsonValue][]): JsonValue {
  return { type: "object", name: "util.KeyVal", args: { type: "dict", entries } };
}

function list(items: readonly JsonValue[]): JsonValue {
  return { type: "list", items };
}

function filetime(unixMs: number): JsonValue {
  return {
    type: "long",
    value: (BigInt(unixMs) * 10000n + 116444736000000000n).toString(),
  };
}

function notification(
  notificationID: number,
  typeID: number,
  senderID: number,
  createdMs: number,
  processed = false,
): JsonValue {
  return keyVal([
    ["notificationID", notificationID],
    ["typeID", typeID],
    ["senderID", senderID],
    ["receiverID", 140000005],
    ["processed", processed],
    ["created", filetime(createdMs)],
    ["data", null],
  ]);
}

function calendarEvent(
  eventID: number,
  startsAtMs: number,
  title: string,
  isDeleted = false,
): JsonValue {
  return keyVal([
    ["eventID", eventID],
    ["ownerID", 98000001],
    ["eventDateTime", filetime(startsAtMs)],
    ["eventDuration", 30],
    ["eventTitle", title],
    ["importance", 1],
    ["dateModified", filetime(startsAtMs - 1000)],
    ["isDeleted", isDeleted],
    ["flag", 0],
    ["autoEventType", null],
  ]);
}

test("notification Activity reads keep successful empty, unavailable and error distinct", () => {
  const empty = decodeActivityNotifications({
    all: [],
    unprocessed: [],
    errors: { all: null, unprocessed: null },
  });
  assert.deepEqual(empty.notifications, { status: "ready", value: [], error: null });
  assert.deepEqual(empty.unprocessedCount, { status: "ready", value: 0, error: null });

  const absent = decodeActivityNotifications({
    all: null,
    unprocessed: null,
    errors: { all: null, unprocessed: null },
  });
  assert.equal(absent.notifications.status, "unavailable");
  assert.equal(absent.unprocessedCount.status, "unavailable");

  const failed = decodeActivityNotifications({
    all: null,
    unprocessed: null,
    errors: { all: "CALL_FAILED", unprocessed: "CALL_FAILED" },
  });
  assert.equal(failed.notifications.status, "error");
  assert.equal(failed.unprocessedCount.status, "error");
  assert.doesNotMatch(failed.notifications.error ?? "", /CALL_FAILED/);
});

test("notification Activity rows are newest-first, capped, and use player-facing titles", () => {
  const now = Date.UTC(2026, 6, 27, 12);
  const decoded = decodeActivityNotifications({
    all: [
      notification(1, 987654, 42, now - 20_000, true),
      notification(2, 1000, 43, now - 10_000),
      notification(3, 35, 44, now),
    ],
    unprocessed: [notification(2, 1000, 43, now - 10_000), notification(3, 35, 44, now)],
    errors: { all: null, unprocessed: null },
  });
  assert.equal(decoded.notifications.status, "ready");
  assert.deepEqual(decoded.notifications.value?.map((row) => row.title), [
    "Insurance payment",
    "Skill training finished",
    "New notification",
  ]);
  assert.equal(decoded.unprocessedCount.value, 2);
  assert.equal(notificationTitle(987654), "New notification");
  assert.doesNotMatch(notificationTitle(987654), /987654/);
});

test("calendar Activity reads keep empty, unavailable and per-arm errors distinct", () => {
  const empty = decodeActivityCalendar({
    eventList: [list([]), null, null],
    responsesForCharacter: list([]),
    errors: { eventList: null, responsesForCharacter: null },
  });
  assert.deepEqual(empty.calendarEvents, { status: "ready", value: [], error: null });
  assert.deepEqual(empty.calendarResponses, { status: "ready", value: [], error: null });

  const malformed = decodeActivityCalendar({
    eventList: null,
    responsesForCharacter: null,
    errors: { eventList: null, responsesForCharacter: null },
  });
  assert.equal(malformed.calendarEvents.status, "unavailable");
  assert.equal(malformed.calendarResponses.status, "unavailable");

  const failed = decodeActivityCalendar({
    eventList: null,
    responsesForCharacter: null,
    errors: { eventList: "CALENDAR_PROXY_FAILED", responsesForCharacter: "CALL_FAILED" },
  });
  assert.equal(failed.calendarEvents.status, "error");
  assert.equal(failed.calendarResponses.status, "error");
});

test("calendar Activity keeps upcoming non-deleted events and joins character responses", () => {
  const now = Date.UTC(2026, 6, 27, 12);
  const decoded = decodeActivityCalendar(
    {
      eventList: [
        list([
          calendarEvent(1, now + 3_600_000, "Later"),
          calendarEvent(2, now - 3_600_000, "Past"),
          calendarEvent(3, now + 1_800_000, "Soon"),
          calendarEvent(4, now + 900_000, "Deleted", true),
        ]),
        null,
        null,
      ],
      responsesForCharacter: list([
        keyVal([["eventID", 3], ["status", 4]]),
      ]),
      errors: { eventList: null, responsesForCharacter: null },
    },
    now,
  );

  assert.equal(decoded.calendarEvents.status, "ready");
  assert.deepEqual(decoded.calendarEvents.value?.map((event) => event.title), ["Soon", "Later"]);
  assert.deepEqual(decoded.calendarResponses.value, [{ eventID: 3, status: 4 }]);
  assert.equal(calendarResponseText(4), "Going");
  assert.equal(calendarResponseText(undefined), "No response recorded");
  assert.equal(filetimeToUnixMs(BigInt((filetime(now) as { value: string }).value)), now);
});

test("live Activity labels never expose service, method or args", () => {
  const live = {
    kind: "service",
    service: "mailMgr",
    method: "OnMailUpdatedByExternal",
    receivedAtMs: 123,
    args: [9988400076029, "secret-payload"],
  } as const;
  const title = liveActivityTitle(live);
  assert.equal(title, "Mail updated");
  assert.doesNotMatch(title, /mailMgr|OnMailUpdated|9988400076029|secret/);

  assert.equal(
    liveActivityTitle({ ...live, service: "mysterySvc", method: "OpaqueMethod" }),
    "Session activity",
  );
});
