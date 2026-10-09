// An interval of time written out, as the retail client writes one.
//
// FmtTimeInterval(interval, breakAt) (carbon/common/script/util/format.py, 39 to 59) is how the client
// says "3 hours and 52 minutes" wherever it has a length of time to say. It works in the game's own
// time, 100 nanoseconds to the tick:
//
//   - under a millisecond it says its phrase for a short amount of time;
//   - otherwise it hands the interval to FormatTimeIntervalWritten, shown from years down to breakAt
//     (localization/formatters/timeIntervalFormatters.py, 67 to 101 and 178 to 215).
//
// That divides the interval greedily: years of 365 days, months of 30, days, hours, minutes, seconds,
// milliseconds, stopping at the last unit shown and dropping what is left over. Each unit that is not
// nought is written with the client's label for it; none at all is its "less than one" of the last
// unit; one stands alone; more are joined with the list delimiter, and the last with the list form's
// "and". (Japanese and Korean join differently; this does the others.)
//
// The labels' text is the client's and is read from its install at run time (the words store). With
// any of the labels an interval needs not to be had, nothing is written and the caller says so.

import { formatTemplate, plainText } from "./clientWords.ts";

/** The game's time: 100 ns ticks (carbon/common/lib/const.py, 186 to 209). */
export const BLUE_TIME = Object.freeze({
  MSEC: 10_000n,
  SEC: 10_000_000n,
  MIN: 600_000_000n,
  HOUR: 36_000_000_000n,
  DAY: 864_000_000_000n,
  MONTH30: 25_920_000_000_000n,
  YEAR365: 315_360_000_000_000n,
});

/** TIME_PART_KEYS: the units an interval is divided into, largest first. There is no week among them. */
export const TIME_PARTS = ["year", "month", "day", "hour", "minute", "second", "millisecond"] as const;
export type TimePart = (typeof TIME_PARTS)[number];

const TICKS: Readonly<Record<TimePart, bigint>> = {
  year: BLUE_TIME.YEAR365,
  month: BLUE_TIME.MONTH30,
  day: BLUE_TIME.DAY,
  hour: BLUE_TIME.HOUR,
  minute: BLUE_TIME.MIN,
  second: BLUE_TIME.SEC,
  millisecond: BLUE_TIME.MSEC,
};

const WRITTEN = "/Carbon/UI/Common/WrittenDateTimeQuantity";
const named = (part: TimePart): string => part[0]!.toUpperCase() + part.slice(1);

export const INTERVAL_LABELS = Object.freeze({
  /** Each takes `units`, and writes the number and the unit's word for that many. */
  part: (part: TimePart): string => `${WRITTEN}/${named(part)}`,
  /** What is written when every unit shown is nought. */
  lessThanOne: (part: TimePart): string => `${WRITTEN}/LessThanOne${named(part)}`,
  /** Takes firstPart and secondPart. */
  listForm: `${WRITTEN}/ListForm`,
  delimiter: "UI/Common/Formatting/ListGenericDelimiter",
  shortAmount: "/Carbon/UI/Common/Formatting/ShortAmountTime",
});

/** Every label an interval may need, for asking the words store. */
export const INTERVAL_WORD_LABELS: readonly string[] = [
  ...TIME_PARTS.map(INTERVAL_LABELS.part),
  ...TIME_PARTS.map(INTERVAL_LABELS.lessThanOne),
  INTERVAL_LABELS.listForm,
  INTERVAL_LABELS.delimiter,
  INTERVAL_LABELS.shortAmount,
];

type Templates = Readonly<Record<string, string | null | undefined>>;

/**
 * _FormatTimeIntervalGetParts: the interval divided greedily over the units from `showFrom` to `showTo`.
 * What is left under the last unit is dropped. Null for what the client refuses: a negative interval, or
 * a last unit larger than the first.
 */
export function intervalParts(value: bigint, showFrom: TimePart, showTo: TimePart): ReadonlyArray<readonly [TimePart, bigint]> | null {
  const from = TIME_PARTS.indexOf(showFrom);
  const to = TIME_PARTS.indexOf(showTo);
  if (value < 0n || to < from) {
    return null;
  }
  let left = value;
  return TIME_PARTS.slice(from, to + 1).map((part) => {
    const count = left / TICKS[part];
    left -= count * TICKS[part];
    return [part, count] as const;
  });
}

/**
 * FormatTimeIntervalWritten(value, showFrom="year", showTo): the interval in the client's words, or null
 * when the client would refuse the interval or its words for it are not to hand.
 */
export function writtenInterval(value: bigint, showTo: TimePart, templates: Templates, showFrom: TimePart = "year"): string | null {
  const parts = intervalParts(value, showFrom, showTo);
  if (parts === null) {
    return null;
  }
  const words = (label: string, args: Record<string, string | number> = {}): string | null => {
    const template = templates[label];
    return typeof template === "string" ? plainText(formatTemplate(template, args, { nameOf: () => "" })) : null;
  };
  const written: string[] = [];
  for (const [part, count] of parts) {
    if (count > 0n) {
      const text = words(INTERVAL_LABELS.part(part), { units: Number(count) });
      if (text === null) {
        return null;
      }
      written.push(text);
    }
  }
  if (written.length === 0) {
    return words(INTERVAL_LABELS.lessThanOne(showTo));
  }
  if (written.length === 1) {
    return written[0]!;
  }
  const delimiter = templates[INTERVAL_LABELS.delimiter];
  if (typeof delimiter !== "string") {
    return null;
  }
  return words(INTERVAL_LABELS.listForm, { firstPart: written.slice(0, -1).join(delimiter), secondPart: written[written.length - 1]! });
}

/**
 * For a label's {[timeinterval]x.writtenForm, from=…, to=…} (timeIntervalPropertyHandler._GetWrittenForm):
 * the interval written from `from` (years, unless the tag says) down to `to` (seconds, unless it says).
 * Null for a unit the client does not have, as for words that are not to hand.
 */
export function intervalWriter(templates: Templates): (ticks: bigint, from: string | null, to: string | null) => string | null {
  const part = (name: string | null, otherwise: TimePart): TimePart | null =>
    name === null ? otherwise : (TIME_PARTS as readonly string[]).includes(name) ? (name as TimePart) : null;
  return (ticks, from, to) => {
    const showFrom = part(from, "year");
    const showTo = part(to, "second");
    return showFrom === null || showTo === null ? null : writtenInterval(ticks, showTo, templates, showFrom);
  };
}

/** How far down FmtTimeInterval writes: its `breakAt`. */
export type BreakAt = "min" | "sec" | "msec";
const BREAK_AT: Readonly<Record<BreakAt, TimePart>> = { min: "minute", sec: "second", msec: "millisecond" };

/**
 * FmtTimeInterval(interval, breakAt): an interval of the game's time in the client's words, or null when
 * its words are not to hand.
 */
export function fmtTimeInterval(interval: bigint, breakAt: BreakAt, templates: Templates): string | null {
  if (interval < BLUE_TIME.MSEC) {
    const short = templates[INTERVAL_LABELS.shortAmount];
    return typeof short === "string" ? plainText(short) : null;
  }
  return writtenInterval(interval, BREAK_AT[breakAt], templates);
}
