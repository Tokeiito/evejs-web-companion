// The retail client's own words, filled in.
//
// The BFF hands over the client's text for a label as a TEMPLATE (POST
// /api/words; src/clientData/clientWords.js): the text with its parameters
// still in it, written the way the client's localisation writes them
// (localization/parser.py, _Tokenize):
//
//   {name}                                  a value as it is
//   {[type]name}                            a value of a kind
//   {[type]name.property}                   something about it
//   {[type]name.property -> "a", "b"}       one of several words, chosen by it
//   {[type]name, modifier, key=value}       with modifiers and settings
//
// The kinds are the client's: generic, character, npcOrganization, item,
// location, characterlist, messageid, datetime, formattedtime, timeinterval,
// numeric. The modifiers: capitalize, uppercase, lowercase, titlecase,
// linkify, useGrouping.
//
// ⚠ THE CLIENT RENDERS THESE IN A COMPILED MODULE (eveLocalization) that has
// not been read. What each kind and property comes out as below is this
// client's reading of the game, not a copy of that module: an item, a
// character, an organisation and a place by name; a number plainly, grouped
// only when the template says useGrouping; a time in the game's
// YYYY.MM.DD HH:MM. What it cannot do is said where it is not done.

import type { NameKind, NameRef } from "../store/names.ts";
import type { JsonValue } from "./wire.ts";

export interface TemplateToken {
  /** The whole tag as written, braces and all. */
  readonly raw: string;
  /** The kind, lower case; "generic" when the tag names none. */
  readonly type: string;
  readonly name: string;
  readonly property: string | null;
  /** The words to choose among, for a conditional. */
  readonly conditionals: readonly string[];
  readonly modifiers: readonly string[];
  readonly settings: Readonly<Record<string, string>>;
}

export interface FormatContext {
  /** A name from the page's cache, or a plain stand-in while it is not there. */
  readonly nameOf: (kind: NameKind, id: number) => string;
  /** The character the page is flying: the client's `player` in every message. */
  readonly playerID?: number | null;
  /**
   * An interval of the game's time written out in the client's own words (timeInterval.ts), for a tag
   * that asks for an interval's written form. `from` and `to` are the tag's settings, null where it
   * names none. Without it, or when it answers null, such a tag is written in this page's short form.
   */
  readonly writeInterval?: (ticks: bigint, from: string | null, to: string | null) => string | null;
  /** The same for a tag that asks for an interval's short written form ("6d 8h 57m"). */
  readonly writeShortInterval?: (ticks: bigint, from: string | null, to: string | null) => string | null;
}

/** A message's arguments by name: what the server sent with the label, and what the client adds. */
export type TemplateArguments = Readonly<Record<string, JsonValue | undefined>>;

const TAG = /\{(?!\{)[^{}]*\}/g;
const PIECES = /(""|"[^"]+"|->|[:.,=[\]])/;

/** One tag, read as the client's tokenizer reads it; null when it is not a tag the client would accept. */
export function parseTag(raw: string): TemplateToken | null {
  const tokens = raw.slice(1, -1).split(PIECES).map((token) => token.trim()).filter((token) => token !== "");
  let type = "generic";
  let name = tokens.shift();
  if (name === "[") {
    type = (tokens.shift() ?? "").toLowerCase();
    if (tokens.shift() !== "]") {
      return null;
    }
    name = tokens.shift();
  }
  if (name === undefined || !/^[A-Za-z_]\w*$/.test(name) || type === "") {
    return null;
  }
  let property: string | null = null;
  const conditionals: string[] = [];
  const modifiers: string[] = [];
  const settings: Record<string, string> = {};
  let next = tokens.shift();
  if (next === ".") {
    const named = tokens.shift();
    if (named === undefined || !/^[A-Za-z_]\w*$/.test(named)) {
      return null;
    }
    property = named;
    next = tokens.shift();
  }
  const unquoted = (token: string | undefined): string | null =>
    token !== undefined && /^"[^"]*"$/.test(token) ? token.slice(1, -1) : null;
  if (next === "->") {
    for (;;) {
      const value = unquoted(tokens.shift());
      if (value === null) {
        return null;
      }
      conditionals.push(value);
      const separator = tokens.shift();
      if (separator === undefined) {
        break;
      }
      if (separator !== ",") {
        return null;
      }
    }
  } else if (next === ",") {
    while (tokens.length > 0) {
      const word = tokens.shift() as string;
      const after = tokens.shift();
      if (after === undefined || after === ",") {
        modifiers.push(word);
      } else if (after === "=") {
        const value = tokens.shift();
        if (value === undefined) {
          return null;
        }
        settings[word] = unquoted(value) ?? value;
        const separator = tokens.shift();
        if (separator !== undefined && separator !== ",") {
          return null;
        }
      } else {
        return null;
      }
    }
  } else if (next !== undefined) {
    return null;
  }
  return { raw, type, name, property, conditionals, modifiers, settings };
}

