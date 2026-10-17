// A text in the client's label markup, read as the client's label reads it.
//
// Every text the client draws in a label (carbonui/control/label.py: its message box's body, its quick message strip,
// most of its windows' words) is parsed by trinity's native ParseLabelText (CCP's trinity repository,
// trinity/Tr2LabelTextParser.cpp) into lines, each line into tab cells, each cell into elements: a run of text, a tag
// opened (with its attributes), a tag closed, or a tag it does not know. The label then walks the elements with its tag
// stack (label.py ProcessLineData, 881 to 936, and the Parse*Open and Parse*Close methods, 1080 to 1404): bold, italic,
// underline and uppercase counted, colours, font sizes and letter spacing stacked, links and hints opened and closed,
// and the line's alignment set by <left>, <right> and <center>.
//
// parseLabelText is the native parser, step for step, its quirks kept: a tag it cannot read is passed over to the next
// '>', and an attribute list it cannot read throws away what follows it up to the next '>' as well. labelLines walks
// the elements as the label does, for the page to draw.

/** An element of a tab cell, as ParseLabelText makes them: (0, text), (1, tagID, attribs), (2, tagID), (3, name). */
export type LabelElement =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "open"; readonly tag: number; readonly attribs: Readonly<Record<string, string>> | null }
  | { readonly kind: "close"; readonly tag: number }
  | { readonly kind: "unknown"; readonly name: string };

/** The tag numbers ParseLabelText gives (label.py tagIDToFunctionMapping, 1405 to 1441). */
export const LABEL_TAG = Object.freeze({
  FONT: 1,
  U: 2,
  UPPERCASE: 3,
  I: 4,
  B: 5,
  A: 6,
  LOCALIZED: 7,
  LEFT: 100,
  RIGHT: 101,
  CENTER: 102,
  COLOR: 200,
  FONTSIZE: 201,
  LETTERSPACE: 202,
  HINT: 203,
  URL: 204,
  /** A tag of attributes alone (<color=…>, <fontsize=…>, <hint=…>, <url=…>, <letterspace=…>): -0xBEEF. */
  ATTRIBUTES: -0xbeef,
});

const END = "\0";

/** _wcsnicmp(text + at, word, word.length) === 0: the next characters are the word, in any case. */
function wordAt(chars: string[], at: number, word: string): boolean {
  for (let i = 0; i < word.length; i += 1) {
    const char = chars[at + i] ?? END;
    if (char === END || char.toLowerCase() !== word[i]!.toLowerCase()) return false;
  }
  return true;
}

/** wcschr(text + from, char): where it is next, or -1 (the search stops at the end, or at a '\0' written in). */
function findFrom(chars: string[], from: number, char: string): number {
  for (let at = from; at < chars.length; at += 1) {
    if (chars[at] === char) return at;
    if (chars[at] === END) return -1;
  }
  return -1;
}

/**
 * ParseAttribs (Tr2LabelTextParser.cpp 45 to 239): ((whitespace)*key=value)* up to '>'. Answers the attributes, null
 * (Python's None) where '>' comes at once, or undefined where the pattern is not met; `at` is where reading stopped
 * (past the '>' on success; on failure past the next '>', or at the end with the text cut there).
 */
