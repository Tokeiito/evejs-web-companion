// R53 (look more like the EVE client — square, no rounded corners). The design
// system centralises corner rounding in two radius tokens, and every panel /
// control / card gets its shape from them or from a handful of hardcoded radii.
// This pass set the tokens to 0 and swept the hardcoded radii to 0 so the whole
// UI reads as hard rectangles. This test is the regression guard: it reads the
// real stylesheet off disk and fails if any non-zero corner radius comes back.
//
// The matcher is proven live (it fires on a known non-zero value) so the test
// cannot pass while asserting nothing — see MEMORY: tests that pass while
// testing nothing.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const UI_DIR = path.dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(path.join(UI_DIR, "..", "styles.css"), "utf8");
// Comments contain prose like "border-radius: 50%)" describing the one
// exception — strip them so we only ever inspect real declarations.
const CSS_NO_COMMENTS = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

// A length/percentage value with a unit: 0.4rem, 999px, 50%, 0.12rem, ...
// A bare `0` has no unit and never matches; `var(--radius-…)` has no unit
// number and never matches. That is the whole point.
const UNIT_VALUE = /(?:\d*\.\d+|\d+)(?:rem|px|em|%|vh|vw|vmin|vmax|ch)/g;

function borderRadiusDecls(css: string): string[] {
  return [...css.matchAll(/border-radius\s*:\s*([^;]+);/g)].map((m) => m[1]!.trim());
}

test("the matcher actually fires on a non-zero radius (not vacuous)", () => {
  // If this ever stopped matching, every assertion below would pass trivially.
  assert.deepEqual("border-radius: 0.4rem;".match(UNIT_VALUE), ["0.4rem"]);
  assert.deepEqual("border-radius: 999px;".match(UNIT_VALUE), ["999px"]);
  assert.deepEqual("border-radius: 0.12rem;".match(UNIT_VALUE), ["0.12rem"]);
  // ...and does NOT fire on the square forms we swept to.
  assert.equal("border-radius: 0;".match(UNIT_VALUE), null);
  assert.equal("border-radius: var(--radius-frame);".match(UNIT_VALUE), null);
});

test("both radius tokens are flipped to 0 (square corners cascade)", () => {
  assert.match(CSS_NO_COMMENTS, /--radius-frame:\s*0\s*;/, "--radius-frame must be 0");
  assert.match(CSS_NO_COMMENTS, /--radius-control:\s*0\s*;/, "--radius-control must be 0");
});

test("no non-zero border-radius survives, except the documented ring circle", () => {
  const decls = borderRadiusDecls(CSS_NO_COMMENTS);
  // Non-vacuous: there are many declarations to check, or the regex is wrong.
  assert.ok(decls.length >= 15, `expected many border-radius decls, found ${decls.length}`);

  for (const decl of decls) {
    const units = decl.match(UNIT_VALUE) ?? [];
    // Allowed unit values: none at all (bare 0 or a var() token that resolves
    // to 0), or the one exception `50%` on the radial fitting guide circle.
    const offenders = units.filter((u) => Number.parseFloat(u) !== 0 && u !== "50%");
    assert.deepEqual(offenders, [], `non-square border-radius: "${decl}"`);
  }
});

test("exactly one radius exception remains — the fit-ring guide circle", () => {
  // A geometric guide CIRCLE, not a rounded corner. Pinned to one, so a new
  // circle (or re-squaring this one) surfaces for review rather than sliding in.
  const circles = borderRadiusDecls(CSS_NO_COMMENTS).filter((d) => /50%/.test(d));
  assert.equal(circles.length, 1, "only .fit-ring-guide may keep a radius (50% circle)");
});