/** A template as text and tags, in order. A brace run the client would not accept stays text. */
export function parseTemplate(template: string): Array<string | TemplateToken> {
  const parts: Array<string | TemplateToken> = [];
  let from = 0;
  for (const match of template.matchAll(TAG)) {
    const at = match.index ?? 0;
    if (at > from) {
      parts.push(template.slice(from, at));
    }
    parts.push(parseTag(match[0]) ?? match[0]);
    from = at + match[0].length;
  }
  if (from < template.length) {
    parts.push(template.slice(from));
  }
  return parts;
}

/** A number the server sent, however the bridge spelled it; null when it is not one. */
function numberOf(value: JsonValue | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, JsonValue>;
    if (record.type === "long" && typeof record.value === "string" && /^-?\d+$/.test(record.value)) {
      return Number(record.value);
    }
  }
  return null;
}

const idOf = (value: JsonValue | undefined): number | null => {
  const number = numberOf(value);
  return number !== null && Number.isSafeInteger(number) && number > 0 ? number : null;
};

/** Which of the page's name kinds a place's ID belongs to, by the game's ID ranges. */
function locationKind(id: number): NameKind {
  if (id >= 10_000_000 && id < 20_000_000) return "region";
  if (id >= 30_000_000 && id < 40_000_000) return "system";
  if (id >= 60_000_000 && id < 64_000_000) return "station";
  return "structure";
}

/** The name kind a tag's value is looked up under, or null when the tag is not a name. */
function nameKindOf(token: TemplateToken, id: number): NameKind | null {
  switch (token.type) {
    case "item": return "type";
    case "character":
    case "npcorganization": return "owner";
    case "location": return locationKind(id);
    default: return null;
  }
}

const two = (value: number): string => String(value).padStart(2, "0");
/** 100 ns ticks since 1601 (the server's clock) to milliseconds since 1970. */
const filetimeToMs = (filetime: number): number => filetime / 10_000 - 11_644_473_600_000;

function formatDateTime(filetime: number, settings: Readonly<Record<string, string>>): string {
  const when = new Date(filetimeToMs(filetime));
  if (Number.isNaN(when.getTime())) {
    return "";
  }
  const date = `${when.getUTCFullYear()}.${two(when.getUTCMonth() + 1)}.${two(when.getUTCDate())}`;
  const time = `${two(when.getUTCHours())}:${two(when.getUTCMinutes())}`;
  if (settings.date === "none") return time;
  if (settings.time === "none") return date;
  return `${date} ${time}`;
}