function parseAttribs(chars: string[], start: number, keyAlreadyParsed: string | null): { at: number; attribs: Record<string, string> | null | undefined } {
  let at = start;
  if ((chars[at] ?? END) === ">") return { at: at + 1, attribs: null };
  const result: Record<string, string> = {};
  let key: string | null = keyAlreadyParsed;
  let state: "key" | "value" | "whiteOrEnd" | "whitespace" = keyAlreadyParsed !== null ? "value" : "whitespace";
  const fail = (): { at: number; attribs: undefined } => {
    const close = findFrom(chars, at, ">");
    if (close >= 0) return { at: close + 1, attribs: undefined };
    chars.length = at;
    return { at, attribs: undefined };
  };
  for (;;) {
    if (state === "whiteOrEnd" && (chars[at] ?? END) === ">") {
      at += 1;
      break;
    }
    if (state === "whiteOrEnd" || state === "whitespace") {
      let matched = false;
      for (;;) {
        const next = chars[at] ?? END;
        if (next === " " || next === "\t") {
          at += 1;
          matched = true;
        } else if (next === "&" && wordAt(chars, at + 1, "nbsp;")) {
          at += 6;
          matched = true;
        } else break;
      }
      if (!matched) return fail();
      state = "key";
    } else if (state === "key") {
      let keyStart = at;
      let char = chars[at] ?? END;
      while (char !== "=") {
        if (char === ">" || char === END) return fail();
        if (char === " " || char === "\t") keyStart = at + 1;
        if (char === "&" && wordAt(chars, at + 1, "nbsp;")) {
          keyStart = at + 6;
          at += 5;
        }
        at += 1;
        char = chars[at] ?? END;
      }
      key = chars.slice(keyStart, at).join("");
      chars[at] = END;
      at += 1;
      state = "value";
    } else if (state === "value") {
      let value: string;
      const quote = chars[at] ?? END;
      if (quote === "'" || quote === "\"") {
        const end = findFrom(chars, at + 1, quote);
        if (end < 0) return fail();
        value = chars.slice(at + 1, end).join("");
        at = end + 1;
      } else {
        const valueStart = at;
        for (;;) {
          const char = chars[at] ?? END;
          if (char === " " || char === "\t" || char === ">" || (char === "&" && wordAt(chars, at + 1, "nbsp;"))) break;
          if (char === END) return fail();
          at += 1;
        }
        value = chars.slice(valueStart, at).join("");
      }
      result[key ?? ""] = value;
      state = "whiteOrEnd";
    }
  }
  return { at, attribs: result };
}

/**
 * trinity.ParseLabelText (Tr2LabelTextParser.cpp 268 to 1043): the text's lines (split at a newline, \r\n or <br>,
 * <br/>, <br />), each line's tab cells (split at <t>), each cell's elements. &amp; &lt; &gt; and &nbsp; are read
 * back in text; a tab character is a space.
 */
