// What the tactical view writes beside a labelled bracket: its name, and the
// distance between hulls as the client's brackets give it (bracket.py: the
// name, then FmtDist of the ball's surface distance, and nothing at none).

import test from "node:test";
import assert from "node:assert/strict";

import { ROLE_TOKENS, drawTactical, type TacticalPalette } from "./tacticalDraw.ts";
import { projectBrackets, tacticalRings, type TacticalViewport } from "../space/tactical.ts";
import type { SpaceEntity } from "../store/types.ts";

const VIEW: TacticalViewport = { width: 800, height: 600 };
const PALETTE: TacticalPalette = {
  role: Object.fromEntries(Object.keys(ROLE_TOKENS).map((role) => [role, "#fff"])) as TacticalPalette["role"],
  ring: "#111",
  ringText: "#222",
  selected: "#333",
};

function thing(itemID: number, x: number, radius: number): SpaceEntity {
  return { itemID, kind: "ship", typeID: 606, groupID: 25, categoryID: 6, name: `thing ${itemID}`, ownerID: null, radius,
    position: { x, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, isSelf: false, isNpc: false, npcEntityType: null } as unknown as SpaceEntity;
}

/** Draws the scene on a stand-in canvas and answers every piece of text written to it. */
function written(entities: SpaceEntity[], say?: (unit: string, figure: string) => string): string[] {
  const texts: string[] = [];
  const ctx = new Proxy({}, {
    get: (_target, property) => (property === "fillText" ? (text: string) => { texts.push(text); } : () => {}),
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
  const brackets = projectBrackets(entities, { x: 0, y: 0, z: 0 }, VIEW, 30);
  drawTactical(ctx, { view: VIEW, brackets, rings: tacticalRings(), labelled: new Set(entities.map((each) => each.itemID)), selectedID: null,
    palette: PALETTE, nameOf: (bracket) => bracket.name ?? "?", say: say as never });
  return texts;
}

test("a labelled bracket gives the distance between hulls, by the client's rule", () => {
  // 100 m in radius, its centre 5 km off, from a ship of 30 m: 4,870 m between hulls.
  const texts = written([thing(1, 5_000, 100)]);
  assert.ok(texts.includes("thing 1"));
  assert.ok(texts.includes(`${(4870).toLocaleString()} m`), texts.join(" | "));
  assert.equal(texts.some((text) => /5\.0 km/.test(text)), false, "not the centres' five kilometres");
  // Twelve kilometres off: whole kilometres.
  assert.ok(written([thing(2, 12_130, 100)]).includes("12 km"));
});

test("a bracket at no distance says none, as the client's does", () => {
  // The ship is inside this one's ball.
  const texts = written([thing(3, 65_000, 100_000)]);
  assert.ok(texts.includes("thing 3"));
  // Nothing in metres is written at all (the rings' own labels are in kilometres), "0 m" least of all.
  assert.equal(texts.filter((text) => /^[\d,.]+ m$/.test(text)).length, 0, texts.join(" | "));
  // The same thing a little way off does get its distance.
  assert.ok(written([thing(3, 100_230, 100_000)]).includes("200 m"));
});

test("the unit is put on by whoever the view was given", () => {
  const texts = written([thing(4, 5_000, 100)], (unit, figure) => `${figure} of ${unit}`);
  assert.ok(texts.includes(`${(4870).toLocaleString()} of m`), texts.join(" | "));
});
