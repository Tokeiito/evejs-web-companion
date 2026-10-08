// The ship's speed as the page says it (shipSpeed.ts): the client's gauge's rule, and its own labels.
import test from "node:test";
import assert from "node:assert/strict";
import { SPEED_LABELS, SPEED_WORD_LABELS, shipSpeedText, singleLength, speedNumber } from "./shipSpeed.ts";
import type { SpaceShipStatus } from "../store/types.ts";

const ship = (mode: string | null, x: number, y = 0, z = 0): SpaceShipStatus =>
  ({ itemID: 1, typeID: 588, name: "Reaper", mode, position: { x: 0, y: 0, z: 0 }, velocity: { x, y, z } }) as unknown as SpaceShipStatus;

test("a speed under 100 m/s is given to one decimal, and from 100 up in whole metres cut short", () => {
  assert.deepEqual([speedNumber(0), speedNumber(0.04), speedNumber(0.05), speedNumber(34.14), speedNumber(34.16), speedNumber(99.94)], ["0.0", "0.0", "0.1", "34.1", "34.2", "99.9"]);
  // Rounded to a decimal first, as the client does it, 99.96 is written 100.0: it is still under 100.
  assert.equal(speedNumber(99.96), "100.0");
  assert.deepEqual([speedNumber(100), speedNumber(100.99), speedNumber(341.9), speedNumber(448793612100.7)], ["100", "100", "341", "448793612100"]);
  assert.deepEqual([speedNumber(Number.NaN), speedNumber(Number.POSITIVE_INFINITY), speedNumber(-1)], [null, null, null]);
});

test("the speed is the length of the velocity in single precision, which is what brings a ship to its top speed", () => {
  // As near its top speed as a ship in the park gets: short of it in double precision, on it in single.
  const almost = 340.99999999999983;
  assert.equal(Math.trunc(almost), 340);
  assert.equal(singleLength({ x: almost, y: 0, z: 0 }), 341);
  assert.equal(shipSpeedText(ship("GOTO", almost), {}), "341 metres a second");
  // Further short, it is short in both.
  assert.equal(shipSpeedText(ship("GOTO", 340.999), {}), "340 metres a second");
  // Three parts, each made single before it is squared; 3, 4, 12 is 13 exactly.
  assert.equal(singleLength({ x: 3, y: -4, z: 12 }), 13);
  const v = { x: -155.38812345678, y: 0.000123456789, z: -303.54098765432 };
  const f = Math.fround;
  assert.equal(singleLength(v), f(Math.sqrt(f(f(f(f(v.x) * f(v.x)) + f(f(v.y) * f(v.y))) + f(f(v.z) * f(v.z))))));
  assert.notEqual(singleLength(v), Math.hypot(v.x, v.y, v.z));
  assert.ok(Math.abs(singleLength(v) - Math.hypot(v.x, v.y, v.z)) < 1e-4);
  // A velocity for which each step matters: making the parts single, and adding their squares in single.
  const w = { x: -100.74, y: 0.022, z: -201.06 };
  assert.equal(singleLength(w), 224.88589477539062);
  assert.equal(f(Math.sqrt(f(f(f(w.x * w.x) + f(w.y * w.y)) + f(w.z * w.z)))), 224.8859100341797, "the parts left double");
  assert.equal(f(Math.sqrt(f(w.x) * f(w.x) + f(w.y) * f(w.y) + f(w.z) * f(w.z))), 224.8859100341797, "the squares added in double");
});

test("the speed is said with the client's label, and in words of our own without it", () => {
  assert.deepEqual(SPEED_WORD_LABELS, ["UI/Inflight/MetersPerSecond", "UI/Inflight/WarpSpeedNotification", "UI/Inflight/Scanner/Warping"]);
  // Made-up text in each label's shape.
  const templates = { [SPEED_LABELS.metresPerSecond]: "<b>{speed}</b> paces a beat " };
  assert.equal(shipSpeedText(ship("GOTO", 300, 0, 400), templates), "500 paces a beat");
  assert.equal(shipSpeedText(ship("STOP", 3, 4, 0), templates), "5.0 paces a beat");
  assert.equal(shipSpeedText(ship("GOTO", 300, 0, 400), {}), "500 metres a second");
  assert.equal(shipSpeedText(ship(null, 0), { [SPEED_LABELS.metresPerSecond]: null }), "0.0 metres a second");
});

test("in warp mode, lining up or under way, the gauge says so and gives no number", () => {
  const templates = { [SPEED_LABELS.warpNotification]: "[{warpingMessage}]", [SPEED_LABELS.warping]: "Folding space", [SPEED_LABELS.metresPerSecond]: "{speed} paces a beat" };
  assert.equal(shipSpeedText(ship("WARP", 300), templates), "[Folding space]");
  assert.equal(shipSpeedText(ship(" warp ", 4e11), templates), "[Folding space]");
  // With one of the two labels, the other is ours; with neither, both are.
  assert.equal(shipSpeedText(ship("WARP", 300), { [SPEED_LABELS.warping]: "Folding space" }), "(Folding space)");
  assert.equal(shipSpeedText(ship("WARP", 300), { [SPEED_LABELS.warpNotification]: "[{warpingMessage}]" }), "[In warp]");
  assert.equal(shipSpeedText(ship("WARP", 300), {}), "(In warp)");
});

test("with no ship, or no speed to read, nothing is said", () => {
  assert.equal(shipSpeedText(null, {}), null);
  assert.equal(shipSpeedText(undefined, {}), null);
  assert.equal(shipSpeedText({ ...ship("GOTO", 1), velocity: null } as unknown as SpaceShipStatus, {}), null);
  assert.equal(shipSpeedText(ship("GOTO", Number.NaN), {}), null);
});
