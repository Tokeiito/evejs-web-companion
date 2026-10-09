// An interval of time written out as the client writes one. The templates here are made up, in the shape
// the client's are in (a number, then a word chosen by it); the client's own are read from its install.

import test from "node:test";
import assert from "node:assert/strict";

import {
  BLUE_TIME,
  INTERVAL_LABELS,
  INTERVAL_WORD_LABELS,
  TIME_PARTS,
  fmtTimeInterval,
  intervalParts,
  writtenInterval,
} from "./timeInterval.ts";

const { MSEC, SEC, MIN, HOUR, DAY, MONTH30, YEAR365 } = BLUE_TIME;

const SHORT: Record<string, string> = { year: "yr", month: "mth", day: "dy", hour: "hr", minute: "mn", second: "sc", millisecond: "ms" };
const TEMPLATES: Record<string, string> = {
  ...Object.fromEntries(TIME_PARTS.map((part) => [INTERVAL_LABELS.part(part), `{[numeric]units} {[numeric]units-> "${SHORT[part]}", "${SHORT[part]}s"}`])),
  ...Object.fromEntries(TIME_PARTS.map((part) => [INTERVAL_LABELS.lessThanOne(part), `under one ${SHORT[part]}`])),
  [INTERVAL_LABELS.listForm]: "{firstPart} plus {secondPart}",
  [INTERVAL_LABELS.delimiter]: "; ",
  [INTERVAL_LABELS.shortAmount]: "hardly any time",
};

test("the game's units of time, in its 100 ns ticks", () => {
  assert.deepEqual(BLUE_TIME, {
    MSEC: 10_000n,
    SEC: 10_000_000n,
    MIN: 60n * 10_000_000n,
    HOUR: 3600n * 10_000_000n,
    DAY: 86_400n * 10_000_000n,
    MONTH30: 30n * 86_400n * 10_000_000n,
    YEAR365: 365n * 86_400n * 10_000_000n,
  });
  assert.deepEqual([...TIME_PARTS], ["year", "month", "day", "hour", "minute", "second", "millisecond"]);
});

test("an interval is divided greedily over the units shown, and what is left under the last is dropped", () => {
  const value = 2n * YEAR365 + 3n * MONTH30 + 4n * DAY + 5n * HOUR + 6n * MIN + 7n * SEC + 8n * MSEC + 9n;
  assert.deepEqual(intervalParts(value, "year", "millisecond"), [["year", 2n], ["month", 3n], ["day", 4n], ["hour", 5n], ["minute", 6n], ["second", 7n], ["millisecond", 8n]]);
  assert.deepEqual(intervalParts(value, "year", "minute"), [["year", 2n], ["month", 3n], ["day", 4n], ["hour", 5n], ["minute", 6n]]);
  // Shown from days: the years and months are counted in days.
  assert.deepEqual(intervalParts(value, "day", "hour"), [["day", 2n * 365n + 3n * 30n + 4n], ["hour", 5n]]);
  assert.deepEqual(intervalParts(value, "hour", "hour"), [["hour", (2n * 365n + 3n * 30n + 4n) * 24n + 5n]]);
  assert.deepEqual(intervalParts(0n, "hour", "second"), [["hour", 0n], ["minute", 0n], ["second", 0n]]);
  // 59 minutes 59.9999999 seconds is 59 minutes and 59 seconds, not an hour.
  assert.deepEqual(intervalParts(HOUR - 1n, "hour", "second"), [["hour", 0n], ["minute", 59n], ["second", 59n]]);
});

test("what the client refuses to divide is not divided", () => {
  assert.equal(intervalParts(-1n, "year", "second"), null);
  assert.equal(intervalParts(HOUR, "minute", "hour"), null);
});

test("each unit that is not nought is written, the last joined to the rest with the list's and", () => {
  // One unit stands alone, with the word for one or for many.
  assert.equal(writtenInterval(HOUR, "minute", TEMPLATES), "1 hr");
  assert.equal(writtenInterval(3n * HOUR, "minute", TEMPLATES), "3 hrs");
  // Two.
  assert.equal(writtenInterval(3n * HOUR + 52n * MIN, "minute", TEMPLATES), "3 hrs plus 52 mns");
  // More: the list delimiter between all but the last.
  assert.equal(writtenInterval(DAY + 3n * HOUR + MIN, "minute", TEMPLATES), "1 dy; 3 hrs plus 1 mn");
  assert.equal(writtenInterval(2n * YEAR365 + MONTH30 + 4n * DAY + HOUR, "minute", TEMPLATES), "2 yrs; 1 mth; 4 dys plus 1 hr");
  // Noughts in the middle are passed over.
  assert.equal(writtenInterval(2n * DAY + 5n * SEC, "second", TEMPLATES), "2 dys plus 5 scs");
  // What is under the last unit shown is not written.
  assert.equal(writtenInterval(3n * HOUR + 52n * MIN + 30n * SEC, "minute", TEMPLATES), "3 hrs plus 52 mns");
  assert.equal(writtenInterval(3n * HOUR + 52n * MIN + 30n * SEC, "second", TEMPLATES), "3 hrs; 52 mns plus 30 scs");
});

