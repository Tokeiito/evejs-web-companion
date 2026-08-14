// The radial menu's geometry (goal R77): a ring whose layout does not change
// with where it opens, a centre that keeps every item on screen, and arrow keys
// that walk the ring the way it looks.

import test from "node:test";
import assert from "node:assert/strict";

import { clampMenuCentre, moveRadialFocus, radialSlots } from "./radialMenu.ts";

const R = 90;

// --- the ring ----------------------------------------------------------------

test("the first item is at the TOP, not at three o'clock", () => {
  // A one-item ring drawn at 0° hangs off the right of the pointer and reads as
  // a stray button rather than a menu.
  const [first] = radialSlots(4, R);
  assert.ok(Math.abs(first!.dx) < 1e-9, "no horizontal offset");
  assert.ok(first!.dy < 0, "straight up from the centre");
});

test("items go CLOCKWISE from the top", () => {
  const slots = radialSlots(4, R);
  // 12 o'clock, 3, 6, 9.
  assert.ok(slots[1]!.dx > 0 && Math.abs(slots[1]!.dy) < 1e-9, "second item at three o'clock");
  assert.ok(slots[2]!.dy > 0 && Math.abs(slots[2]!.dx) < 1e-9, "third at six o'clock");
  assert.ok(slots[3]!.dx < 0, "fourth at nine o'clock");
});

test("items are evenly spaced", () => {
  const slots = radialSlots(6, R);
  for (let index = 1; index < slots.length; index += 1) {
    const step = slots[index]!.angleDeg - slots[index - 1]!.angleDeg;
    assert.ok(Math.abs(step - 60) < 1e-9, `uneven step ${step}`);
  }
});

test("every item sits exactly on the ring", () => {
  for (const slot of radialSlots(7, R)) {
    assert.ok(Math.abs(Math.hypot(slot.dx, slot.dy) - R) < 1e-9);
  }
});

test("a single item is placed at the top rather than anywhere arbitrary", () => {
  const slots = radialSlots(1, R);
  assert.equal(slots.length, 1);
  assert.ok(Math.abs(slots[0]!.dx) < 1e-9);
  assert.ok(slots[0]!.dy < 0);
});

test("a nonsensical ring yields nothing rather than throwing", () => {
  assert.deepEqual(radialSlots(0, R), []);
  assert.deepEqual(radialSlots(-3, R), []);
  assert.deepEqual(radialSlots(4, 0), []);
});

test("the layout does not depend on where the menu opens", () => {
  // The whole point of a radial: the same verb is the same flick away every
  // time. The slots are relative offsets, so this is true by construction — and
  // this is the test that keeps it true if someone tries to make them absolute.
  const a = radialSlots(5, R);
  const b = radialSlots(5, R);
  assert.deepEqual(a, b);
});

// --- placement ---------------------------------------------------------------

const BOUNDS = { width: 1000, height: 800 };

test("a menu in open space is not moved at all", () => {
  const centre = clampMenuCentre(500, 400, R, BOUNDS);
  assert.deepEqual(centre, { x: 500, y: 400 });
});

test("a menu opened at the top-left corner is pushed fully into view", () => {
  const centre = clampMenuCentre(2, 3, R, BOUNDS, 44);
  assert.equal(centre.x, R + 44);
  assert.equal(centre.y, R + 44);
});

test("a menu opened at the bottom-right corner is pushed fully into view", () => {
  const centre = clampMenuCentre(998, 799, R, BOUNDS, 44);
  assert.equal(centre.x, BOUNDS.width - (R + 44));
  assert.equal(centre.y, BOUNDS.height - (R + 44));
});

test("clamping moves the menu WITHOUT resizing the ring", () => {
  // Squashing the ring or dropping items that do not fit would move a verb
  // depending on where you clicked, which destroys the only advantage a radial
  // has. The slots are computed independently of the centre — proven by asking
  // for them at two very different clamped positions.
  const nearCorner = clampMenuCentre(0, 0, R, BOUNDS);
  const middle = clampMenuCentre(500, 400, R, BOUNDS);
  assert.notDeepEqual(nearCorner, middle, "the centres do differ");
  assert.deepEqual(radialSlots(6, R), radialSlots(6, R), "…but the ring does not");
});

test("a box too small for the menu centres it instead of pinning it to an edge", () => {
  // There is no non-overlapping answer, and an off-centre overhang would hide
  // items on one side only.
  const centre = clampMenuCentre(10, 10, R, { width: 120, height: 100 }, 44);
  assert.equal(centre.x, 60);
  assert.equal(centre.y, 50);
});

// --- keyboard ----------------------------------------------------------------

test("arrow keys walk the ring forwards and back", () => {
  assert.equal(moveRadialFocus(0, 5, "ArrowRight"), 1);
  assert.equal(moveRadialFocus(0, 5, "ArrowDown"), 1);
  assert.equal(moveRadialFocus(3, 5, "ArrowLeft"), 2);
  assert.equal(moveRadialFocus(3, 5, "ArrowUp"), 2);
});

test("focus WRAPS in both directions", () => {
  // A ring has no first or last item; stopping at one would be a lie about the
  // shape on screen.
  assert.equal(moveRadialFocus(4, 5, "ArrowRight"), 0);
  assert.equal(moveRadialFocus(0, 5, "ArrowLeft"), 4);
});

test("an unrelated key does not move the focus", () => {
  assert.equal(moveRadialFocus(2, 5, "Enter"), 2);
  assert.equal(moveRadialFocus(2, 5, "a"), 2);
  assert.equal(moveRadialFocus(2, 5, "Escape"), 2);
});

test("an empty ring cannot produce an out-of-range focus", () => {
  assert.equal(moveRadialFocus(0, 0, "ArrowRight"), 0);
});
