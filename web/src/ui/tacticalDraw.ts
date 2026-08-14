// THE TACTICAL VIEW'S PAINT PASS (goal R70).
//
// Split out of `Tactical.svelte` for two reasons, and the second is the one that
// matters.
//
//  1. It keeps the component to what a component should be — props in, a canvas
//     element, an effect that says "repaint" — with no drawing buried inside a
//     reactive block.
//
//  2. ⚠ IT MAKES THE PICTURE VERIFIABLE WITHOUT A GAME SERVER. `space/tactical.ts`
//     proves where a bracket GOES; nothing can prove it is DRAWN except drawing
//     it. With the paint pass sitting behind a plain function that takes a 2D
//     context, a harness page can feed it fabricated entities and render the
//     result on demand — no BFF, no gateway, no pilot in space. A renderer that
//     can only be exercised by flying a ship to it is a renderer nobody checks.
//
// It draws in CSS pixels and assumes the caller has already applied the device
// pixel ratio transform. It reads no globals and holds no state.

import { formatDistance } from "../space/overview.ts";
import {
  plotGeometry,
  type TacticalBracket,
  type TacticalRing,
  type TacticalRole,
  type TacticalViewport,
} from "../space/tactical.ts";

/** The design-system token each bracket family takes its colour from. */
export const ROLE_TOKENS: Readonly<Record<TacticalRole, string>> = {
  self: "--color-accent-bright",
  hostile: "--color-danger",
  police: "--color-warn",
  drone: "--color-capacitor",
  station: "--color-accent",
  gate: "--color-powergrid",
  celestial: "--color-muted",
  asteroid: "--color-armor",
  wreck: "--color-calibration",
  ship: "--color-text-bright",
};

/** Resolved colours for one paint. */
export interface TacticalPalette {
  readonly role: Readonly<Record<TacticalRole, string>>;
  readonly ring: string;
  readonly ringText: string;
  readonly selected: string;
}

/** The fallbacks, matching the design system's own token values. */
const FALLBACK: TacticalPalette = {
  role: {
    self: "#a9d3f0",
    hostile: "#e08a8a",
    police: "#d9a441",
    drone: "#5ab98c",
    station: "#7fb4d9",
    gate: "#b58ad0",
    celestial: "#8fa3b8",
    asteroid: "#c8a24a",
    wreck: "#9aa8bb",
    ship: "#e6f0fa",
  },
  ring: "#1b2836",
  ringText: "#8fa3b8",
  selected: "#a9d3f0",
};

/**
 * Read the palette off a live element's computed style, so the viewport takes
 * its colours from the design system's tokens rather than restating them — a
 * token change cannot leave the picture behind.
 */
export function readPalette(element: Element): TacticalPalette {
  const style = getComputedStyle(element);
  const token = (name: string, fallback: string): string => {
    const value = style.getPropertyValue(name).trim();
    return value.length > 0 ? value : fallback;
  };
  const role = {} as Record<TacticalRole, string>;
  for (const key of Object.keys(ROLE_TOKENS) as TacticalRole[]) {
    role[key] = token(ROLE_TOKENS[key], FALLBACK.role[key]);
  }
  return {
    role,
    ring: token("--color-line", FALLBACK.ring),
    ringText: token("--color-muted", FALLBACK.ringText),
    selected: token("--color-accent-bright", FALLBACK.selected),
  };
}

/** Everything one paint needs. */
export interface TacticalScene {
  readonly view: TacticalViewport;
  readonly brackets: readonly TacticalBracket[];
  readonly rings: readonly TacticalRing[];
  readonly labelled: ReadonlySet<number>;
  readonly selectedID: number | null;
  readonly palette: TacticalPalette;
  /** What to call a bracket. Supplied by the caller so the name cache stays out. */
  readonly nameOf: (bracket: TacticalBracket) => string;
}

/**
 * The EVE corner bracket: four L-shaped marks, never a closed box.
 *
 * The open corners are the whole character of the thing — a closed rectangle
 * around every object reads as a selection box on a form, and at a glance a grid
 * of them looks like a table rather than like space.
 */
