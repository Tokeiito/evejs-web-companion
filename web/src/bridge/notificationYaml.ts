// A notification's data read from the YAML text a notification row carries.
//
// Tranquility's notificationMgr reads answer DBRows whose `data` is the notification's data as YAML text, which the
// client loads (notificationSvc.py TryUnYamlNotificationData, 148 to 156: yaml.load with CSafeLoader); EveJS
// answers them so too (eve.js notificationYaml.js, which writes as the client's own yaml.safe_dump does). This reads
// what such a dump holds, as the client's SafeLoader would:
//
//   block mappings and sequences (a sequence in a mapping at the mapping's indent, "- key: value", "- - item"),
//   plain scalars and their continuation lines, single- and double-quoted scalars with their folding and escapes,
//   empty and simple flow collections ([], {}, [a, b], {a: 1}), anchors and aliases (Tranquility's
//   "structureID: &id001 1054668720660" and "- *id001"), and the YAML 1.1 implicit types SafeLoader resolves
//   (null, booleans with yes/no/on/off, integers with 0x, 0b, a leading 0's octal, underscores and base 60, floats).
//
// The result is shaped as the wire's values are for the rest of the page: a mapping {type: "dict", entries}, a
// sequence {type: "list", items}, an integer past what a number holds exactly {type: "long", value}, other numbers,
// strings, booleans and null as themselves. A timestamp is kept as its text. What this does not read (a block
// literal |, a complex key ?, a tag) makes the whole text unread: null.

import type { JsonValue } from "./wire.ts";

class Unread extends Error {}

