// The line the agent's window writes for a mission's time. The templates are made up, in the shape the
// client's are in; the client's own are read from its install.

import test from "node:test";
import assert from "node:assert/strict";

import { MISSION_TIME_LABELS, MISSION_TIME_WORD_LABELS, decodeMissionTimes, missionTimeShown, missionTimeText } from "./missionTime.ts";
import type { AgentConversation } from "../store/types.ts";
import { BLUE_TIME, INTERVAL_LABELS, TIME_PARTS } from "./timeInterval.ts";

const { SEC, MIN, HOUR } = BLUE_TIME;

const briefing = (entries: Array<[string, unknown]>) => ({ type: "dict", entries }) as never;

const TEMPLATES: Record<string, string> = {
  ...Object.fromEntries(TIME_PARTS.map((part) => [INTERVAL_LABELS.part(part), `{[numeric]units} {[numeric]units-> "${part}", "${part}s"}`])),
  ...Object.fromEntries(TIME_PARTS.map((part) => [INTERVAL_LABELS.lessThanOne(part), `under one ${part}`])),
  [INTERVAL_LABELS.listForm]: "{firstPart} plus {secondPart}",
  [INTERVAL_LABELS.delimiter]: "; ",
  [INTERVAL_LABELS.shortAmount]: "hardly any time",
  [MISSION_TIME_LABELS.declineGeneric]: "<i>Saying no too often costs standing.</i>",
  [MISSION_TIME_LABELS.declineTimeLeft]: "Saying no inside {timeRemaining} costs standing.",
  [MISSION_TIME_LABELS.expiresAt]: "Gone at {[datetime]expireTime}",
};

test("the two times are read from the briefing as the server sends them", () => {
  // An offer with no decline timer running, and no expiry.
  assert.deepEqual(decodeMissionTimes(briefing([["Decline Time", -1], ["Expiration Time", null]])), { declineTime: -1n, expirationTime: null });
  // Inside the decline window: the time left, as a number or as a long.
  assert.deepEqual(decodeMissionTimes(briefing([["Decline Time", 55_712_640_218], ["Expiration Time", null]])), { declineTime: 55_712_640_218n, expirationTime: null });
  assert.deepEqual(decodeMissionTimes(briefing([["Decline Time", { type: "long", value: "55712640218" }]])), { declineTime: 55_712_640_218n, expirationTime: null });
  // Accepted: no decline time, and when it expires, too large for a plain number.
  assert.deepEqual(
    decodeMissionTimes(briefing([["Decline Time", null], ["Expiration Time", { type: "long", value: "134361284400000000" }]])),
    { declineTime: null, expirationTime: 134_361_284_400_000_000n },
  );
  // A briefing that names neither.
  assert.deepEqual(decodeMissionTimes(briefing([["Mission Title ID", 58607]])), { declineTime: null, expirationTime: null });
  // No briefing at all.
  assert.equal(decodeMissionTimes(null), null);
  assert.equal(decodeMissionTimes(undefined), null);
});

test("an offer with no decline timer running says the general thing about declining", () => {
  assert.equal(missionTimeText({ declineTime: -1n, expirationTime: null }, TEMPLATES), "Saying no too often costs standing.");
  // The decline time is read first: an expiry beside it is not said.
  assert.equal(missionTimeText({ declineTime: -1n, expirationTime: 134_361_284_400_000_000n }, TEMPLATES), "Saying no too often costs standing.");
});