export function drawCornerBracket(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  arm: number,
): void {
  const half = size / 2;
  ctx.beginPath();
  ctx.moveTo(x - half, y - half + arm);
  ctx.lineTo(x - half, y - half);
  ctx.lineTo(x - half + arm, y - half);

  ctx.moveTo(x + half - arm, y - half);
  ctx.lineTo(x + half, y - half);
  ctx.lineTo(x + half, y - half + arm);

  ctx.moveTo(x + half, y + half - arm);
  ctx.lineTo(x + half, y + half);
  ctx.lineTo(x + half - arm, y + half);

  ctx.moveTo(x - half + arm, y + half);
  ctx.lineTo(x - half, y + half);
  ctx.lineTo(x - half, y + half - arm);
  ctx.stroke();
}

const TILT = 0.42;

/** Paint the whole scene. Clears first; leaves the context's state as it found it. */
export function drawTactical(ctx: CanvasRenderingContext2D, scene: TacticalScene): void {
  const { view, brackets, rings, labelled, selectedID, palette, nameOf } = scene;
  const { cx, cy, radius } = plotGeometry(view);

  ctx.save();
  ctx.clearRect(0, 0, view.width, view.height);
  ctx.lineWidth = 1;
  ctx.font = '10px "Segoe UI", system-ui, sans-serif';
  ctx.textBaseline = "middle";

  // --- range rings -----------------------------------------------------------
  for (const ring of rings) {
    const rx = ring.radial * radius;
    const ry = rx * TILT;
    if (rx < 4) {
      continue;
    }
    ctx.strokeStyle = palette.ring;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    // The label rides on its own ring, which is where the eye already is when it
    // is working out how far out something sits.
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = palette.ringText;
    ctx.textAlign = "center";
    ctx.fillText(ring.label, cx, cy - ry);
  }
  ctx.globalAlpha = 1;

  // --- your own ship ---------------------------------------------------------
  ctx.fillStyle = palette.role.self;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 6);
  ctx.lineTo(cx + 5, cy + 5);
  ctx.lineTo(cx, cy + 2);
  ctx.lineTo(cx - 5, cy + 5);
  ctx.closePath();
  ctx.fill();

  // --- everything on grid ----------------------------------------------------
  for (const bracket of brackets) {
    const colour = palette.role[bracket.role];
    const isSelected = bracket.itemID === selectedID;
    const isThreat = bracket.role === "hostile";

    // The drop line to the object's own place on the disc — the cheapest thing
    // that makes a flat plot read as three-dimensional.
    if (Math.abs(bracket.y - bracket.planeY) > 1.5) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.moveTo(bracket.x, bracket.y);
      ctx.lineTo(bracket.x, bracket.planeY);
      ctx.stroke();
      // The shadow, so the foot of the line is a place and not a loose end.
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.ellipse(bracket.x, bracket.planeY, 2.5, 1.2, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.globalAlpha = bracket.clamped ? 0.55 : 1;
    ctx.strokeStyle = colour;
    ctx.lineWidth = isSelected || isThreat ? 1.75 : 1;
    const size = isSelected ? 18 : 12;
    drawCornerBracket(ctx, bracket.x, bracket.y, size, isSelected ? 6 : 4);

    // The picked object also gets a full ring, so "selected" survives being
    // surrounded by other brackets of the same colour.
    if (isSelected) {
      ctx.strokeStyle = palette.selected;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(bracket.x, bracket.y, size, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Where it is going. A direction, never a to-scale prediction.
    if (bracket.moving) {
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bracket.x, bracket.y);
      ctx.lineTo(bracket.x + bracket.vectorX, bracket.y + bracket.vectorY);
      ctx.stroke();
    }

    if (labelled.has(bracket.itemID)) {
      ctx.globalAlpha = 1;
      ctx.textAlign = "left";
      const textX = bracket.x + size / 2 + 5;
      ctx.fillStyle = isThreat ? colour : palette.ringText;
      ctx.fillText(nameOf(bracket), textX, bracket.y - 5);
      ctx.fillStyle = palette.ringText;
      ctx.fillText(formatDistance(bracket.distance), textX, bracket.y + 6);
    }
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}
