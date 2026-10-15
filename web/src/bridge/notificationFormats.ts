// A notification's subject, worded as the retail client words it (item 81, its second and third parts).
//
// The client formats a notification by the formatter its type has, else by notificationUtil's table
// (notificationSvc.py FormatNotifications, 164 to 187). Both are its code: the BFF reads them by running that code
// in the client's own Python (GET /api/client-data/notification-formats; scripts/client-notification-formats.py),
// for each type
//
//   table       the subject's and the body's label, and the name of the function that adds to the data, or the
//               name of the function that words the notification whole (notificationUtil.Format, 1506 to 1542:
//               GetByLabel(subject, **data), the data given notification_senderID, _receiverID and _created);
//   formatters  the formatter's name, and the labels its class is made with (notificationFormatMapping.py);
//   described   what the function makes of a notification, found by running it on stand-in data: each parameter
//               it adds, or the subject and body it words, as a description (a data value, an owner's name by its
//               link, a label's words with their parameters, ...), and null for a part that turns on the data's
//               values or that the script cannot follow.
//
// The page words a subject only where it can be sure of it: every word its template asks for must come from the
// data, the three notification fields, or a described parameter the page can evaluate (an owner's, a place's or a
// type's name, a label's words, a value). An amount of ISK, a date and a message by its number are not worded here
// yet. The contacts' subjects come from their own formatters (contactNotifications.ts). Anything else is null, and
// the page says it its own way.

import { formatTemplate, parseTemplate, plainText, type FormatContext, type TemplateArguments } from "./clientWords.ts";
import { CONTACT_NOTIFICATION_TYPE, formatContactNotification } from "./contactNotifications.ts";
import type { Notification } from "./notifications.ts";
import type { NameKind, NameRef } from "../store/names.ts";
import { readDictPairs, type JsonValue } from "./wire.ts";

/** What the script describes a part as: a plain object of its own shape (see the head of this file). */
export type Described = Readonly<Record<string, unknown>>;

export interface NotificationTableEntry {
  readonly subject: string | null;
  readonly body: string | null;
  /** The function that adds to the data, by its name; null where there is none. */
  readonly parameters: string | null;
  /** The function that words the notification whole, by its name; null where the labels do. */
  readonly function: string | null;
  /** What the parameter function adds, by name (null for one not described), or what the function words, as subject and body. */
  readonly described: Readonly<Record<string, Described | null>> | null;
}

export interface NotificationFormatter {
  readonly name: string | null;
  readonly subject: string | null;
  readonly body: string | null;
  /** The subject and body its Format words, described; null where it could not be followed. */
  readonly described: Readonly<Record<string, Described | null>> | null;
}

/** The client's notification formats, by type (the BFF's answer). */
export interface NotificationFormats {
  readonly table: Readonly<Record<string, NotificationTableEntry>>;
  readonly formatters: Readonly<Record<string, NotificationFormatter>>;
}

const textOrNull = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const isObject = (each: unknown): each is Record<string, unknown> => typeof each === "object" && each !== null && !Array.isArray(each);
const describedOf = (value: unknown): Readonly<Record<string, Described | null>> | null => {
  if (!isObject(value)) return null;
  return Object.fromEntries(Object.entries(value).map(([key, each]) => [key, isObject(each) ? each : null]));
};

/** The BFF's answer as the formats, or null for anything that is not them. */
export function decodeNotificationFormats(value: unknown): NotificationFormats | null {
  if (!isObject(value) || !isObject(value.table) || !isObject(value.formatters)) return null;
  const table: Record<string, NotificationTableEntry> = {};
  for (const [key, entry] of Object.entries(value.table)) {
    if (!isObject(entry)) continue;
    table[key] = { subject: textOrNull(entry.subject), body: textOrNull(entry.body), parameters: textOrNull(entry.parameters), function: textOrNull(entry.function), described: describedOf(entry.described) };
  }
  const formatters: Record<string, NotificationFormatter> = {};
  for (const [key, entry] of Object.entries(value.formatters)) {
    if (!isObject(entry)) continue;
    formatters[key] = { name: textOrNull(entry.name), subject: textOrNull(entry.subject), body: textOrNull(entry.body), described: describedOf(entry.described) };
  }
  return { table, formatters };
}

/** A notification's data as arguments by name, where it is a dict; none where it is not (a YAML text not read here). */
function dataArguments(data: JsonValue | null): Record<string, JsonValue> {
  if (data === null || typeof data !== "object" || Array.isArray(data) || (data as { type?: unknown }).type !== "dict") return {};
  const keyOf = (key: unknown): string => (typeof key === "string" ? key : key && typeof key === "object" && "value" in key ? String((key as { value: unknown }).value) : String(key));
  return Object.fromEntries(readDictPairs(data).map(([key, value]) => [keyOf(key), value]));
}

