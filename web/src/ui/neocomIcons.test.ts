// The Neocom's glyphs and readouts (goal R74): every panel has an icon, EVE time
// is UTC, and a shortened wallet never lies about a balance past 2^53.

import test from "node:test";
import assert from "node:assert/strict";

import {
  NEOCOM_GLYPHS,
  eveClock,
  neocomGlyph,
  portraitInitials,
  shortIsk,
} from "./neocomIcons.ts";
import { TABS } from "./tabs.ts";

// --- glyph coverage ----------------------------------------------------------

test("every tab in the app has a glyph", () => {
  // The Record<TabID, …> type makes this a compile error too; this is the belt
  // to that braces, and it is what fails first if TABS grows at runtime.
  for (const tab of TABS) {
    assert.ok(NEOCOM_GLYPHS[tab.id], `no Neocom glyph for the '${tab.id}' tab`);
  }
});

test("no glyph is empty", () => {
  // A tab whose icon is `[]` renders an empty box in the rail — a button that
  // looks broken and says nothing.
  for (const [id, glyph] of Object.entries(NEOCOM_GLYPHS)) {
    assert.ok(glyph.length > 0, `the '${id}' glyph has no primitives`);
    for (const path of glyph) {
      assert.ok(path.trim().length > 0, `the '${id}' glyph has an empty path`);
    }
  }
});

test("every glyph is a valid-looking path starting with a move", () => {
  for (const [id, glyph] of Object.entries(NEOCOM_GLYPHS)) {
    for (const path of glyph) {
      assert.match(path, /^M/, `the '${id}' glyph has a path that does not start with M: ${path}`);
      assert.ok(
        /^[MmLlHhVvCcSsQqTtAaZz0-9\s.,-]+$/.test(path),
        `the '${id}' glyph has a path with unexpected characters: ${path}`,
      );
    }
  }
});

// ⚠ WHETHER A GLYPH FITS ITS 24x24 BOX IS NOT CHECKED HERE, ON PURPOSE.
//
// The obvious version — scan each path for numbers and assert they are within
// 0..24 — is wrong, and wrong in the direction that matters: SVG path data is
// mostly RELATIVE. In `M12 3l7 17-7-4-7 4z` the `-7`s are deltas along the way,
// not coordinates, so a naive scan reports a perfectly centred arrow as hanging
// seven units outside the box. It fails on correct icons and would teach anyone
// who hit it to delete the test.
//
// Doing it properly means evaluating every path command to track the current
// point (and bounding the bulge of each arc), i.e. reimplementing a chunk of an
// SVG engine to check twenty-six small icons. The browser already has one: the
// harness page at `web/tactical-harness.html` renders every glyph and reads
// `getBBox()`, which is exact, including arcs. That is where clipping is caught.

test("no glyph is only a single point", () => {
  // A path that never moves renders as one dot — usually a typo in the deltas,
  // and invisible at rail size. This much IS checkable without a path engine:
  // a glyph whose every primitive is a lone `M x y h.01`-style dot is suspect.
  for (const [id, glyph] of Object.entries(NEOCOM_GLYPHS)) {
    const hasRealStroke = glyph.some((path) => {
      const withoutMove = path.replace(/^M[\d.\s-]+/, "");
      // A dot primitive is a tiny `h.01` / `v.01` and nothing else.
      return withoutMove.length > 0 && !/^[hv]\.01$/.test(withoutMove.trim());
    });
    assert.ok(hasRealStroke, `the '${id}' glyph is nothing but dots`);
  }
});

test("no two tabs share a glyph", () => {
  // Two identical icons in one rail is two buttons a player cannot tell apart.
  const seen = new Map<string, string>();
  for (const [id, glyph] of Object.entries(NEOCOM_GLYPHS)) {
    const key = glyph.join("|");
    const other = seen.get(key);
    assert.equal(other, undefined, `the '${id}' and '${other}' tabs share a glyph`);
    seen.set(key, id);
  }
});

test("neocomGlyph returns the tab's own glyph", () => {
  assert.deepEqual(neocomGlyph("mail"), NEOCOM_GLYPHS.mail);
});

// --- the portrait tile -------------------------------------------------------

test("a two-word name gives two initials", () => {
  assert.equal(portraitInitials("Rada Farmer"), "RF");
});

test("a one-word name gives one initial", () => {
  assert.equal(portraitInitials("Farmer"), "F");
});

test("a three-word name takes the first and the LAST", () => {
  // A surname is more identifying than a middle name.
  assert.equal(portraitInitials("Ret Van Gaal"), "RG");
});

test("initials are upper-cased", () => {
  assert.equal(portraitInitials("rada farmer"), "RF");
});

test("extra whitespace does not produce blank initials", () => {
  assert.equal(portraitInitials("  Rada   Farmer  "), "RF");
});

test("no name gives no initials rather than a placeholder", () => {
  // A placeholder glyph would imply a pilot we do not have.
  assert.equal(portraitInitials(null), "");
  assert.equal(portraitInitials(undefined), "");
  assert.equal(portraitInitials(""), "");
  assert.equal(portraitInitials("   "), "");
});

// --- EVE time ----------------------------------------------------------------

test("the clock is UTC, not local", () => {
  // ⚠ The whole point. A local clock here looks exactly like the one thing a
  // player expects (EVE time) while reporting something else, and fleet times
  // are always quoted in EVE time.
  const date = new Date(Date.UTC(2026, 7, 13, 23, 41));
  assert.equal(eveClock(date), "23:41");
});

test("the clock zero-pads both fields", () => {
  assert.equal(eveClock(new Date(Date.UTC(2026, 0, 1, 4, 5))), "04:05");
});

test("midnight reads 00:00, not 24:00", () => {
  assert.equal(eveClock(new Date(Date.UTC(2026, 0, 1, 0, 0))), "00:00");
});

// --- the shortened wallet ----------------------------------------------------

test("a small balance is shown as it is", () => {
  assert.equal(shortIsk("842"), "842");
});

test("thousands, millions and billions get their suffix", () => {
  assert.equal(shortIsk("1500"), "1.5K");
  assert.equal(shortIsk("2400000"), "2.4M");
  assert.equal(shortIsk("7300000000"), "7.3B");
});

test("a round amount drops the pointless decimal", () => {
  assert.equal(shortIsk("2000000"), "2M");
});

test("a balance past 2^53 is shortened EXACTLY, not through Number", () => {
  // 9007199254740993 is Number.MAX_SAFE_INTEGER + 2, which a float cannot hold.
  // Routing this through Number gives 9.007199254740992e15 and the wrong digits.
  assert.equal(shortIsk("9007199254740993"), "9007.1T");
});

test("a negative balance keeps its sign", () => {
  assert.equal(shortIsk("-4200000"), "-4.2M");
});

test("an unread or nonsensical balance is a dash, never a zero", () => {
  // A fabricated 0 ISK in the rail says the pilot is broke, which is a fact a
  // player would act on.
  assert.equal(shortIsk(null), "—");
  assert.equal(shortIsk(undefined), "—");
  assert.equal(shortIsk("not a number"), "—");
});

test("a fractional balance is truncated toward the magnitude, not rounded up", () => {
  assert.equal(shortIsk("1999.99"), "1.9K");
});