test("inside the decline window the time left is written out, to minutes, or to seconds in the last minute", () => {
  assert.equal(missionTimeText({ declineTime: 3n * HOUR + 24n * MIN + 30n * SEC, expirationTime: null }, TEMPLATES), "Saying no inside 3 hours plus 24 minutes costs standing.");
  assert.equal(missionTimeText({ declineTime: MIN + SEC, expirationTime: null }, TEMPLATES), "Saying no inside 1 minute costs standing.");
  // A minute exactly is not more than a minute: seconds are shown, and there are none over.
  assert.equal(missionTimeText({ declineTime: MIN, expirationTime: null }, TEMPLATES), "Saying no inside 1 minute costs standing.");
  assert.equal(missionTimeText({ declineTime: MIN - SEC, expirationTime: null }, TEMPLATES), "Saying no inside 59 seconds costs standing.");
  assert.equal(missionTimeText({ declineTime: 30n * SEC + 5n, expirationTime: null }, TEMPLATES), "Saying no inside 30 seconds costs standing.");
  // Under a second, and under a millisecond.
  assert.equal(missionTimeText({ declineTime: SEC - 1n, expirationTime: null }, TEMPLATES), "Saying no inside under one second costs standing.");
  assert.equal(missionTimeText({ declineTime: 5n, expirationTime: null }, TEMPLATES), "Saying no inside hardly any time costs standing.");
  assert.equal(missionTimeText({ declineTime: 0n, expirationTime: null }, TEMPLATES), "Saying no inside hardly any time costs standing.");
  // Only -1 is the general message. Any other time under nought is a time left, and a short one.
  assert.equal(missionTimeText({ declineTime: -2n, expirationTime: null }, TEMPLATES), "Saying no inside hardly any time costs standing.");
});

test("with no decline time, a mission that expires says when", () => {
  // 2026-10-15 23:54 UTC.
  const when = (BigInt(Date.UTC(2026, 9, 15, 23, 54, 0)) + 11_644_473_600_000n) * 10_000n;
  assert.equal(missionTimeText({ declineTime: null, expirationTime: when }, TEMPLATES), "Gone at 2026.10.15 23:54");
});

test("with neither time, or no briefing, there is no line", () => {
  assert.equal(missionTimeText({ declineTime: null, expirationTime: null }, TEMPLATES), null);
  assert.equal(missionTimeText(null, TEMPLATES), null);
});

test("without the client's words for it, nothing is written", () => {
  const without = (...labels: string[]) => Object.fromEntries(Object.entries(TEMPLATES).filter(([name]) => !labels.includes(name)));
  assert.equal(missionTimeText({ declineTime: -1n, expirationTime: null }, without(MISSION_TIME_LABELS.declineGeneric)), null);
  assert.equal(missionTimeText({ declineTime: HOUR, expirationTime: null }, without(MISSION_TIME_LABELS.declineTimeLeft)), null);
  // The interval's own words missing: no half sentence.
  assert.equal(missionTimeText({ declineTime: HOUR, expirationTime: null }, without(INTERVAL_LABELS.part("hour"))), null);
  assert.equal(missionTimeText({ declineTime: null, expirationTime: HOUR }, without(MISSION_TIME_LABELS.expiresAt)), null);
  assert.equal(missionTimeText({ declineTime: -1n, expirationTime: null }, {}), null);
});

test("the labels are the client's", () => {
  assert.deepEqual(MISSION_TIME_LABELS, {
    declineGeneric: "UI/Agents/StandardMission/DeclineMessageGeneric",
    declineTimeLeft: "UI/Agents/StandardMission/DeclineMessageTimeLeft",
    expiresAt: "UI/Agents/Dialogue/ThisMissionExpiresAt",
  });
  assert.deepEqual([...MISSION_TIME_WORD_LABELS].sort(), Object.values(MISSION_TIME_LABELS).sort());
});

test("the window shows a mission's time unless the agent said not yet or offers a special interaction", () => {
  const talk = (info: Partial<AgentConversation["lastActionInfo"]> = {}, special?: boolean): AgentConversation => ({
    agentSays: "",
    agentSaysWords: null,
    contentID: 2156,
    actions: [],
    ...(special === undefined ? {} : { specialInteractions: special }),
    lastActionInfo: { missionCompleted: null, missionDeclined: null, missionQuit: null, loyaltyPoints: null, ...info },
  });
  assert.equal(missionTimeShown(talk()), true);
  assert.equal(missionTimeShown(talk({}, false)), true);
  // Whatever the last action was: the line goes with what the agent says, not with the objectives.
  assert.equal(missionTimeShown(talk({ missionCompleted: true, missionDeclined: true, missionQuit: true })), true);
  assert.equal(missionTimeShown(talk({ missionCantReplay: 0 })), true);
  assert.equal(missionTimeShown(talk({ missionCantReplay: null })), true);
  // "Not yet": the replay timer's place.
  assert.equal(missionTimeShown(talk({ missionCantReplay: 36_000_000_000 })), false);
  // A special interaction's place.
  assert.equal(missionTimeShown(talk({}, true)), false);
  // No window.
  assert.equal(missionTimeShown(null), false);
});