/** What notificationUtil.Format gives GetByLabel: the data, and the notification's sender, receiver and making. */
export function notificationArguments(notification: Notification): TemplateArguments {
  return {
    ...dataArguments(notification.data),
    notification_senderID: notification.senderID,
    notification_receiverID: notification.receiverID,
    notification_created: notification.created === null ? null : { type: "long", value: notification.created.toString() },
  };
}

type Templates = Readonly<Record<string, string | null | undefined>>;
interface Context {
  readonly args: TemplateArguments;
  readonly templates: Templates;
  readonly nameOf: FormatContext["nameOf"];
  /** The labels and the names the descriptions asked for, gathered as they are evaluated. */
  readonly labels: Set<string>;
  readonly refs: NameRef[];
}

/** A whole number off a value as the wire has it; null for anything else. */
function wholeOf(value: JsonValue | undefined): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (value && typeof value === "object" && !Array.isArray(value) && (value as { type?: unknown }).type === "long") {
    const number = Number((value as { value?: unknown }).value);
    return Number.isSafeInteger(number) ? number : null;
  }
  return null;
}

/** A place's name kind by its number (idCheckers): a region, a system, a station, else a structure; none for a constellation, whose name the page does not look up. */
function locationKind(id: number): NameKind | null {
  if (id >= 10_000_000 && id < 20_000_000) return "region";
  if (id >= 20_000_000 && id < 30_000_000) return null;
  if (id >= 30_000_000 && id < 40_000_000) return "system";
  if (id >= 60_000_000 && id < 64_000_000) return "station";
  return "structure";
}

/** A name, asked for where it is not known yet; undefined until it is. */
function named(kind: NameKind, id: number | null, context: Context): string | undefined {
  if (id === null || id <= 0) return undefined;
  context.refs.push({ kind, id });
  const name = context.nameOf(kind, id);
  return name === "" ? undefined : name;
}

