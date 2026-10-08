// A mission's line in the journal, as the retail client's journal words it.
//
// The table below is not written from the client's source. It is what the
// client's own compiled function gave (agentUtil.GetMissionExpirationAndStateText,
// taken out of the client's code archive and run in the client's own Python
// with stand-ins for the clock and the label lookup) for each of these
// expiries, at a "now" of 134000000000000000, for states 0 to 5 and 7. The
// decompiled source reads otherwise: its second half is printed one level too
// shallow.
//
// The templates are made up, with the tags the client's own texts carry for
// these labels (scripts/client-words.js shows them).

import test from "node:test";
import assert from "node:assert/strict";

import { IMPORTANT_MISSION, filetimeOf, journalRowAsks, journalRowText, journalRowWords, journalStateWords } from "./journalWords.ts";
import { questionText, wordsLabels } from "./questions.ts";
import type { JournalMission, QuestionWords } from "../store/types.ts";

const NOW = 134000000000000000n;
const SECOND = 10_000_000n;
const MINUTE = 60n * SECOND;
const HOUR = 60n * MINUTE;
const DAY = 24n * HOUR;
const WEEK = 7n * DAY;
const FOLDER = "UI/Journal/JournalWindow/Agents/";

/** [what, the expiry the server sent, the label's ending, the time the label is given, whether it has expired] */
const MEASURED: Array<[string, string | null, string, bigint | null, boolean]> = [
  ["8 days", String(NOW + 8n * DAY), "ExpiresAt", NOW + 8n * DAY, false],
  ["a week and 2 minutes", String(NOW + WEEK + 2n * MINUTE), "ExpiresAt", NOW + WEEK + 2n * MINUTE, false],
  ["a week and 30 seconds", String(NOW + WEEK + 30n * SECOND), "ExpiresAtExact", NOW + WEEK + 30n * SECOND, false],
  ["2 days", String(NOW + 2n * DAY), "ExpiresAtExact", NOW + 2n * DAY, false],
  ["a day and a second", String(NOW + DAY + SECOND), "ExpiresAtExact", NOW + DAY + SECOND, false],
  // The time left, cut down to whole minutes.
  ["5 hours 30 seconds", String(NOW + 5n * HOUR + 30n * SECOND), "ExpiresIn", 5n * HOUR, false],
  ["90 seconds", String(NOW + 90n * SECOND), "ExpiresIn", MINUTE, false],
  // Under a minute left reads as never expiring. That is the client's own answer.
  ["30 seconds", String(NOW + 30n * SECOND), "DoesNotExpire", null, false],
  ["now", String(NOW), "DoesNotExpire", null, false],
  // Half a minute ago is already a minute ago: the client's division rounds down.
  ["30 seconds ago", String(NOW - 30n * SECOND), "Expired", null, true],
  ["90 seconds ago", String(NOW - 90n * SECOND), "Expired", null, true],
  ["an hour ago", String(NOW - HOUR), "Expired", null, true],
  ["zero", "0", "DoesNotExpire", null, false],
  ["None", null, "UndefinedExpiration", null, false],
  // The edges, measured the same way (for states 1 and 2; 0 and 3 go the same road).
  ["exactly a week and a minute", String(NOW + WEEK + MINUTE), "ExpiresAtExact", NOW + WEEK + MINUTE, false],
  ["a week, a minute and a second", String(NOW + WEEK + MINUTE + SECOND), "ExpiresAt", NOW + WEEK + MINUTE + SECOND, false],
  ["exactly a day", String(NOW + DAY), "ExpiresIn", DAY, false],
  ["exactly a minute", String(NOW + MINUTE), "ExpiresIn", MINUTE, false],
  ["59 seconds", String(NOW + 59n * SECOND), "DoesNotExpire", null, false],
  ["exactly a minute ago", String(NOW - MINUTE), "Expired", null, true],
  ["a tick ago", String(NOW - 1n), "Expired", null, true],
];
const STATES: Array<[number, string, string]> = [[0, "Offer", "StateOffered"], [1, "Offer", "StateOffered"], [2, "Mission", "StateAccepted"], [3, "Mission", "StateFailed"]];

test("the state and the expiry are the labels the client's own function chooses", () => {
  for (const [missionState, kind, stateLabel] of STATES) {
    for (const [what, expiry, ending, time, expired] of MEASURED) {
      const words = journalStateWords(missionState, expiry, NOW);
      const where = `state ${missionState}, ${what}`;
      assert.equal(words.expired, expired, where);
      assert.deepEqual(words.state, { label: `${FOLDER}${expired ? `State${kind}Expired` : stateLabel}`, parameters: null, text: null }, where);
      assert.deepEqual(words.expiration, {
        label: `${FOLDER}${kind}${ending}`,
        parameters: time === null ? null : { type: "dict", entries: [["expirationTime", { type: "long", value: String(time) }]] },
        text: null,
      }, where);
    }
  }
});

