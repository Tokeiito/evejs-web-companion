// The ship's speed, as the retail client's HUD says it.
//
// The speed gauge (speedGauge.py, UpdateSpeedThread; activeShipController.py, GetSpeed and
// _GetSpeedFormatted) reads the ball's speed as the client draws it, fifty times a second:
//
//   - while the ball is in warp mode, lining up or under way, it says the client's word for warping,
//     in brackets, and no number;
//   - under 100 m/s it gives the speed to one decimal (round(speed, 1));
//   - at 100 m/s and over, whole metres, cut and not rounded (int(speed)).
//
// The ball hands the gauge its velocity as a vector of single-precision numbers (ClientBall::GetValueDotAt
// ends in AsVector3), and the length is taken of that. It matters at top speed: a ship never quite reaches
// its top speed, and 340.9999999999998 m/s cut to whole metres is 340, where the nearest single-precision
// number to it is 341. Not determined: the order the engine's own Length() adds the three squares in, which
// can move the last digit; here it is x, y, z.
//
// The labels' text is the client's and is read from its install at run time (the words store); what is
// written here is only what is said when that cannot be had. Not determined: whether the client writes
// 34.0 or 34 for a speed that rounds to a whole number under 100; this writes the decimal.

import { formatTemplate, plainText } from "../bridge/clientWords.ts";
import type { SpaceShipStatus } from "../store/types.ts";

export const SPEED_LABELS = {
  /** Its one argument is speed. */
  metresPerSecond: "UI/Inflight/MetersPerSecond",
  /** Its one argument is warpingMessage. */
  warpNotification: "UI/Inflight/WarpSpeedNotification",
  warping: "UI/Inflight/Scanner/Warping",
} as const;
export const SPEED_WORD_LABELS: readonly string[] = Object.values(SPEED_LABELS);

type Templates = Readonly<Record<string, string | null | undefined>>;

/** The length of a velocity as the client takes it: of the vector in single precision, in single precision. */
export function singleLength(velocity: { readonly x: number; readonly y: number; readonly z: number }): number {
  const f = Math.fround;
  const [x, y, z] = [f(velocity.x), f(velocity.y), f(velocity.z)];
  return f(Math.sqrt(f(f(f(x * x) + f(y * y)) + f(z * z))));
}

/** The number the gauge writes for a speed in metres a second, or null for one that is not a speed. */
export function speedNumber(speed: number): string | null {
  if (!Number.isFinite(speed) || speed < 0) {
    return null;
  }
  return speed < 100 ? (Math.round(speed * 10) / 10).toFixed(1) : String(Math.trunc(speed));
}

/** What the gauge says for the ship of a snapshot, or null when there is no ship or no speed to say. */
export function shipSpeedText(ship: SpaceShipStatus | null | undefined, templates: Templates): string | null {
  if (!ship) {
    return null;
  }
  const worded = (label: string, args: Record<string, string>, own: string): string => {
    const template = templates[label];
    return typeof template === "string" ? plainText(formatTemplate(template, args, { nameOf: () => "" })).trim() : own;
  };
  if ((ship.mode ?? "").trim().toUpperCase() === "WARP") {
    const warping = worded(SPEED_LABELS.warping, {}, "In warp");
    return worded(SPEED_LABELS.warpNotification, { warpingMessage: warping }, `(${warping})`);
  }
  const velocity = ship.velocity;
  if (!velocity) {
    return null;
  }
  const number = speedNumber(singleLength(velocity));
  return number === null ? null : worded(SPEED_LABELS.metresPerSecond, { speed: number }, `${number} metres a second`);
}
