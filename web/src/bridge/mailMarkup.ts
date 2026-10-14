// A mail's body as the client writes it and shows it.
//
// The client's compose window is its rich editor (evemail.py 1794: EditPlainText, showattributepanel=1), and what it
// sends is the editor's value in the editor's markup (carbonui/control/editPlainText.py, GetValue, 423 to 566): the
// text typed with &, < and > written as entities (Decode, 320 to 321), each line after the first begun with <br>, a
// tag at each change of bold, italic, underline, link, size or colour, and nothing at all where there is nothing but
// tags. A tab typed is four spaces (InsertText, 258). What is typed in the page's plain box is the editor's text with
// nothing styled, and is sent so.
//
// The client's reading pane is the same editor, read only (evemail.py 258), and shows a body by its markup
// (InsertText, 245 to 302): a heading made a bold line (249 to 257); lines split at <br>, <br/>, <br /> or a newline
// (LINESPLIT, 30); a line holding both a < and a > read piece by piece, each piece up to a > being text up to its
// first < (its entities read back, Encode, 317 to 318) and a tag after it (ParseTag, 323 onward), and any other line
// all text. The page shows the same lines, and in them the text bold, italic, underlined or a link as the tags say;
// a size or colour it leaves to its own type, and any other tag it passes over, as the client's stacks of tags would
// to no visible end.

/** One run of a line: its text, and how it is marked. */
export interface MailRun {
  readonly text: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  /** The link it is part of (a href= or url=), or null. */
  readonly link: string | null;
}

/** LINESPLIT (editPlainText.py 30). */
const LINE_SPLIT = /<br>|<br \/>|<br\/>|\r\n|\n/;

/** Decode (editPlainText.py 320 to 321): the characters the markup gives meaning to, as entities. */
function decode(text: string): string {
  return text.split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;");
}

/** Encode (editPlainText.py 317 to 318): the entities read back, in the client's order. */
function encode(text: string): string {
  return text.split("&gt;").join(">").split("&lt;").join("<").split("&amp;").join("&").split("&GT;").join(">").split("&LT;").join("<");
}

/** StripTags: the text of markup without its tags. */
function stripTags(markup: string): string {
  return markup.replace(/<[^>]*>/g, "");
}

/**
 * What the client's editor sends of text typed into it with nothing styled (GetValue): each line's characters
 * written as entities, a tab four spaces, the lines joined by <br>; nothing where there is nothing but tags.
 */
export function mailMarkupOfTyped(typed: string): string {
  const markup = typed.replace(/\t/g, "    ").split(/\r\n|\n/).map(decode).join("<br>");
  return stripTags(markup) === "" ? "" : markup;
}

/** The marks a body's tags have set so far: counted, as the client's stacks are pushed and popped. */
interface Marks {
  bold: number;
  italic: number;
  underline: number;
  readonly links: string[];
}

/** ParseTag (editPlainText.py 323 onward), for the marks the page shows. */
function parseTag(raw: string, marks: Marks): void {
  let tag = raw.replace(/"/g, "").replace(/'/g, "").toLowerCase();
  if (tag.startsWith("font ") || tag === "/font") {
    return;
  }
  tag = tag.replace("a href=", "url=").replace("/a", "/url").replace("bold", "b").replace("/bold", "/b").replace("italic", "i").replace("/italic", "/i");
  const closing = tag.startsWith("/");
  const name = closing ? tag.slice(1) : tag.includes("=") ? tag.split("=")[0]! : tag;
  const step = closing ? -1 : 1;
  if (name === "b") marks.bold = Math.max(0, marks.bold + step);
  else if (name === "i") marks.italic = Math.max(0, marks.italic + step);
  else if (name === "u") marks.underline = Math.max(0, marks.underline + step);
  else if (name === "url") {
    if (closing) marks.links.pop();
    else marks.links.push(raw.replace(/"/g, "").replace(/'/g, "").replace(/^\s*(a\s+href|url)\s*=\s*/i, ""));
  }
}

/** A body's markup as the client's reading pane shows it: its lines, each of runs of text as marked. */
export function mailBodyLines(markup: string | null): readonly (readonly MailRun[])[] {
  if (markup === null || markup === "") {
    return [];
  }
  let source = markup;
  if (source.includes("<h")) {
    for (let level = 1; level <= 6; level += 1) {
      source = source.split(`<h${level}>`).join("<br><b>").split(`</h${level}>`).join("</b><br>");
    }
  }
  source = source.replace(/\t/g, "    ");
  const marks: Marks = { bold: 0, italic: 0, underline: 0, links: [] };
  const run = (text: string): MailRun => ({
    text,
    bold: marks.bold > 0,
    italic: marks.italic > 0,
    underline: marks.underline > 0,
    link: marks.links.at(-1) ?? null,
  });
  return source.split(LINE_SPLIT).map((line) => {
    const runs: MailRun[] = [];
    if (line.includes("<") && line.includes(">")) {
      for (const piece of line.split(">")) {
        const at = piece.indexOf("<");
        const text = encode(at < 0 ? piece : piece.slice(0, at));
        if (text !== "") runs.push(run(text));
        const tag = at < 0 ? "" : piece.slice(at + 1);
        if (tag !== "") parseTag(tag, marks);
      }
    } else if (line !== "") {
      runs.push(run(encode(line)));
    }
    return runs;
  });
}
