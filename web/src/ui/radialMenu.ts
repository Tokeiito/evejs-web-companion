// THE RADIAL MENU'S GEOMETRY AND PLACEMENT (goal R77) — pure and testable.
//
// EVE's right-click radial is one of the game's signature interactions: the
// verbs for a thing appear AROUND the thing, so the pointer is already in the
// middle of them and every option is the same short flick away. A dropdown makes
// you travel to the option you want and makes the ninth item nine times further
// than the first.
//
// Two decisions live here rather than in the component, because both are
// arithmetic that a rendered menu can only be checked against by eye:
//
//   1. WHERE EACH ITEM SITS. Evenly around a circle, first item at the top,
//      going clockwise — so the same verb is in the same place every time for a
//      given count, which is what lets the gesture become muscle memory.
//   2. WHERE THE CIRCLE SITS. Nudged so it cannot open off the edge of the
//      workspace. A menu whose top-left three items are past the window edge is
//      a menu that has silently removed three of its options.
//
// Angles use the same convention as `shipHudArcs.ts`: degrees, 0 at three
// o'clock, increasing clockwise (SVG/CSS screen axes, y down).

/** One item's place on the ring, in pixels relative to the menu's centre. */
export interface RadialSlot {
  readonly index: number;
  /** Offset from the centre, in CSS pixels. */
  readonly dx: number;
  readonly dy: number;
  /** The item's bearing, for a caller that wants to rotate or label it. */
  readonly angleDeg: number;
}

/** Where the first item goes: straight up from the centre. */
const FIRST_ITEM_DEG = -90;

/**
 * Place `count` items evenly around a ring of `radius`.
 *
 * ⚠ ONE ITEM GOES AT THE TOP, NOT AT THREE O'CLOCK. A single-item ring drawn at
 * 0° hangs off the right of the pointer and reads as a stray button rather than
 * as a menu; at the top it reads as what it is. That is why the first item is
 * offset to -90° rather than the loop starting from zero.
 */
export function radialSlots(count: number, radius: number): readonly RadialSlot[] {
  if (!Number.isFinite(count) || count <= 0 || !Number.isFinite(radius) || radius <= 0) {
    return [];
  }
  const step = 360 / count;
  const slots: RadialSlot[] = [];
  for (let index = 0; index < count; index += 1) {
    const angleDeg = FIRST_ITEM_DEG + index * step;
    const radians = (angleDeg * Math.PI) / 180;
    slots.push({
      index,
      dx: radius * Math.cos(radians),
      dy: radius * Math.sin(radians),
      angleDeg,
    });
  }
  return slots;
}

/** A box the menu must stay inside, in the same coordinate space as the centre. */
export interface MenuBounds {
  readonly width: number;
  readonly height: number;
}

/**
 * Where to actually put the menu's centre so no item falls outside `bounds`.
 *
 * ⚠ IT MOVES THE WHOLE MENU, IT DOES NOT RESHAPE IT. The tempting alternative —
 * squashing the ring or dropping the items that would not fit — changes where a
 * verb is depending on where you clicked, which destroys the only thing a radial
 * has over a list. The ring keeps its size and its layout; only its centre
 * shifts, so the same verb stays in the same direction wherever it opens.
 *
 * `margin` is the room one item needs beyond the ring itself (half an item's
 * width, plus a little air).
 */
export function clampMenuCentre(
  x: number,
  y: number,
  radius: number,
  bounds: MenuBounds,
  margin = 44,
): { readonly x: number; readonly y: number } {
  const reach = radius + margin;
  // When the box is narrower than the menu there is no non-overlapping answer,
  // so centre it and let it overhang evenly rather than pinning it to one edge —
  // an off-centre overhang hides items on one side only, which is worse.
  const clampAxis = (value: number, extent: number): number => {
    if (extent < reach * 2) {
      return extent / 2;
    }
    return Math.min(Math.max(value, reach), extent - reach);
  };
  return {
    x: clampAxis(x, bounds.width),
    y: clampAxis(y, bounds.height),
  };
}

/**
 * Move the keyboard focus around the ring.
 *
 * ⚠ THE RADIAL IS NOT KEYBOARD-ONLY-HOSTILE BY DEFINITION, BUT IT IS EASY TO
 * MAKE IT SO. Items are absolutely positioned, so their DOM order and their
 * visual order are the same ring — arrow keys walk it, and it WRAPS, because a
 * ring has no first or last item and stopping at one would be a lie about the
 * shape on screen.
 *
 * Left/up go anticlockwise, right/down clockwise. Returns the new index.
 */
export function moveRadialFocus(
  current: number,
  count: number,
  key: string,
): number {
  if (count <= 0) {
    return 0;
  }
  const back = key === "ArrowLeft" || key === "ArrowUp";
  const forward = key === "ArrowRight" || key === "ArrowDown";
  if (!back && !forward) {
    return current;
  }
  const next = current + (forward ? 1 : -1);
  // Wrap in both directions.
  return ((next % count) + count) % count;
}