export function parseLabelText(text: string): LabelElement[][][] {
  const chars = [...text];
  const lines: LabelElement[][][] = [];
  let line: LabelElement[][] = [];
  let tab: LabelElement[] = [];
  line.push(tab);
  lines.push(line);
  const newLine = (): void => {
    line = [];
    tab = [];
    line.push(tab);
    lines.push(line);
  };
  const charAt = (at: number): string => chars[at] ?? END;
  let at = 0;
  let marker = 0;
  let built = "";
  const consumeText = (): void => {
    let piece: string;
    if (built === "") piece = chars.slice(marker, at).join("");
    else {
      if (at !== marker) built += chars.slice(marker, at).join("");
      piece = built;
      built = "";
    }
    tab.push({ kind: "text", text: piece });
  };
  const open = (tag: number, attribs: Record<string, string> | null): void => {
    tab.push({ kind: "open", tag, attribs });
  };
  let state: "root" | "text" | "tag" | "closeTag" | "amp" | "done" = "root";
  while (state !== "done") {
    if (state === "root") {
      if (charAt(at) === "<") {
        marker = at;
        at += 1;
        state = "tag";
      } else if (charAt(at) === END) state = "done";
      else {
        marker = at;
        state = "text";
      }
    } else if (state === "text") {
      const char = charAt(at);
      if (char === "<") {
        consumeText();
        at += 1;
        state = "tag";
      } else if (char === "&") state = "amp";
      else if (char === "\t") {
        chars[at] = " ";
        at += 1;
      } else if (char === END) {
        consumeText();
        state = "done";
      } else if (char === "\n") {
        consumeText();
        at += 1;
        newLine();
        state = "root";
      } else if (char === "\r") {
        if (charAt(at + 1) === "\n") {
          consumeText();
          at += 2;
          newLine();
          state = "root";
        } else at += 1;
      } else at += 1;
    } else if (state === "tag") {
      if (charAt(at) === "/") {
        at += 1;
        state = "closeTag";
        continue;
      }
      let matched = false;
      const first = charAt(at).toLowerCase();
      if (first === "a") {
        const read = parseAttribs(chars, at + 1, null);
        at = read.at;
        if (read.attribs !== undefined) {
          matched = true;
          open(LABEL_TAG.A, read.attribs);
        }
      } else if (first === "b") {
        const next = charAt(at + 1);
        if (next === "r" || next === "R") {
          let eater = at + 2;
          for (;;) {
            const char = charAt(eater);
            if (char === " " || char === "\t") eater += 1;
            else if (char === "&" && wordAt(chars, eater + 1, "nbsp;")) eater += 6;
            else break;
          }
          if (charAt(eater) === ">") {
            at = eater + 1;
            matched = true;
          } else if (charAt(eater) === "/" && charAt(eater + 1) === ">") {
            at = eater + 2;
            matched = true;
          }
          if (matched) newLine();
        } else if (next === ">") {
          matched = true;
          open(LABEL_TAG.B, null);
          at += 2;
        }
      } else if (first === "c") {
        const next = charAt(at + 1).toLowerCase();
        if (next === "e") {
          if (wordAt(chars, at + 2, "nter>")) {
            matched = true;
            open(LABEL_TAG.CENTER, null);
            at += 7;
          }
        } else if (next === "o") {
          if (wordAt(chars, at + 2, "lor=")) {
            const read = parseAttribs(chars, at + 6, "color");
            at = read.at;
            if (read.attribs !== undefined) {
              matched = true;
              open(LABEL_TAG.ATTRIBUTES, read.attribs);
            }
          }
        }
      } else if (first === "f") {
        if (wordAt(chars, at + 1, "ont")) {
          const next = charAt(at + 4).toLowerCase();
          if (next === "s") {
            if (wordAt(chars, at + 5, "ize=")) {
              const read = parseAttribs(chars, at + 9, "fontsize");
              at = read.at;
              if (read.attribs !== undefined) {
                matched = true;
                open(LABEL_TAG.ATTRIBUTES, read.attribs);
              }
            }
          } else {
            const read = parseAttribs(chars, at + 4, null);
            at = read.at;
            if (read.attribs !== undefined) {
              matched = true;
              open(LABEL_TAG.FONT, read.attribs);
            }
          }
        }
      } else if (first === "h") {
        if (wordAt(chars, at + 1, "int=")) {
          const read = parseAttribs(chars, at + 5, "hint");
          at = read.at;
          if (read.attribs !== undefined) {
            matched = true;
            open(LABEL_TAG.ATTRIBUTES, read.attribs);
          }
        }
      } else if (first === "i") {
        if (charAt(at + 1) === ">") {
          matched = true;
          open(LABEL_TAG.I, null);
          at += 2;
        }
      } else if (first === "l") {
        const next = charAt(at + 1).toLowerCase();
        if (next === "o") {
          if (wordAt(chars, at + 2, "calized")) {
            const read = parseAttribs(chars, at + 9, null);
            at = read.at;
            if (read.attribs !== undefined) {
              matched = true;
              open(LABEL_TAG.LOCALIZED, read.attribs);
            }
          }
        } else if (next === "e") {
          if (wordAt(chars, at + 2, "ft>")) {
            matched = true;
            open(LABEL_TAG.LEFT, null);
            at += 5;
          } else if (wordAt(chars, at + 2, "tterspace=")) {
            const read = parseAttribs(chars, at + 12, "letterspace");
            at = read.at;
            if (read.attribs !== undefined) {
              matched = true;
              open(LABEL_TAG.ATTRIBUTES, read.attribs);
            }
          }
        }
      } else if (first === "r") {
        if (wordAt(chars, at + 1, "ight>")) {
          matched = true;
          open(LABEL_TAG.RIGHT, null);
          at += 6;
        }
      } else if (first === "t") {
        if (charAt(at + 1) === ">") {
          matched = true;
          at += 2;
          tab = [];
          line.push(tab);
        }
      } else if (first === "u") {
        const next = charAt(at + 1).toLowerCase();
        if (charAt(at + 1) === ">") {
          matched = true;
          open(LABEL_TAG.U, null);
          at += 2;
        } else if (next === "r") {
          if (charAt(at + 2).toLowerCase() === "l") {
            // "url:" is read as "url=" (the source's "Kill this wicked syntax!").
            if (charAt(at + 3) === ":") chars[at + 3] = "=";
            if (charAt(at + 3) === "=") {
              const read = parseAttribs(chars, at + 4, "url");
              at = read.at;
              if (read.attribs !== undefined) {
                matched = true;
                open(LABEL_TAG.ATTRIBUTES, read.attribs);
              }
            }
          }
        } else if (next === "p") {
          if (wordAt(chars, at + 2, "percase>")) {
            matched = true;
            open(LABEL_TAG.UPPERCASE, null);
            at += 10;
          }
        }
      }
      if (!matched) {
        const close = findFrom(chars, at, ">");
        if (close >= 0) {
          tab.push({ kind: "unknown", name: chars.slice(at, close).join("") });
          at = close + 1;
          state = "root";
        } else state = "done";
      } else state = "root";
    } else if (state === "closeTag") {
      let closeTag = -1;
      const first = charAt(at).toLowerCase();
      if (first === "a" && charAt(at + 1) === ">") {
        closeTag = LABEL_TAG.A;
        at += 2;
      } else if (first === "b" && charAt(at + 1) === ">") {
        closeTag = LABEL_TAG.B;
        at += 2;
      } else if (first === "c" && wordAt(chars, at + 1, "olor>")) {
        closeTag = LABEL_TAG.COLOR;
        at += 6;
      } else if (first === "f" && wordAt(chars, at + 1, "ont")) {
        if (charAt(at + 4) === ">") {
          closeTag = LABEL_TAG.FONT;
          at += 5;
        } else if (wordAt(chars, at + 4, "size>")) {
          closeTag = LABEL_TAG.FONTSIZE;
          at += 9;
        }
      } else if (first === "h" && wordAt(chars, at + 1, "int>")) {
        closeTag = LABEL_TAG.HINT;
        at += 5;
      } else if (first === "i" && charAt(at + 1) === ">") {
        closeTag = LABEL_TAG.I;
        at += 2;
      } else if (first === "l") {
        if (wordAt(chars, at + 1, "etterspace>")) {
          closeTag = LABEL_TAG.LETTERSPACE;
          at += 12;
        } else if (wordAt(chars, at + 1, "ocalized>")) {
          closeTag = LABEL_TAG.LOCALIZED;
          at += 10;
        }
      } else if (first === "u") {
        if (charAt(at + 1) === ">") {
          closeTag = LABEL_TAG.U;
          at += 2;
        } else if (wordAt(chars, at + 1, "rl>")) {
          closeTag = LABEL_TAG.URL;
          at += 4;
        } else if (wordAt(chars, at + 1, "ppercase>")) {
          closeTag = LABEL_TAG.UPPERCASE;
          at += 10;
        }
      }
      if (closeTag !== -1) tab.push({ kind: "close", tag: closeTag });
      else {
        const close = findFrom(chars, at, ">");
        if (close >= 0) at = close + 1;
        else chars.length = at;
      }
      state = "root";
    } else if (state === "amp") {
      let matched = false;
      const next = charAt(at + 1).toLowerCase();
      const replace = (length: number, by: string): void => {
        if (marker !== at) built += chars.slice(marker, at).join("");
        built += by;
        at += length;
        marker = at;
        matched = true;
      };
      if (next === "a" && wordAt(chars, at + 2, "mp;")) replace(5, "&");
      else if (next === "l" && charAt(at + 2).toLowerCase() === "t" && charAt(at + 3) === ";") replace(4, "<");
      else if (next === "g" && charAt(at + 2).toLowerCase() === "t" && charAt(at + 3) === ";") replace(4, ">");
      else if (next === "n" && wordAt(chars, at + 2, "bsp;")) replace(6, " ");
      if (!matched) at += 1;
      state = "text";
    }
  }
  return lines;
}