/** A description evaluated to the value the client would have put in its place; undefined where the page cannot. */
function evaluate(described: Described | null | undefined, context: Context): JsonValue | undefined {
  if (!described) return undefined;
  if (Array.isArray(described.data)) {
    let value: JsonValue | undefined = context.args[String(described.data[0])];
    for (const index of described.data.slice(1)) {
      const items = Array.isArray(value) ? value : value && typeof value === "object" && (value as { type?: unknown }).type === "list" ? (value as { items?: JsonValue[] }).items : undefined;
      value = typeof index === "number" && items ? items[index] : undefined;
    }
    return value;
  }
  if ("value" in described) return described.value as JsonValue;
  if (Array.isArray(described.list)) {
    const items = described.list.map((each) => evaluate(isObject(each) ? each : null, context));
    return items.some((each) => each === undefined) ? undefined : (items as JsonValue[]);
  }
  const part = (key: string): Described | null => (isObject(described[key]) ? (described[key] as Described) : null);
  switch (described.kind) {
    case "link":
    case "ownerName":
      return named("owner", wholeOf(evaluate(part("id"), context)), context);
    case "location":
    case "locationName": {
      const id = wholeOf(evaluate(part("id"), context));
      const kind = id === null ? null : locationKind(id);
      return kind === null ? undefined : named(kind, id, context);
    }
    case "type":
      return named("type", wholeOf(evaluate(part("typeID"), context)), context);
    case "showinfo": {
      const name = evaluate(part("name"), context);
      return typeof name === "string" ? name : undefined;
    }
    case "label":
      // Its parameters as described, over the notification's data: the client's functions mostly give a label the
      // whole of the data (GetByLabel(label, **notification.data)), which a description holds only the added part of.
      return typeof described.label === "string" && isObject(described.params) ? worded(described.label, described.params, context.args, context) : undefined;
    case "isk":
      return iskWorded(evaluate(part("amount"), context), argument(described, 0, "showFractionsAlways", context), context);
    case "date":
      return dateWorded(evaluate(part("when"), context), argument(described, 0, "fmt", context, "format"), context);
    case "message": {
      const messageID = wholeOf(evaluate(part("messageID"), context));
      if (messageID === null) return undefined;
      context.labels.add(`#${messageID}`);
      const words = context.templates[`#${messageID}`];
      return typeof words === "string" ? words : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * An optional argument of a recorded call: by its name among the keywords, else the one at `place` after those the
 * recorder named (`more`), else, where the recorder named it, that; undefined where it was not given.
 */
function argument(described: Described, place: number, keyword: string, context: Context, named?: string): JsonValue | undefined {
  const keywords = isObject(described.keywords) ? described.keywords : null;
  if (keywords !== null && isObject(keywords[keyword])) return evaluate(keywords[keyword] as Described, context);
  if (named !== undefined && isObject(described[named])) return evaluate(described[named] as Described, context);
  const more = Array.isArray(described.more) ? described.more : [];
  return isObject(more[place]) ? evaluate(more[place] as Described, context) : undefined;
}

/** A number off a value as the wire has it (a long, a real, a number); null for anything else. */
function amountOf(value: JsonValue | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const inner = (value as { value?: unknown }).value;
    const number = typeof inner === "number" ? inner : typeof inner === "string" ? Number(inner) : Number.NaN;
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

/**
 * eveFormat.FmtISK (24 to 25) by FmtCurrency (63 to 73): the label of ISK with or without fractions
 * (CURRENCY_FORMAT_TRANSLATIONS: UI/Util/FmtIsk, UI/Util/FmtIskNoDecimal), the amount rounded half away from
 * nought where without (int(round(amount))).
 */
function iskWorded(amount: JsonValue | undefined, showFractionsAlways: JsonValue | undefined, context: Context): string | undefined {
  const number = amountOf(amount);
  if (number === null) return undefined;
  const fractions = showFractionsAlways === undefined ? true : Boolean(amountOf(showFractionsAlways) ?? showFractionsAlways);
  const shown = fractions ? number : Math.sign(number) * Math.round(Math.abs(number));
  return worded(fractions ? "UI/Util/FmtIsk" : "UI/Util/FmtIskNoDecimal", {}, { amount: shown }, context);
}

/** The client's clock: 100 ns ticks. appConst.YEAR365 * 199, below which FmtDate takes the value for a length of time. */
const YEAR_1800 = 365n * 24n * 3600n * 10_000_000n * 199n;
/** carbon's format.FmtDate (71 to 114): the label for each format, by its two letters. */
const DATE_LABELS: Readonly<Record<string, string>> = {
  ll: "/Carbon/UI/Common/DateTime/SimpleDateUTC", sl: "/Carbon/UI/Common/DateTime/SimpleDateUTC", xs: "/Carbon/UI/Common/DateTime/SimpleDateUTC",
  ls: "/Carbon/UI/Common/DateTime/DateLongShort", ss: "/Carbon/UI/Common/DateTime/DateLongShort",
  ln: "/Carbon/UI/Common/DateTime/DateLongNone", sn: "/Carbon/UI/Common/DateTime/DateLongNone", xn: "/Carbon/UI/Common/DateTime/DateLongNone",
  nl: "/Carbon/UI/Common/DateTime/Time",
  ns: "/Carbon/UI/Common/DateTime/HoursAndMinutes",
  xl: "/Carbon/UI/Common/DateTime/SimpleDateUTC",
  el: "/Carbon/UI/Common/DateTime/DateExtendedLong",
  es: "/Carbon/UI/Common/DateTime/DateExtendedShort",
  en: "/Carbon/UI/Common/DateTime/DateExtendedNone",
};

/**
 * FmtDate(date, fmt='ll'): a time as the label of its format words it (datetime=date); undefined for a length of
 * time (below the year 1800), which the client words otherwise, and for a format it would refuse.
 */
function dateWorded(when: JsonValue | undefined, format: JsonValue | undefined, context: Context): string | undefined {
  const ticks = typeof when === "number" && Number.isSafeInteger(when) ? BigInt(when) : when && typeof when === "object" && !Array.isArray(when) && /^-?\d+$/.test(String((when as { value?: unknown }).value)) ? BigInt(String((when as { value?: unknown }).value)) : null;
  if (ticks === null) return undefined;
  const fmt = format === undefined ? "ll" : typeof format === "string" ? (format === "nn" ? "ll" : format) : null;
  if (fmt === null) return undefined;
  const magnitude = ticks < 0n ? -ticks : ticks;
  if (magnitude < YEAR_1800) return undefined;
  const label = DATE_LABELS[fmt];
  return label === undefined ? undefined : worded(label, {}, { datetime: { type: "long", value: magnitude.toString() } }, context);
}

/**
 * A label's words with its parameters: those described, evaluated, over `given`; undefined where the words are not
 * to hand yet or ask for anything that is not there.
 */
function worded(label: string, described: Readonly<Record<string, unknown>>, given: TemplateArguments, context: Context): string | undefined {
  context.labels.add(label);
  const template = context.templates[label];
  if (typeof template !== "string") return undefined;
  // Only what the words ask for is evaluated (and so only its names asked for); a described part that cannot be
  // evaluated leaves the words unworded, though the data has a value of that name.
  const asked = [...new Set(parseTemplate(template).flatMap((token) => (typeof token === "string" ? [] : [token.name])))];
  const params: Record<string, JsonValue | undefined> = { ...given };
  for (const name of asked) {
    if (Object.hasOwn(described, name)) {
      const each = described[name];
      params[name] = evaluate(isObject(each) ? each : null, context);
    }
  }
  if (asked.some((name) => params[name] === undefined)) return undefined;
  return formatTemplate(template, params, { nameOf: context.nameOf });
}

/** What wording a notification's part asks for, and the part where the page can be sure of it. */
export interface PartWording {
  /** The part as the client's markup; null where the page cannot be sure of it, or what it asks for is not to hand yet. */
  readonly markup: string | null;
  /** The labels whose words it asked for, and the names. */
  readonly labels: readonly string[];
  readonly refs: readonly NameRef[];
}

/** A notification's subject's wording: the subject as plain text, where the page can be sure of it. */
export interface SubjectWording {
  readonly subject: string | null;
  readonly labels: readonly string[];
  readonly refs: readonly NameRef[];
}

/**
 * A notification's subject or body as the client words it (FormatNotifications): by its formatter's described
 * part, by its whole-wording function's, or by the table's label for the part with the data and the described
 * parameters. `templates` are the install's words by label; the labels and names it asks for are returned, to be
 * asked for. The body is the client's markup (line breaks as <br>, links), to be shown as such.
 */
export function notificationWording(notification: Notification, formats: NotificationFormats, templates: Templates, nameOf: FormatContext["nameOf"], part: "subject" | "body"): PartWording {
  const context: Context = { args: notificationArguments(notification), templates, nameOf, labels: new Set(), refs: [] };
  const done = (markup: string | undefined | null): PartWording => ({
    markup: typeof markup === "string" ? markup : null,
    labels: [...context.labels],
    refs: context.refs,
  });
  if (notification.typeID === CONTACT_NOTIFICATION_TYPE.add || notification.typeID === CONTACT_NOTIFICATION_TYPE.edit || notification.typeID === CONTACT_NOTIFICATION_TYPE.buddyAdd) {
    const formatted = formatContactNotification(notification, templates, nameOf);
    return { markup: formatted === null ? null : formatted[part], labels: [], refs: [{ kind: "owner", id: notification.senderID }] };
  }
  const key = String(notification.typeID);
  const formatter = formats.formatters[key];
  if (formatter !== undefined) {
    const described = formatter.described?.[part] ?? null;
    return done(described === null ? null : evaluate(described, context) as string | undefined);
  }
  const entry = formats.table[key];
  if (entry === undefined) return done(null);
  if (entry.function !== null) {
    const described = entry.described?.[part] ?? null;
    return done(described === null ? null : evaluate(described, context) as string | undefined);
  }
  const label = entry[part];
  if (label === null) return done(null);
  // A parameter function not followed may put in anything: the part is sure only where it asks for nothing at all.
  // One followed puts in what it is described as.
  const params: Record<string, Described | null> = entry.parameters !== null && entry.described !== null ? { ...entry.described } : {};
  if (entry.parameters !== null && entry.described === null) {
    context.labels.add(label);
    const template = templates[label];
    if (typeof template !== "string") return done(null);
    const asked = parseTemplate(template).flatMap((token) => (typeof token === "string" ? [] : [token.name]));
    if (asked.length > 0) return done(null);
  }
  // A parameter described as null was not followed: where the part asks for it, it cannot be worded.
  const unknown = new Set(Object.entries(params).filter(([, each]) => each === null).map(([name]) => name));
  const template = templates[label];
  if (typeof template === "string" && parseTemplate(template).some((token) => typeof token !== "string" && unknown.has(token.name))) {
    context.labels.add(label);
    return done(null);
  }
  const known = Object.fromEntries(Object.entries(params).filter(([, each]) => each !== null)) as Record<string, Described>;
  return done(worded(label, known, context.args, context));
}

/** A notification's subject as the client words it, as plain text (notificationWording's subject). */
export function notificationSubjectWording(notification: Notification, formats: NotificationFormats, templates: Templates, nameOf: FormatContext["nameOf"]): SubjectWording {
  const wording = notificationWording(notification, formats, templates, nameOf, "subject");
  return { subject: wording.markup === null ? null : plainText(wording.markup), labels: wording.labels, refs: wording.refs };
}