test("a mission in any other state, or in none, has no state and no expiry to show", () => {
  for (const missionState of [4, 5, 6, 7, 99, -1, null]) {
    for (const [, expiry] of MEASURED) {
      assert.deepEqual(journalStateWords(missionState, expiry, NOW), { state: null, expiration: null, expired: false }, String(missionState));
    }
  }
});

test("an expiry that is not a whole number of ticks is no time at all", () => {
  for (const odd of ["", "soon", "1.5", "0x10"]) {
    assert.equal(journalStateWords(1, odd, NOW).expiration?.label, `${FOLDER}OfferUndefinedExpiration`, odd);
  }
});

test("the server's clock is counted in 100 ns ticks since 1601", () => {
  assert.equal(filetimeOf(0), 116444736000000000n);
  assert.equal(filetimeOf(Date.UTC(2026, 9, 8, 13, 47, 46)), (BigInt(Date.UTC(2026, 9, 8, 13, 47, 46)) + 11644473600000n) * 10000n);
  assert.equal(filetimeOf(1.9), 116444736000010000n);
});

const mission = (more: Partial<JournalMission> = {}): JournalMission => ({
  missionState: 1,
  missionTypeLabel: "UI/Agents/MissionTypes/Courier",
  missionTitleID: 58607,
  agentID: 3008416,
  missionID: 2156,
  expirationTime: String(NOW + 5n * HOUR),
  ...more,
});

test("a journal line's name is the mission's message, or the text sent in its place; its type is the label", () => {
  const row = journalRowWords(mission(), NOW);
  assert.deepEqual(row.name, { label: null, parameters: null, text: null, messageID: 58607 });
  assert.deepEqual(row.type, { label: "UI/Agents/MissionTypes/Courier", parameters: null, text: null });
  assert.equal(row.important, false);
  assert.equal(row.state?.label, `${FOLDER}StateOffered`);
  assert.equal(row.expiration?.label, `${FOLDER}OfferExpiresIn`);

  assert.deepEqual(journalRowWords(mission({ missionTitle: "A name as text", missionTitleID: null }), NOW).name, { label: null, parameters: null, text: "A name as text" });
  // Text wins over a number; an empty text is no text.
  assert.equal(journalRowWords(mission({ missionTitle: "As text" }), NOW).name?.text, "As text");
  assert.equal(journalRowWords(mission({ missionTitle: "" }), NOW).name?.messageID, 58607);
  for (const missionTitleID of [null, 0, -5]) {
    assert.equal(journalRowWords(mission({ missionTitleID }), NOW).name, null, String(missionTitleID));
  }
  for (const missionTypeLabel of [null, ""]) {
    assert.equal(journalRowWords(mission({ missionTypeLabel }), NOW).type, null);
  }
  assert.equal(journalRowWords(mission({ importantMission: true }), NOW).important, true);
});

test("a journal line asks for the client's text of each of its words, and of the important label only when it is used", () => {
  const keys = (row: ReturnType<typeof journalRowWords>) => wordsLabels(journalRowAsks(row));
  assert.deepEqual(keys(journalRowWords(mission(), NOW)), [`${FOLDER}StateOffered`, "#58607", "UI/Agents/MissionTypes/Courier", `${FOLDER}OfferExpiresIn`]);
  assert.deepEqual(keys(journalRowWords(mission({ importantMission: true }), NOW)), [`${FOLDER}StateOffered`, "#58607", "UI/Agents/MissionTypes/Courier", `${FOLDER}OfferExpiresIn`, IMPORTANT_MISSION]);
  // Nothing to mark important without a type; a name sent as text needs no asking; a finished mission asks for nothing but its name and type.
  assert.deepEqual(keys(journalRowWords(mission({ importantMission: true, missionTypeLabel: null }), NOW)), [`${FOLDER}StateOffered`, "#58607", `${FOLDER}OfferExpiresIn`]);
  assert.deepEqual(keys(journalRowWords(mission({ missionTitle: "As text" }), NOW)), [`${FOLDER}StateOffered`, "UI/Agents/MissionTypes/Courier", `${FOLDER}OfferExpiresIn`]);
  assert.deepEqual(keys(journalRowWords(mission({ missionState: 4 }), NOW)), ["#58607", "UI/Agents/MissionTypes/Courier"]);
});

// Made up, with the client's tags for these labels.
const TEMPLATES: Record<string, string | null> = {
  [`${FOLDER}StateOffered`]: "On offer",
  [`${FOLDER}StateAccepted`]: "Taken",
  [`${FOLDER}OfferExpiresIn`]: "Goes in {[timeinterval]expirationTime.shortWrittenForm}",
  [`${FOLDER}MissionExpiresAt`]: "Ends on {[datetime]expirationTime, date=short, time=none}",
  [`${FOLDER}MissionExpiresAtExact`]: "Ends at {[datetime]expirationTime, date=short, time=short}",
  [IMPORTANT_MISSION]: "Weighty {missionType}",
  "UI/Agents/MissionTypes/Courier": "Carrying",
  "#58607": "A Made-Up Errand",
};
const names = (kind: string, id: number): string => `${kind} ${id}`;
const withClient = (templates: Record<string, string | null>) => ({
  say: (words: QuestionWords) => questionText(words, names, { templates }),
  has: (key: string) => typeof templates[key] === "string",
});
const text = (row: ReturnType<typeof journalRowWords>, templates: Record<string, string | null>) => {
  const { say, has } = withClient(templates);
  return journalRowText(row, say, has);
};