/** A run of text drawn one way: its marks as the label's tag stack has them when the run is pushed. */
export interface LabelRun {
  readonly text: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  /** A colour set by the markup, as the label keeps it (a signed 32-bit ARGB, mathUtil.LtoI); null for its own. */
  readonly color: number | null;
  /** A font size set by the markup; null for the label's own. */
  readonly fontSize: number | null;
  /** Letter spacing set by the markup; null for the label's own. */
  readonly letterSpace: number | null;
  /** The link the run is part of (an a href, or url=), or null. */
  readonly link: string | null;
  /** The hint the run shows on the pointer (hint=, or a localized tag's hint), or null. */
  readonly hint: string | null;
}

export interface LabelLineView {
  /** The line's alignment as its tags leave it (<left>, <right>, <center> hold for the lines after, as the label's does). */
  readonly align: "left" | "right" | "center";
  /** Its tab cells, each its runs. */
  readonly tabs: readonly (readonly LabelRun[])[];
}

/** various_unsorted.StringColorToHex (36 to 59): the colours the markup may name, by name capitalized. */
const NAMED_COLORS: Readonly<Record<string, string>> = Object.freeze({
  Black: "0xff000000", Green: "0xff008000", Silver: "0xffC0C0C0", Lime: "0xff00FF00", Gray: "0xff808080", Grey: "0xff808080",
  Olive: "0xff808000", White: "0xffFFFFFF", Yellow: "0xffFFFF00", Maroon: "0xff800000", Navy: "0xff000080", Red: "0xffFF0000",
  Blue: "0xff0000FF", Purple: "0xff800080", Teal: "0xff008080", Fuchsia: "0xffFF00FF", Aqua: "0xff00FFFF", Orange: "0xffFF8000",
  Transparent: "0x00000000", Lightred: "0xffcc3333", Lightblue: "0xff7777ff", Lightgreen: "0xff80ff80",
});