function formatInterval(ticks: number): string {
  let seconds = Math.max(0, Math.floor(ticks / 10_000_000));
  const parts: string[] = [];
  for (const [unit, size] of [["d", 86_400], ["h", 3_600], ["m", 60]] as const) {
    if (seconds >= size) {
      parts.push(`${Math.floor(seconds / size)}${unit}`);
      seconds %= size;
    }
  }
  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds}s`);
  }
  return parts.join(" ");
}

function formatNumber(value: number, token: TemplateToken): string {
  const places = /^\d+$/.test(token.settings.decimalPlaces ?? "") ? Number(token.settings.decimalPlaces) : null;
  if (token.modifiers.includes("useGrouping")) {
    return value.toLocaleString("en-US", places === null ? {} : { minimumFractionDigits: places, maximumFractionDigits: places });
  }
  return places === null ? String(value) : value.toFixed(places);
}

function applyModifiers(text: string, modifiers: readonly string[]): string {
  let out = text;
  for (const modifier of modifiers) {
    if (modifier === "capitalize") out = out.charAt(0).toUpperCase() + out.slice(1);
    else if (modifier === "uppercase") out = out.toUpperCase();
    else if (modifier === "lowercase") out = out.toLowerCase();
    else if (modifier === "titlecase") out = out.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
  }
  return out;
}

const withArticle = (name: string): string => `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name}`;

function renderToken(token: TemplateToken, args: TemplateArguments, context: FormatContext): string {
  const given = args[token.name] ?? (token.name === "player" ? context.playerID ?? undefined : undefined);
  if (given === undefined || given === null) {
    // The client logs a missing argument and shows nothing for it.
    return "";
  }
  if (token.conditionals.length > 0) {
    // A word chosen by a count ("item", "items"): one takes the first, any other the last. A word chosen by
    // gender is not chosen here (the page does not know anyone's): the first is taken.
    const count = token.property === "quantity" || token.type === "numeric" ? numberOf(given) : null;
    return count === null || count === 1 ? token.conditionals[0] ?? "" : token.conditionals[token.conditionals.length - 1] ?? "";
  }
  let text: string;
  switch (token.type) {
    case "numeric": {
      const value = numberOf(given);
      text = value === null ? "" : formatNumber(value, token);
      break;
    }
    case "item":
    case "character":
    case "npcorganization":
    case "location": {
      const id = idOf(given);
      const kind = id === null ? null : nameKindOf(token, id);
      const name = id === null || kind === null ? "" : context.nameOf(kind, id);
      text = token.property === "nameWithArticle" && name !== "" ? withArticle(name) : name;
      break;
    }
    case "datetime":
    case "formattedtime": {
      const value = numberOf(given);
      text = value === null ? "" : formatDateTime(value, token.settings);
      break;
    }
    case "timeinterval": {
      const value = numberOf(given);
      // timeIntervalPropertyHandler: writtenForm is FormatTimeIntervalWritten and shortWrittenForm is
      // FormatTimeIntervalShortWritten, from and to as the tag sets them.
      const writer = token.property === "writtenForm" ? context.writeInterval : token.property === "shortWrittenForm" ? context.writeShortInterval : undefined;
      const written = value !== null && writer ? writer(BigInt(Math.trunc(value)), token.settings.from ?? null, token.settings.to ?? null) : null;
      text = value === null ? "" : written ?? formatInterval(value);
      break;
    }
    case "generic": {
      const value = numberOf(given);
      text = typeof given === "string" ? given : value === null ? "" : String(value);
      break;
    }
    default:
      // characterlist and messageid: a list of names and a message inside a message are not done.
      text = "";
  }
  return applyModifiers(text, token.modifiers);
}

/** A template with its tags filled from `args`. Tags the client would not accept are left as written. */
export function formatTemplate(template: string, args: TemplateArguments, context: FormatContext): string {
  return parseTemplate(template)
    .map((part) => (typeof part === "string" ? part : renderToken(part, args, context)))
    .join("");
}

// ── a dialog's typed values ──────────────────────────────────────────────────
//
// A dialog's parameters may be TYPED: a tuple (code, value[, value2]) that the
// client turns into text before it fills the dialog's words (cfg.__prepdict
// and FormatConvert, carbon/common/script/sys/cfg.py 324 and 370; what each
// code means, eveCfg.py 165 on). The codes done here:
//
//     2  UE_OWNERID            an owner's name
//     3  UE_LOCID              a place's name
//     4  UE_TYPEID             a type's name
//    24  UE_TYPEIDANDQUANTITY  (24, typeID, quantity): the client's label
//                              UI/Common/QuantityAndItem, filled with both
//   103  UE_LIST               (103, [entries], separator): each entry
//                              converted, and joined by the separator, or by
//                              the client's list delimiter when there is none
//
// The client has more (dates, amounts, ISK, distances, group names, a message
// inside a message). Those are not done, and come out as nothing.
//
// The bridge keeps a tuple as an array and a list as {type: "list", items},
// and the client tells them apart: FormatConvert reads a tuple given as a
// VALUE as one more typed value, to be converted first. So a list's entries
// have to arrive in a list. (A tuple of entries, which the client cannot word
// at all, is read here as the list it was meant to be.)

/** The label the client words a quantity of an item with (eveCfg.__FormatTypeIDAndQuantity). */
export const QUANTITY_AND_ITEM = "UI/Common/QuantityAndItem";
/** The label of what the client joins a list with when it is given no separator (FormatGenericList). */
export const LIST_DELIMITER = "UI/Common/Formatting/ListGenericDelimiter";

const UE_OWNERID = 2;
const UE_LOCID = 3;
const UE_TYPEID = 4;
const UE_TYPEIDANDQUANTITY = 24;
const UE_LIST = 103;

export interface TypedContext extends FormatContext {
  /** The client's templates by label, for the two the conversion words with. */
  readonly templates?: Readonly<Record<string, string | null | undefined>>;
}

/** A typed value given as a value: a tuple that starts with a code. */
const nestedTyped = (value: JsonValue | undefined): value is JsonValue[] => Array.isArray(value) && typeof value[0] === "number";

/** A list's entries: a list as the bridge spells one, or a tuple of entries. */
function listEntries(value: JsonValue | undefined): readonly JsonValue[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, JsonValue>;
    if (record.type === "list" && Array.isArray(record.items)) {
      return record.items;
    }
  }
  return [];
}

const third = (tuple: readonly JsonValue[]): JsonValue => (tuple.length >= 3 ? tuple[2] ?? null : null);

/** One typed value as the text the client makes of it; nothing for a code that is not done. */
export function convertTyped(code: JsonValue | undefined, value: JsonValue | undefined, value2: JsonValue | undefined, context: TypedContext): string {
  let inner: JsonValue | undefined = value;
  let second: JsonValue | undefined = value2;
  if (nestedTyped(inner)) {
    // The client converts it first, and its third member (or nothing) takes value2's place.
    second = third(inner);
    inner = convertTyped(inner[0], inner[1], second, context);
  }
  switch (code) {
    case UE_OWNERID: {
      const id = idOf(inner);
      return id === null ? "" : context.nameOf("owner", id);
    }
    case UE_LOCID: {
      const id = idOf(inner);
      return id === null ? "" : context.nameOf(locationKind(id), id);
    }
    case UE_TYPEID: {
      const id = idOf(inner);
      return id === null ? "" : context.nameOf("type", id);
    }
    case UE_TYPEIDANDQUANTITY: {
      const typeID = idOf(inner);
      if (typeID === null) {
        return "";
      }
      const quantity = numberOf(second);
      const template = context.templates?.[QUANTITY_AND_ITEM];
      if (typeof template === "string") {
        return formatTemplate(template, { quantity, item: typeID }, context);
      }
      const name = context.nameOf("type", typeID);
      return quantity === null ? name : `${quantity.toLocaleString("en-US")} × ${name}`;
    }
    case UE_LIST: {
      const texts = listEntries(inner).map((entry) => (Array.isArray(entry) ? convertTyped(entry[0], entry[1], third(entry), context) : ""));
      const separator = typeof second === "string" ? second : context.templates?.[LIST_DELIMITER] ?? ", ";
      return texts.join(separator);
    }
    default:
      return "";
  }
}

/** A dialog's arguments as the client prepares them: every tuple among them turned to its text. */
export function prepareArguments(args: TemplateArguments, context: TypedContext): TemplateArguments {
  const out: Record<string, JsonValue | undefined> = {};
  for (const [name, value] of Object.entries(args)) {
    out[name] = Array.isArray(value) ? convertTyped(value[0], value[1], third(value), context) : value;
  }
  return out;
}

/** What a typed value needs before it can be worded: the names, and the client's labels. */
function typedNeeds(tuple: readonly JsonValue[], refs: NameRef[], labels: string[]): void {
  const [code, value] = tuple;
  if (nestedTyped(value)) {
    typedNeeds(value, refs, labels);
    return;
  }
  const id = idOf(value);
  if (code === UE_LIST) {
    for (const entry of listEntries(value)) {
      if (Array.isArray(entry)) {
        typedNeeds(entry, refs, labels);
      }
    }
    if (typeof third(tuple) !== "string") {
      labels.push(LIST_DELIMITER);
    }
  } else if (code === UE_TYPEIDANDQUANTITY) {
    labels.push(QUANTITY_AND_ITEM);
    if (id !== null) refs.push({ kind: "type", id });
  } else if (id !== null && code === UE_TYPEID) {
    refs.push({ kind: "type", id });
  } else if (id !== null && code === UE_OWNERID) {
    refs.push({ kind: "owner", id });
  } else if (id !== null && code === UE_LOCID) {
    refs.push({ kind: locationKind(id), id });
  }
}

/** The names a dialog's typed arguments need, for the page's name cache to fetch. */
export function typedNameRefs(args: TemplateArguments): NameRef[] {
  const refs: NameRef[] = [];
  for (const value of Object.values(args)) {
    if (Array.isArray(value)) {
      typedNeeds(value, refs, []);
    }
  }
  return refs;
}

/** The client's labels a dialog's typed arguments are worded with, each once. */
export function typedLabels(args: TemplateArguments): string[] {
  const labels: string[] = [];
  for (const value of Object.values(args)) {
    if (Array.isArray(value)) {
      typedNeeds(value, [], labels);
    }
  }
  return [...new Set(labels)];
}

/**
 * The client's text as plain text. Its texts carry the client's own markup
 * (`<br>` for a new line; `<b>`, `<color=...>`, `<url=...>` and the like
 * around words), which the client's own text renderer draws. Here a `<br>`
 * is a line break and any other tag is dropped, leaving the words it
 * wrapped. A "<" that does not open a tag is left alone.
 *
 * In what is left, the client's label parser turns four entities into the
 * characters they stand for, in any letter case, and no others (CCP's trinity,
 * Tr2LabelTextParser.cpp, STATE_GT_AMPSTART): `&amp;`, `&lt;`, `&gt;`, and
 * `&nbsp;`, which it writes as an ordinary space. Each is read once: what
 * `&amp;lt;` leaves is `&lt;`.
 */
export function plainText(marked: string): string {
  return marked
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[A-Za-z][^<>]*>/g, "")
    .replace(/&(amp|lt|gt|nbsp);/gi, (_whole, name: string) => LABEL_ENTITIES[name.toLowerCase()]!);
}
const LABEL_ENTITIES: Readonly<Record<string, string>> = Object.freeze({ amp: "&", lt: "<", gt: ">", nbsp: " " });

/** The names a template's tags need for these arguments, for the page's name cache to fetch. */
export function templateNameRefs(template: string, args: TemplateArguments, context: Pick<FormatContext, "playerID"> = {}): NameRef[] {
  const refs: NameRef[] = [];
  for (const part of parseTemplate(template)) {
    if (typeof part === "string" || part.conditionals.length > 0) {
      continue;
    }
    const id = idOf(args[part.name] ?? (part.name === "player" ? context.playerID ?? undefined : undefined));
    const kind = id === null ? null : nameKindOf(part, id);
    if (id !== null && kind !== null) {
      refs.push({ kind, id });
    }
  }
  return refs;
}