test("nothing to write is the client's less-than-one of the last unit shown", () => {
  assert.equal(writtenInterval(30n * SEC, "minute", TEMPLATES), "under one mn");
  assert.equal(writtenInterval(0n, "second", TEMPLATES), "under one sc");
  assert.equal(writtenInterval(MSEC - 1n, "millisecond", TEMPLATES), "under one ms");
});

test("FmtTimeInterval: under a millisecond is a short amount of time; otherwise years down to where it breaks", () => {
  assert.equal(fmtTimeInterval(MSEC - 1n, "min", TEMPLATES), "hardly any time");
  assert.equal(fmtTimeInterval(0n, "sec", TEMPLATES), "hardly any time");
  assert.equal(fmtTimeInterval(-5n * HOUR, "min", TEMPLATES), "hardly any time");
  assert.equal(fmtTimeInterval(MSEC, "msec", TEMPLATES), "1 ms");
  assert.equal(fmtTimeInterval(MSEC, "sec", TEMPLATES), "under one sc");
  const value = 3n * HOUR + 52n * MIN + 30n * SEC + 250n * MSEC;
  assert.equal(fmtTimeInterval(value, "min", TEMPLATES), "3 hrs plus 52 mns");
  assert.equal(fmtTimeInterval(value, "sec", TEMPLATES), "3 hrs; 52 mns plus 30 scs");
  assert.equal(fmtTimeInterval(value, "msec", TEMPLATES), "3 hrs; 52 mns; 30 scs plus 250 mss");
});

test("with any of the words an interval needs not to hand, nothing is written", () => {
  const without = (label: string) => Object.fromEntries(Object.entries(TEMPLATES).filter(([name]) => name !== label));
  const value = DAY + 3n * HOUR + MIN;
  assert.equal(writtenInterval(value, "minute", without(INTERVAL_LABELS.part("hour"))), null);
  assert.equal(writtenInterval(value, "minute", without(INTERVAL_LABELS.listForm)), null);
  assert.equal(writtenInterval(value, "minute", without(INTERVAL_LABELS.delimiter)), null);
  assert.equal(writtenInterval(30n * SEC, "minute", without(INTERVAL_LABELS.lessThanOne("minute"))), null);
  assert.equal(fmtTimeInterval(1n, "min", without(INTERVAL_LABELS.shortAmount)), null);
  assert.equal(fmtTimeInterval(value, "min", {}), null);
  // A word that is there but null (the client's install has no text for it) is not to hand either.
  assert.equal(writtenInterval(HOUR, "minute", { ...TEMPLATES, [INTERVAL_LABELS.part("hour")]: null }), null);
  // What is not needed is not missed: one unit needs neither the list form nor the delimiter.
  assert.equal(writtenInterval(HOUR, "minute", { [INTERVAL_LABELS.part("hour")]: TEMPLATES[INTERVAL_LABELS.part("hour")] }), "1 hr");
  // Two units need the list form, and the delimiter too, as the client's list formatter asks for it either way.
  assert.equal(writtenInterval(HOUR + MIN, "minute", without(INTERVAL_LABELS.delimiter)), null);
});

test("the labels are the client's, and all of them are asked for", () => {
  assert.equal(INTERVAL_LABELS.part("hour"), "/Carbon/UI/Common/WrittenDateTimeQuantity/Hour");
  assert.equal(INTERVAL_LABELS.part("millisecond"), "/Carbon/UI/Common/WrittenDateTimeQuantity/Millisecond");
  assert.equal(INTERVAL_LABELS.lessThanOne("minute"), "/Carbon/UI/Common/WrittenDateTimeQuantity/LessThanOneMinute");
  assert.equal(INTERVAL_LABELS.listForm, "/Carbon/UI/Common/WrittenDateTimeQuantity/ListForm");
  assert.equal(INTERVAL_LABELS.delimiter, "UI/Common/Formatting/ListGenericDelimiter");
  assert.equal(INTERVAL_LABELS.shortAmount, "/Carbon/UI/Common/Formatting/ShortAmountTime");
  assert.equal(INTERVAL_WORD_LABELS.length, 7 + 7 + 3);
  assert.equal(new Set(INTERVAL_WORD_LABELS).size, INTERVAL_WORD_LABELS.length);
  for (const label of Object.keys(TEMPLATES)) assert.ok(INTERVAL_WORD_LABELS.includes(label), label);
});