/**
 * ParseColorTag (label.py 1260 to 1272): a named colour, or the value with '#' read as '0x', as a number in Python's
 * long(value, 0) (0x hex, 0o or a leading 0 octal, 0b binary, else decimal), made a signed 32-bit int (LtoI); null
 * where it is no number (the label warns and leaves its colour).
 */
export function labelColor(value: string): number | null {
  const named = NAMED_COLORS[value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()];
  const text = (named ?? value.replace(/#/g, "0x")).trim();
  const match = /^([+-]?)(?:(0[xX])([0-9a-fA-F]+)|(0[oO])([0-7]+)|(0[bB])([01]+)|(0)([0-7]*)|([1-9][0-9]*))[lL]?$/.exec(text);
  if (match === null) return null;
  let magnitude: bigint;
  if (match[2]) magnitude = BigInt(`0x${match[3]}`);
  else if (match[4]) magnitude = BigInt(`0o${match[5]}`);
  else if (match[6]) magnitude = BigInt(`0b${match[7]}`);
  else if (match[8] !== undefined) magnitude = match[9] ? BigInt(`0o${match[9]}`) : 0n;
  else magnitude = BigInt(match[10]!);
  const whole = match[1] === "-" ? -magnitude : magnitude;
  return Number(BigInt.asIntN(32, whole));
}

/** A colour as the label keeps it, for CSS: its alpha, red, green and blue bytes. */
export function labelColorCss(argb: number): string {
  const value = argb >>> 0;
  const alpha = ((value >>> 24) & 0xff) / 255;
  return `rgba(${(value >>> 16) & 0xff}, ${(value >>> 8) & 0xff}, ${value & 0xff}, ${Math.round(alpha * 1000) / 1000})`;
}

/**
 * The label's walk of the elements (ProcessLineData and the Parse*Open/*Close methods): each text run with the marks
 * it is pushed with. A link takes the link's bold and colour (here only marked as a link; the page draws a link its
 * own way); <uppercase> upper-cases its runs (DoTextPushing); an attribute tag's url= is a link (ParseEmptyOpen) and its
 * other keys set a colour, a font size, a letter spacing or a hint. A tab cell's alignment is the left (ProcessLineData
 * of a tabbed line).
 */
export function labelLines(markup: string): LabelLineView[] {
  const counts = { b: 0, i: 0, u: 0, uppercase: 0 };
  // The colour stack; a link without a colour of its own pushes its handler's ("link": the page's link colour).
  const colors: (number | "link")[] = [];
  const sizes: number[] = [];
  const spaces: number[] = [];
  const fonts: (Readonly<Record<string, string>> | null)[] = [];
  const links: string[] = [];
  const hints: string[] = [];
  let align: LabelLineView["align"] = "left";
  const colorOpen = (value: string): void => {
    const color = labelColor(value);
    if (color !== null) colors.push(color);
  };
  const sizeOpen = (value: string): void => {
    const size = Number.parseInt(value, 10);
    if (Number.isFinite(size)) sizes.push(size);
  };
  const spaceOpen = (value: string): void => {
    const space = Number.parseInt(value, 10);
    if (Number.isFinite(space)) spaces.push(space);
  };
  const linkOpen = (attribs: Readonly<Record<string, string>> | null): void => {
    const href = attribs?.["href"];
    if (href === undefined) return;
    const color = attribs?.["color"];
    links.push(href.split("&amp;").join("&"));
    // linkColor or linkFmt.color: a colour given in the tag (with # read as 0x), else the link handler's.
    const own = color === undefined ? null : labelColor(color);
    colors.push(own ?? "link");
  };
  const linkClose = (): void => {
    if (links.pop() !== undefined) colors.pop();
  };
  const views: LabelLineView[] = [];
  for (const line of parseLabelText(markup)) {
    const tabbed = line.length > 1;
    const tabs: LabelRun[][] = [];
    for (const cell of line) {
      if (tabbed) align = "left";
      const runs: LabelRun[] = [];
      for (const element of cell) {
        if (element.kind === "text") {
          if (element.text === "") continue;
          const color = colors.at(-1) ?? null;
          runs.push({
            text: counts.uppercase > 0 ? element.text.toUpperCase() : element.text,
            bold: counts.b > 0,
            italic: counts.i > 0,
            underline: counts.u > 0,
            color: color === "link" ? null : color,
            fontSize: sizes.at(-1) ?? null,
            letterSpace: spaces.at(-1) ?? null,
            link: links.at(-1) ?? null,
            hint: hints.at(-1) ?? null,
          });
        } else if (element.kind === "open") {
          const attribs = element.attribs;
          switch (element.tag) {
            case LABEL_TAG.FONT:
              if (attribs?.["color"] !== undefined) colorOpen(attribs["color"]);
              if (attribs?.["size"] !== undefined) sizeOpen(attribs["size"]);
              fonts.push(attribs);
              break;
            case LABEL_TAG.U: counts.u += 1; break;
            case LABEL_TAG.UPPERCASE: counts.uppercase += 1; break;
            case LABEL_TAG.I: counts.i += 1; break;
            case LABEL_TAG.B: counts.b += 1; break;
            case LABEL_TAG.A: linkOpen(attribs); break;
            case LABEL_TAG.LOCALIZED:
              if (attribs?.["hint"] !== undefined) hints.push(attribs["hint"]);
              break;
            case LABEL_TAG.LEFT: align = "left"; break;
            case LABEL_TAG.RIGHT: align = "right"; break;
            case LABEL_TAG.CENTER: align = "center"; break;
            case LABEL_TAG.ATTRIBUTES: {
              if (attribs === null) break;
              const all = { ...attribs };
              if (all["url"] !== undefined) {
                all["href"] = all["url"];
                delete all["url"];
              }
              if (all["href"] !== undefined) {
                linkOpen(all);
                break;
              }
              for (const [key, value] of Object.entries(all)) {
                if (key === "color") colorOpen(value);
                else if (key === "fontsize") sizeOpen(value);
                else if (key === "letterspace") spaceOpen(value);
                else if (key === "hint") hints.push(value);
              }
              break;
            }
          }
        } else if (element.kind === "close") {
          switch (element.tag) {
            case LABEL_TAG.FONT: {
              const attribs = fonts.pop();
              if (attribs?.["color"] !== undefined) colors.pop();
              if (attribs?.["size"] !== undefined) sizes.pop();
              break;
            }
            case LABEL_TAG.U: counts.u = Math.max(0, counts.u - 1); break;
            case LABEL_TAG.UPPERCASE: counts.uppercase = Math.max(0, counts.uppercase - 1); break;
            case LABEL_TAG.I: counts.i = Math.max(0, counts.i - 1); break;
            case LABEL_TAG.B: counts.b = Math.max(0, counts.b - 1); break;
            case LABEL_TAG.A:
            case LABEL_TAG.URL: linkClose(); break;
            case LABEL_TAG.LOCALIZED:
            case LABEL_TAG.HINT: hints.pop(); break;
            case LABEL_TAG.COLOR: colors.pop(); break;
            case LABEL_TAG.FONTSIZE: sizes.pop(); break;
            case LABEL_TAG.LETTERSPACE: spaces.pop(); break;
          }
        }
      }
      tabs.push(runs);
    }
    views.push({ align, tabs });
  }
  return views;
}

/** Plain text written so the label reads it back as itself: &, < and > as entities (the page's own words). */
export function labelEscaped(text: string): string {
  return text.split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;");
}
