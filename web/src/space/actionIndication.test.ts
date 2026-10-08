// What the ship is doing, by the rule of the retail client's HUD. The templates
// here are made up, in the shape of the client's: a header with no parameters,
// and a line beneath with {targetName} and, for two of the three, {rangeText}.

import test from "node:test";
import assert from "node:assert/strict";

import { APPROACH_RANGE, INDICATION_LABELS, INDICATION_WORD_LABELS, actionIndication, indicationHeader, indicationText, shipIndication } from "./actionIndication.ts";
import type { SpaceSnapshot } from "../store/types.ts";

test("orbiting, approaching or keeping at range, from the ship's mode, whom it follows and the range in its order", () => {
  assert.equal(APPROACH_RANGE, 50);
  assert.deepEqual(actionIndication("ORBIT", 77, 5_000), { kind: "orbit", range: 5_000 });
  // A follow at the approach range, or at none, is an approach; at any other it is keeping at range.
  assert.deepEqual(actionIndication("FOLLOW", 77, 50), { kind: "approach", range: 50 });
  assert.deepEqual(actionIndication("FOLLOW", 77, 0), { kind: "approach", range: 0 });
  assert.deepEqual(actionIndication("FOLLOW", 77, 51), { kind: "keepAtRange", range: 51 });
  assert.deepEqual(actionIndication("FOLLOW", 77, 25), { kind: "keepAtRange", range: 25 }, "nearer than an approach is still keeping at range");
  assert.deepEqual(actionIndication("FOLLOW", 77, 2_500), { kind: "keepAtRange", range: 2_500 });
  // An orbit at 50 m is still an orbit.
  assert.deepEqual(actionIndication("ORBIT", 77, 50), { kind: "orbit", range: 50 });
  // The mode's name however it is cased.
  assert.deepEqual(actionIndication(" orbit ", 77, 5_000), { kind: "orbit", range: 5_000 });
});

test("nothing is said when the ship follows nothing, is doing something else, or the range is not known", () => {
  assert.equal(actionIndication("ORBIT", null, 5_000), null);
  assert.equal(actionIndication("ORBIT", 0, 5_000), null);
  assert.equal(actionIndication("ORBIT", undefined, 5_000), null);
  assert.equal(actionIndication("GOTO", 77, 5_000), null);
  assert.equal(actionIndication("STOP", 77, 50), null);
  assert.equal(actionIndication("WARP", 77, 50), null);
  assert.equal(actionIndication(null, 77, 50), null);
  // The gateway's snapshot gives no range: an approach cannot be told from keeping at range, so nothing.
  assert.equal(actionIndication("FOLLOW", 77, null), null);
  assert.equal(actionIndication("FOLLOW", 77, undefined), null);
  assert.equal(actionIndication("ORBIT", 77, Number.NaN), null);
});

test("the labels asked for are a header and a line beneath for each of the three", () => {
  assert.deepEqual(INDICATION_LABELS, {
    orbit: { header: "UI/Inflight/Messages/OrbitingHeader", sub: "UI/Inflight/Messages/OrbitingSubText" },
    approach: { header: "UI/Inflight/Messages/ApproachingHeader", sub: "UI/Inflight/Messages/ApproachingSubText" },
    keepAtRange: { header: "UI/Inflight/Messages/KeepingAtRangeHeader", sub: "UI/Inflight/Messages/KeepingAtRangeSubText" },
  });
  assert.equal(INDICATION_WORD_LABELS.length, 6);
  assert.equal(new Set(INDICATION_WORD_LABELS).size, 6);
});