test("with the client's text a journal line is the client's state, name, type and expiry", () => {
  assert.deepEqual(text(journalRowWords(mission(), NOW), TEMPLATES), { state: "On offer", name: "A Made-Up Errand", type: "Carrying", expiration: "Goes in 5h" });
  // The type's own text is what the important label is filled with.
  assert.equal(text(journalRowWords(mission({ importantMission: true }), NOW), TEMPLATES).type, "Weighty Carrying");
  // A time more than a week off is a date, one more than a day off a date and a time, in the game's clock.
  const when = filetimeOf(Date.UTC(2026, 9, 20, 15, 30));
  const from = (days: bigint) => when - days * DAY;
  assert.deepEqual(text(journalRowWords(mission({ missionState: 2, expirationTime: String(when) }), from(9n)), TEMPLATES), { state: "Taken", name: "A Made-Up Errand", type: "Carrying", expiration: "Ends on 2026.10.20" });
  assert.equal(text(journalRowWords(mission({ missionState: 2, expirationTime: String(when) }), from(2n)), TEMPLATES).expiration, "Ends at 2026.10.20 15:30");
  // A name the server sent as text is shown as it is.
  assert.equal(text(journalRowWords(mission({ missionTitle: "As text" }), NOW), TEMPLATES).name, "As text");
});

test("without the client's text the line is in this client's words: no bare number for a name, the label's last part for a type", () => {
  const none: Array<Record<string, string | null>> = [{}, { "#58607": null, "UI/Agents/MissionTypes/Courier": null, [`${FOLDER}StateOffered`]: null, [`${FOLDER}OfferExpiresIn`]: null }];
  for (const templates of none) {
    assert.deepEqual(text(journalRowWords(mission(), NOW), templates), { state: "Offered", name: "", type: "Courier", expiration: "open for another 5h" });
  }
  assert.equal(text(journalRowWords(mission({ importantMission: true }), NOW), {}).type, "Courier (important)");
  assert.equal(text(journalRowWords(mission({ missionTitle: "As text" }), NOW), {}).name, "As text");
  // No type at all is no type, important or not; another state is no state and no expiry.
  assert.equal(text(journalRowWords(mission({ importantMission: true, missionTypeLabel: null }), NOW), TEMPLATES).type, "");
  assert.deepEqual(text(journalRowWords(mission({ missionState: 4 }), NOW), {}), { state: "", name: "", type: "Courier", expiration: "" });
  // The client's name without the client's type, and the other way about.
  assert.deepEqual(text(journalRowWords(mission(), NOW), { "#58607": "A Made-Up Errand" }), { state: "Offered", name: "A Made-Up Errand", type: "Courier", expiration: "open for another 5h" });
  assert.equal(text(journalRowWords(mission(), NOW), { "UI/Agents/MissionTypes/Courier": "Carrying" }).name, "");
});

test("every label the journal can choose has this client's own words, so none is shown as a label", () => {
  const when = filetimeOf(Date.UTC(2026, 9, 20, 15, 30));
  const own = (missionState: number, expirationTime: string | null, now: bigint) => {
    const words = journalStateWords(missionState, expirationTime, now);
    return [questionText(words.state as QuestionWords, names), questionText(words.expiration as QuestionWords, names)];
  };
  assert.deepEqual(own(1, String(when), when - 9n * DAY), ["Offered", "open until 2026.10.20"]);
  assert.deepEqual(own(1, String(when), when - 2n * DAY), ["Offered", "open until 2026.10.20 15:30"]);
  assert.deepEqual(own(1, String(when), when - 90n * MINUTE), ["Offered", "open for another 1h 30m"]);
  assert.deepEqual(own(1, "0", when), ["Offered", "open with no end"]);
  assert.deepEqual(own(1, null, when), ["Offered", "no end given"]);
  assert.deepEqual(own(1, String(when), when + HOUR), ["Offer lapsed", "no longer open"]);
  assert.deepEqual(own(2, String(when), when - 9n * DAY), ["Accepted", "due by 2026.10.20"]);
  assert.deepEqual(own(2, String(when), when - 2n * DAY), ["Accepted", "due by 2026.10.20 15:30"]);
  assert.deepEqual(own(2, String(when), when - 90n * MINUTE), ["Accepted", "due in 1h 30m"]);
  assert.deepEqual(own(2, "0", when), ["Accepted", "no deadline"]);
  assert.deepEqual(own(2, null, when), ["Accepted", "no deadline given"]);
  assert.deepEqual(own(2, String(when), when + HOUR), ["Overdue", "past its deadline"]);
  assert.deepEqual(own(3, String(when), when - 90n * MINUTE), ["Failed", "due in 1h 30m"]);
});
