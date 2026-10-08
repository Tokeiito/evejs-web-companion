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
      text = value === null ? "" : formatInterval(value);
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