test("worded by the client's labels when the page holds them: the name, and the range in the order with no decimals", () => {
  const templates = {
    [INDICATION_LABELS.orbit.header]: "In orbit",
    [INDICATION_LABELS.orbit.sub]: "{targetName} / {rangeText}",
    [INDICATION_LABELS.approach.header]: "Closing",
    [INDICATION_LABELS.approach.sub]: "on {targetName}",
    [INDICATION_LABELS.keepAtRange.header]: "Standing off",
    [INDICATION_LABELS.keepAtRange.sub]: "{targetName} / {rangeText}\n",
  };
  const grouped = (value: number) => value.toLocaleString();
  assert.deepEqual(indicationText({ kind: "orbit", range: 5_000 }, "Gun I", templates), { header: "In orbit", sub: `Gun I / ${grouped(5000)} m` });
  assert.deepEqual(indicationText({ kind: "orbit", range: 12_400 }, "Gun I", templates), { header: "In orbit", sub: "Gun I / 12 km" });
  // No decimals, even where FmtDist would otherwise keep them.
  assert.equal(indicationText({ kind: "orbit", range: 0.9 }, "Gun I", templates).sub, "Gun I / 0 m");
  assert.deepEqual(indicationText({ kind: "approach", range: 50 }, "Gun I", templates), { header: "Closing", sub: "on Gun I" });
  // A line the client ends with a line break has it taken off.
  assert.deepEqual(indicationText({ kind: "keepAtRange", range: 2_500 }, "Gun I", templates), { header: "Standing off", sub: `Gun I / ${grouped(2500)} m` });
  // The unit is put on by whoever the caller gives.
  assert.equal(indicationText({ kind: "orbit", range: 5_000 }, "Gun I", templates, (unit, figure) => `${figure} of ${unit}`).sub, `Gun I / ${grouped(5000)} of m`);
});

test("without the client's words the page's own stand in, a label at a time", () => {
  const grouped = (value: number) => value.toLocaleString();
  assert.deepEqual(indicationText({ kind: "orbit", range: 5_000 }, "Gun I", {}), { header: "Orbiting", sub: `Gun I, at ${grouped(5000)} m` });
  assert.deepEqual(indicationText({ kind: "approach", range: 50 }, "Gun I", {}), { header: "Approaching", sub: "Gun I" });
  assert.deepEqual(indicationText({ kind: "keepAtRange", range: 2_500 }, "Gun I", {}), { header: "Holding range on", sub: `Gun I, at ${grouped(2500)} m` });
  // The header to hand and the line beneath not (asked for and not found): each on its own.
  const half = { [INDICATION_LABELS.orbit.header]: "In orbit", [INDICATION_LABELS.orbit.sub]: null };
  assert.deepEqual(indicationText({ kind: "orbit", range: 5_000 }, "Gun I", half), { header: "In orbit", sub: `Gun I, at ${grouped(5000)} m` });
});

test("the snapshot's own ship: its mode and range from the ship, whom it follows from its own row", () => {
  const snapshot = (ship: Record<string, unknown> | null, target: number | null): SpaceSnapshot => ({
    inSpace: true, solarSystemID: 30000142, shipID: 9001, sampledAtMs: 1,
    ship: ship === null ? null : { itemID: 9001, ...ship },
    entities: [{ itemID: 9001, isSelf: true, targetEntityID: target }, { itemID: 77, isSelf: false, targetEntityID: 9001 }],
  }) as unknown as SpaceSnapshot;
  assert.deepEqual(shipIndication(snapshot({ mode: "ORBIT", followRange: 5_000 }, 77)), { kind: "orbit", range: 5_000, followID: 77 });
  assert.deepEqual(shipIndication(snapshot({ mode: "FOLLOW", followRange: 50 }, 77)), { kind: "approach", range: 50, followID: 77 });
  // Its own row follows nothing; no range; no ship; no snapshot.
  assert.equal(shipIndication(snapshot({ mode: "ORBIT", followRange: 5_000 }, null)), null);
  assert.equal(shipIndication(snapshot({ mode: "ORBIT" }, 77)), null);
  assert.equal(shipIndication(snapshot(null, 77)), null);
  assert.equal(shipIndication(null), null);
  // Whom ANOTHER ship follows is not the pilot's business here.
  const other = snapshot({ mode: "ORBIT", followRange: 5_000 }, null);
  assert.equal(shipIndication(other), null);
});

test("the header alone: the client's word when the page holds it, the page's own otherwise", () => {
  assert.equal(indicationHeader("approach", {}), "Approaching");
  assert.equal(indicationHeader("orbit", { [INDICATION_LABELS.orbit.header]: "In orbit" }), "In orbit");
  assert.equal(indicationHeader("keepAtRange", { [INDICATION_LABELS.keepAtRange.header]: null }), "Holding range on");
  assert.equal(indicationHeader("orbit", { [INDICATION_LABELS.approach.header]: "Closing" }), "Orbiting", "each kind by its own label");
});