const RESOLVERS: readonly (readonly [RegExp, (text: string) => JsonValue])[] = [
  [/^(?:yes|Yes|YES|true|True|TRUE|on|On|ON)$/, () => true],
  [/^(?:no|No|NO|false|False|FALSE|off|Off|OFF)$/, () => false],
  [/^(?:~|null|Null|NULL|)$/, () => null],
  [/^(?:[-+]?0b[0-1_]+|[-+]?0[0-7_]+|[-+]?(?:0|[1-9][0-9_]*)|[-+]?0x[0-9a-fA-F_]+|[-+]?[1-9][0-9_]*(?::[0-5]?[0-9])+)$/, integerOf],
  [/^(?:[-+]?(?:[0-9][0-9_]*)\.[0-9_]*(?:[eE][-+][0-9]+)?|\.[0-9_]+(?:[eE][-+][0-9]+)?|[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/, floatOf],
];

/** SafeConstructor.construct_yaml_int: the sign, then 0b, 0x, a leading 0's octal, base 60, or decimal; underscores dropped. */
function integerOf(text: string): JsonValue {
  let value = text.replace(/_/g, "");
  let sign = 1n;
  if (value.startsWith("-") || value.startsWith("+")) {
    if (value.startsWith("-")) sign = -1n;
    value = value.slice(1);
  }
  let whole: bigint;
  if (value === "0") whole = 0n;
  else if (value.startsWith("0b")) whole = BigInt(`0b${value.slice(2)}`);
  else if (value.startsWith("0x")) whole = BigInt(`0x${value.slice(2)}`);
  else if (value.startsWith("0")) whole = BigInt(`0o${value.slice(1)}`);
  else if (value.includes(":")) whole = value.split(":").reduce((sum, digit) => sum * 60n + BigInt(digit), 0n);
  else whole = BigInt(value);
  const signed = sign * whole;
  return signed >= BigInt(Number.MIN_SAFE_INTEGER) && signed <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(signed) : { type: "long", value: signed.toString() };
}

/** SafeConstructor.construct_yaml_float: underscores dropped, .inf and .nan, base 60. */
function floatOf(text: string): JsonValue {
  const value = text.replace(/_/g, "").toLowerCase();
  const sign = value.startsWith("-") ? -1 : 1;
  const bare = value.replace(/^[-+]/, "");
  if (bare === ".inf") return sign * Infinity;
  if (bare === ".nan") return Number.NaN;
  if (bare.includes(":")) return sign * bare.split(":").reduce((sum, digit) => sum * 60 + Number(digit), 0);
  return sign * Number(bare);
}

/** A plain scalar's value: the first resolver it matches, else the text. */
function resolvePlain(text: string): JsonValue {
  for (const [pattern, construct] of RESOLVERS) {
    if (pattern.test(text)) return construct(text);
  }
  return text;
}

const ESCAPES: Readonly<Record<string, string>> = { "0": "\0", a: "\x07", b: "\b", t: "\t", "\t": "\t", n: "\n", v: "\v", f: "\f", r: "\r", e: "\x1b", " ": " ", '"': '"', "/": "/", "\\": "\\", N: "\x85", _: "\xa0", L: " ", P: " " };
const HEX_ESCAPES: Readonly<Record<string, number>> = { x: 2, u: 4, U: 8 };

class Reader {
  private pos = 0;
  private readonly anchors = new Map<string, JsonValue>();
  private readonly src: string;
  constructor(src: string) {
    this.src = src;
  }

  /** The whole text's one document: its node, or null where it holds none. */
  document(): JsonValue {
    const first = this.nextContent(0);
    if (first === null) return null;
    this.pos = first.content;
    const node = this.blockNode(-1);
    if (this.nextContent(this.pos) !== null) throw new Unread("more than one node");
    return node;
  }

  private column(at = this.pos): number {
    return at - (this.src.lastIndexOf("\n", at - 1) + 1);
  }

  /**
   * The next line from `from` (a line's start, or the end of a line's content) that holds content, past blank lines,
   * comments and the document markers: its indent and where its content starts; null at the end.
   */
  private nextContent(from: number): { indent: number; content: number } | null {
    let at = from;
    // The rest of the line `from` is in, where it is past content already: only spaces and a comment may follow.
    if (at > 0 && this.src[at - 1] !== "\n") {
      while (at < this.src.length && this.src[at] === " ") at += 1;
      if (this.src[at] === "#") while (at < this.src.length && this.src[at] !== "\n") at += 1;
      if (at < this.src.length && this.src[at] !== "\n") throw new Unread("text after a node");
      at += 1;
    }
    while (at < this.src.length) {
      let content = at;
      while (content < this.src.length && this.src[content] === " ") content += 1;
      const end = this.src.indexOf("\n", content) < 0 ? this.src.length : this.src.indexOf("\n", content);
      const rest = this.src.slice(content, end);
      const marker = /^(?:---|\.\.\.)(?:\s|$)/.test(rest) && content === at;
      if (rest === "" || rest.startsWith("#") || marker) {
        if (marker && rest.slice(3).trim() !== "" && !rest.slice(3).trim().startsWith("#")) {
          return { indent: 0, content: at + 4 };
        }
        at = end + 1;
        continue;
      }
      return { indent: content - at, content };
    }
    return null;
  }

  private startsSequenceEntry(at: number): boolean {
    return this.src[at] === "-" && (at + 1 >= this.src.length || this.src[at + 1] === " " || this.src[at + 1] === "\n");
  }

  /** A node whose content starts at pos, inside a parent whose entries stand at `parent`. */
  private blockNode(parent: number): JsonValue {
    const anchor = this.anchorHere();
    let node: JsonValue;
    if (this.src[this.pos] === "*") node = this.alias();
    else if (this.startsSequenceEntry(this.pos)) node = this.sequence(this.column());
    else if (this.src[this.pos] !== "[" && this.src[this.pos] !== "{" && this.keyAhead()) node = this.mapping(this.column());
    else node = this.inline(parent);
    if (anchor !== null) this.anchors.set(anchor, node);
    return node;
  }

  private anchorHere(): string | null {
    if (this.src[this.pos] === "!") throw new Unread("a tag");
    if (this.src[this.pos] !== "&") return null;
    const match = /^&([^\s,[\]{}]+)/.exec(this.src.slice(this.pos));
    if (match === null) throw new Unread("an anchor");
    this.pos += match[0].length;
    while (this.src[this.pos] === " ") this.pos += 1;
    return match[1]!;
  }

  private alias(): JsonValue {
    const match = /^\*([^\s,[\]{}]+)/.exec(this.src.slice(this.pos));
    if (match === null || !this.anchors.has(match[1]!)) throw new Unread("an alias");
    this.pos += match[0].length;
    return this.anchors.get(match[1]!)!;
  }

  /** Whether a mapping's key starts here: a key scalar on this line, then ":" and a space or the line's end. */
  private keyAhead(): boolean {
    const saved = this.pos;
    try {
      this.key();
      return this.src[this.pos] === ":" && (this.pos + 1 >= this.src.length || this.src[this.pos + 1] === " " || this.src[this.pos + 1] === "\n");
    } catch {
      return false;
    } finally {
      this.pos = saved;
    }
  }

  private key(): JsonValue {
    const ch = this.src[this.pos];
    if (ch === "'" || ch === '"') {
      const text = ch === "'" ? this.singleQuoted() : this.doubleQuoted();
      while (this.src[this.pos] === " ") this.pos += 1;
      return text;
    }
    if (ch === "?" && (this.src[this.pos + 1] === " " || this.src[this.pos + 1] === "\n")) throw new Unread("a complex key");
    const start = this.pos;
    while (this.pos < this.src.length && this.src[this.pos] !== "\n") {
      if (this.src[this.pos] === ":" && (this.pos + 1 >= this.src.length || this.src[this.pos + 1] === " " || this.src[this.pos + 1] === "\n")) break;
      if (this.src[this.pos] === "#" && this.src[this.pos - 1] === " ") break;
      this.pos += 1;
    }
    const text = this.src.slice(start, this.pos).trimEnd();
    if (text === "") throw new Unread("an empty key");
    this.pos = start + text.length;
    while (this.src[this.pos] === " ") this.pos += 1;
    return resolvePlain(text);
  }

  /** A block mapping whose keys stand at `indent`, the first at pos. */
  private mapping(indent: number): JsonValue {
    const entries: [JsonValue, JsonValue][] = [];
    for (;;) {
      const key = this.key();
      if (this.src[this.pos] !== ":") throw new Unread("a key without its colon");
      this.pos += 1;
      while (this.src[this.pos] === " ") this.pos += 1;
      let value: JsonValue = null;
      if (this.pos >= this.src.length || this.src[this.pos] === "\n" || this.src[this.pos] === "#") {
        const next = this.nextContent(this.pos);
        if (next !== null && (next.indent > indent || (next.indent === indent && this.startsSequenceEntry(next.content)))) {
          this.pos = next.content;
          value = this.blockNode(indent);
        }
      } else {
        value = this.blockNode(indent);
      }
      entries.push([key, value]);
      const next = this.nextContent(this.pos);
      if (next === null || next.indent !== indent || this.startsSequenceEntry(next.content)) break;
      this.pos = next.content;
    }
    return { type: "dict", entries } as unknown as JsonValue;
  }

  /** A block sequence whose dashes stand at `indent`, the first at pos. */
  private sequence(indent: number): JsonValue {
    const items: JsonValue[] = [];
    for (;;) {
      this.pos += 1;
      while (this.src[this.pos] === " ") this.pos += 1;
      if (this.pos >= this.src.length || this.src[this.pos] === "\n" || this.src[this.pos] === "#") {
        const next = this.nextContent(this.pos);
        if (next !== null && next.indent > indent) {
          this.pos = next.content;
          items.push(this.blockNode(indent));
        } else {
          items.push(null);
        }
      } else {
        items.push(this.blockNode(indent));
      }
      const next = this.nextContent(this.pos);
      if (next === null || next.indent !== indent || !this.startsSequenceEntry(next.content)) break;
      this.pos = next.content;
    }
    return { type: "list", items } as unknown as JsonValue;
  }

  /** A scalar or a flow collection on this line, its continuation lines indented past `parent`. */
  private inline(parent: number): JsonValue {
    const ch = this.src[this.pos];
    if (ch === "'") return this.singleQuoted();
    if (ch === '"') return this.doubleQuoted();
    if (ch === "[" || ch === "{") return this.flow();
    if (ch === "|" || ch === ">") throw new Unread("a block scalar");
    return resolvePlain(this.plain(parent));
  }

  /** A plain scalar in block context: this line's text, and each line after indented past `parent`, folded. */
  private plain(parent: number): string {
    let text = this.plainLine();
    for (;;) {
      const lineEnd = this.pos;
      let at = lineEnd;
      if (this.src[at] !== "\n") break;
      let breaks = 0;
      let content = -1;
      while (at < this.src.length && this.src[at] === "\n") {
        at += 1;
        let probe = at;
        while (probe < this.src.length && this.src[probe] === " ") probe += 1;
        if (this.src[probe] === "\n") {
          breaks += 1;
          at = probe;
          continue;
        }
        if (probe - at > parent && probe < this.src.length && this.src[probe] !== "#" && !(probe - at === 0 && /^(?:---|\.\.\.)/.test(this.src.slice(probe)))) content = probe;
        break;
      }
      if (content < 0) break;
      this.pos = content;
      const more = this.plainLine();
      if (more === "") {
        this.pos = lineEnd;
        break;
      }
      text += breaks > 0 ? "\n".repeat(breaks) : " ";
      text += more;
    }
    return text;
  }

  /** One line's part of a plain scalar: to ": ", " #" or the line's end, its trailing spaces dropped. */
  private plainLine(): string {
    const start = this.pos;
    while (this.pos < this.src.length && this.src[this.pos] !== "\n") {
      if (this.src[this.pos] === ":" && (this.pos + 1 >= this.src.length || this.src[this.pos + 1] === " " || this.src[this.pos + 1] === "\n")) break;
      if (this.src[this.pos] === "#" && this.src[this.pos - 1] === " ") break;
      this.pos += 1;
    }
    const text = this.src.slice(start, this.pos).trimEnd();
    this.pos = start + text.length;
    return text;
  }

  /** Folding in a quoted scalar at a line break: the breaks after the first kept, else one space; leading spaces dropped. */
  private fold(): string {
    let breaks = 0;
    while (this.src[this.pos] === "\n") {
      this.pos += 1;
      breaks += 1;
      while (this.src[this.pos] === " " || this.src[this.pos] === "\t") this.pos += 1;
    }
    return breaks > 1 ? "\n".repeat(breaks - 1) : " ";
  }

  private singleQuoted(): string {
    this.pos += 1;
    let text = "";
    for (;;) {
      if (this.pos >= this.src.length) throw new Unread("an unclosed quote");
      const ch = this.src[this.pos]!;
      if (ch === "'") {
        if (this.src[this.pos + 1] === "'") {
          text += "'";
          this.pos += 2;
          continue;
        }
        this.pos += 1;
        return text;
      }
      if (ch === "\n" || ((ch === " " || ch === "\t") && /^[ \t]*\n/.test(this.src.slice(this.pos)))) {
        while (this.src[this.pos] === " " || this.src[this.pos] === "\t") this.pos += 1;
        text += this.fold();
        continue;
      }
      text += ch;
      this.pos += 1;
    }
  }

  private doubleQuoted(): string {
    this.pos += 1;
    let text = "";
    for (;;) {
      if (this.pos >= this.src.length) throw new Unread("an unclosed quote");
      const ch = this.src[this.pos]!;
      if (ch === '"') {
        this.pos += 1;
        return text;
      }
      if (ch === "\\") {
        const code = this.src[this.pos + 1] ?? "";
        if (code === "\n") {
          // An escaped line break: the lines joined, the next one's leading spaces dropped.
          this.pos += 2;
          while (this.src[this.pos] === " " || this.src[this.pos] === "\t") this.pos += 1;
          continue;
        }
        if (Object.hasOwn(ESCAPES, code)) {
          text += ESCAPES[code];
          this.pos += 2;
          continue;
        }
        const length = HEX_ESCAPES[code];
        if (length === undefined) throw new Unread("an escape");
        const digits = this.src.slice(this.pos + 2, this.pos + 2 + length);
        if (!/^[0-9a-fA-F]+$/.test(digits) || digits.length !== length) throw new Unread("an escape");
        text += String.fromCodePoint(Number.parseInt(digits, 16));
        this.pos += 2 + length;
        continue;
      }
      if (ch === "\n" || ((ch === " " || ch === "\t") && /^[ \t]*\n/.test(this.src.slice(this.pos)))) {
        while (this.src[this.pos] === " " || this.src[this.pos] === "\t") this.pos += 1;
        text += this.fold();
        continue;
      }
      text += ch;
      this.pos += 1;
    }
  }

  /** A flow collection on one line: [a, b], {a: 1}, and the empty ones. */
  private flow(): JsonValue {
    const open = this.src[this.pos];
    this.pos += 1;
    const skip = (): void => {
      while (this.src[this.pos] === " ") this.pos += 1;
    };
    const items: JsonValue[] = [];
    const entries: [JsonValue, JsonValue][] = [];
    const close = open === "[" ? "]" : "}";
    skip();
    while (this.src[this.pos] !== close) {
      if (this.pos >= this.src.length || this.src[this.pos] === "\n") throw new Unread("a flow collection over lines");
      const first = this.flowScalar();
      skip();
      if (open === "{" || this.src[this.pos] === ":") {
        if (this.src[this.pos] !== ":") throw new Unread("a flow mapping");
        this.pos += 1;
        skip();
        const value = this.src[this.pos] === "," || this.src[this.pos] === close ? null : this.flowScalar();
        if (open === "{") entries.push([first, value]);
        else items.push({ type: "dict", entries: [[first, value]] } as unknown as JsonValue);
      } else {
        items.push(first);
      }
      skip();
      if (this.src[this.pos] === ",") {
        this.pos += 1;
        skip();
      } else if (this.src[this.pos] !== close) {
        throw new Unread("a flow collection");
      }
    }
    this.pos += 1;
    return (open === "[" ? { type: "list", items } : { type: "dict", entries }) as unknown as JsonValue;
  }

  private flowScalar(): JsonValue {
    const ch = this.src[this.pos];
    if (ch === "'") return this.singleQuoted();
    if (ch === '"') return this.doubleQuoted();
    if (ch === "[" || ch === "{") return this.flow();
    if (ch === "*") return this.alias();
    const start = this.pos;
    while (this.pos < this.src.length && !",[]{}\n".includes(this.src[this.pos]!)) {
      if (this.src[this.pos] === ":" && (this.src[this.pos + 1] === " " || ",[]{}".includes(this.src[this.pos + 1] ?? ""))) break;
      this.pos += 1;
    }
    return resolvePlain(this.src.slice(start, this.pos).trim());
  }
}

/** The data a notification row's YAML text holds, as the client's SafeLoader reads it; null where it cannot be read here. */
export function notificationDataOfYaml(text: string): JsonValue | null {
  try {
    return new Reader(text.replace(/\r\n?/g, "\n")).document();
  } catch {
    return null;
  }
}
