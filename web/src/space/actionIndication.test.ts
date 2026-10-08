// What the ship is doing, by the rule of the retail client's HUD. The templates
// here are made up, in the shape of the client's: a header with no parameters,
// and a line beneath with {targetName} and, for two of the three, {rangeText}.

import test from "node:test";
import assert from "node:assert/strict";

import {
  ALIGNED_ANGLE, APPROACH_RANGE, CLOSE_DISTANCE, INDICATION_LABELS, INDICATION_WORD_LABELS, MAX_APPROACH_DISTANCE,
  ALIGN_LABELS, SHIP_STOPPING_LABEL, SHIP_STOPPING_MS, WARP_LABELS,
  actionIndication, alignIndication, alignText, indicationHeader, indicationText, pointIndication, pointText, shipIndication, shipStoppingText, warpIndication, warpText,
} from "./actionIndication.ts";
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

test("the labels asked for are a header and a line beneath for each of the five, each asked for once", () => {
  assert.deepEqual(INDICATION_LABELS, {
    orbit: { header: "UI/Inflight/Messages/OrbitingHeader", sub: "UI/Inflight/Messages/OrbitingSubText" },
    approach: { header: "UI/Inflight/Messages/ApproachingHeader", sub: "UI/Inflight/Messages/ApproachingSubText" },
    keepAtRange: { header: "UI/Inflight/Messages/KeepingAtRangeHeader", sub: "UI/Inflight/Messages/KeepingAtRangeSubText" },
    approachPoint: { header: "UI/Inflight/Messages/ApproachingHeader", sub: "UI/Inflight/Messages/ApproachingPointSubText" },
    alignPoint: { header: "UI/Inflight/Messages/AligningHeader", sub: "UI/Inflight/Messages/AligningToPointSubText" },
  });
  // Approaching a thing and approaching a point share a header: nine labels, not ten. And six for a warp.
  // ...three for what was aligned to, and one for a stop.
  assert.equal(INDICATION_WORD_LABELS.length, 19);
  assert.equal(new Set(INDICATION_WORD_LABELS).size, 19);
  for (const label of [...Object.values(ALIGN_LABELS), SHIP_STOPPING_LABEL]) assert.ok(INDICATION_WORD_LABELS.includes(label), label);
  for (const label of Object.values(WARP_LABELS)) assert.ok(INDICATION_WORD_LABELS.includes(label), label);
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

// --- flying to a point ---------------------------------------------------------

const HERE = { x: 0, y: 0, z: 0 };
const along = (metres: number) => ({ x: metres, y: 0, z: 0 });

test("flying to a point: nothing when it is close, approaching up to 10,000 km, and beyond that aligning until the course is on it", () => {
  assert.deepEqual([CLOSE_DISTANCE, MAX_APPROACH_DISTANCE, ALIGNED_ANGLE], [1_000, 10_000_000, 0.26]);
  const ahead = { x: 300, y: 0, z: 0 };
  // Under a kilometre: nothing, whichever way it is heading.
  assert.equal(pointIndication("GOTO", HERE, ahead, along(999)), null);
  // From a kilometre to 10,000 km: approaching, whichever way it is heading.
  assert.deepEqual(pointIndication("GOTO", HERE, ahead, along(1_000)), { kind: "approachPoint" });
  assert.deepEqual(pointIndication("GOTO", HERE, { x: -300, y: 0, z: 0 }, along(10_000_000)), { kind: "approachPoint" });
  // Farther: aligning while the course is off it...
  const far = along(10_000_001);
  assert.deepEqual(pointIndication("GOTO", HERE, { x: 0, y: 300, z: 0 }, far), { kind: "alignPoint" });
  assert.deepEqual(pointIndication("GOTO", HERE, { x: -300, y: 0, z: 0 }, far), { kind: "alignPoint" });
  // ...and nothing once it is within 0.26 radians of it.
  const off = (radians: number) => ({ x: 300 * Math.cos(radians), y: 300 * Math.sin(radians), z: 0 });
  assert.equal(pointIndication("GOTO", HERE, off(0), far), null);
  assert.equal(pointIndication("GOTO", HERE, off(0.25), far), null);
  assert.deepEqual(pointIndication("GOTO", HERE, off(0.27), far), { kind: "alignPoint" });
  // A ship standing still heads nowhere: it has yet to turn.
  assert.deepEqual(pointIndication("GOTO", HERE, HERE, far), { kind: "alignPoint" });
  assert.deepEqual(pointIndication("GOTO", HERE, null, far), { kind: "alignPoint" });
  // The distance is between the ship and the point, wherever the two are.
  assert.equal(pointIndication("GOTO", { x: 5e11, y: 2e11, z: -3e11 }, ahead, { x: 5e11 + 500, y: 2e11, z: -3e11 }), null);
  assert.deepEqual(pointIndication("GOTO", { x: 5e11, y: 2e11, z: -3e11 }, ahead, { x: 5e11, y: 2e11 + 4_000, z: -3e11 }), { kind: "approachPoint" });
});

test("flying to a point says nothing when the ship is doing something else, or where and whither are not known", () => {
  const far = along(5_000_000);
  assert.equal(pointIndication("ORBIT", HERE, HERE, far), null);
  assert.equal(pointIndication("STOP", HERE, HERE, far), null);
  assert.equal(pointIndication("WARP", HERE, HERE, far), null);
  assert.equal(pointIndication(null, HERE, HERE, far), null);
  assert.equal(pointIndication("GOTO", null, HERE, far), null);
  assert.equal(pointIndication("GOTO", HERE, HERE, null), null, "the gateway's snapshot gives no point");
  assert.equal(pointIndication("GOTO", HERE, HERE, { x: Number.NaN, y: 0, z: 0 }), null);
  assert.deepEqual(pointIndication(" goto ", HERE, HERE, far), { kind: "approachPoint" });
});

test("the line for a ship flying to a point is the client's line beneath its header, or the page's own", () => {
  const templates = { [INDICATION_LABELS.approachPoint.sub]: "Closing on a spot", [INDICATION_LABELS.alignPoint.sub]: "<b>Swinging</b> round\n" };
  assert.equal(pointText("approachPoint", templates), "Closing on a spot");
  assert.equal(pointText("alignPoint", templates), "Swinging round");
  assert.equal(pointText("approachPoint", {}), "Heading for a point in space");
  assert.equal(pointText("alignPoint", { [INDICATION_LABELS.alignPoint.sub]: null }), "Turning towards a point in space");
  // And its header, for where there is room for a word.
  assert.equal(indicationHeader("approachPoint", {}), "Approaching");
  assert.equal(indicationHeader("alignPoint", {}), "Aligning");
  assert.equal(indicationHeader("alignPoint", { [INDICATION_LABELS.alignPoint.header]: "Coming about" }), "Coming about");
});

test("the snapshot's own ship: what it follows comes first, and failing that the point it is flying to", () => {
  const snapshot = (ship: Record<string, unknown>, target: number | null): SpaceSnapshot => ({
    inSpace: true, solarSystemID: 30000142, shipID: 9001, sampledAtMs: 1,
    ship: { itemID: 9001, position: HERE, velocity: HERE, ...ship },
    entities: [{ itemID: 9001, isSelf: true, targetEntityID: target }],
  }) as unknown as SpaceSnapshot;
  assert.deepEqual(shipIndication(snapshot({ mode: "GOTO", gotoPoint: along(50_000) }, null)), { kind: "approachPoint" });
  assert.deepEqual(shipIndication(snapshot({ mode: "GOTO", gotoPoint: along(5e10) }, null)), { kind: "alignPoint" });
  assert.equal(shipIndication(snapshot({ mode: "GOTO", gotoPoint: along(500) }, null)), null);
  assert.equal(shipIndication(snapshot({ mode: "GOTO" }, null)), null);
  // Orbiting something, with a point left over from before: it is orbiting.
  assert.deepEqual(shipIndication(snapshot({ mode: "ORBIT", followRange: 5_000, gotoPoint: along(50_000) }, 77)), { kind: "orbit", range: 5_000, followID: 77 });
});

// --- in warp -------------------------------------------------------------------

const AU = 149_597_870_700;
const warping = (warp: Record<string, unknown> | null, extra: Record<string, unknown> = {}): SpaceSnapshot => ({
  inSpace: true, solarSystemID: 30000142, shipID: 9001, sampledAtMs: 1,
  ship: { itemID: 9001, mode: "WARP", position: HERE, velocity: HERE, warp, ...extra },
  entities: [
    { itemID: 9001, isSelf: true, targetEntityID: null, position: HERE },
    { itemID: 40009089, isSelf: false, targetEntityID: null, name: "A moon", position: along(2 * AU) },
  ],
}) as unknown as SpaceSnapshot;

test("in warp: lining up or under way, and how far the thing the warp is aimed at still is", () => {
  const point = along(2 * AU - 5_000_000);
  // Aimed at the moon: the distance is to the moon itself.
  assert.deepEqual(warpIndication(warping({ preparing: true, point, destinationID: 40009089 })), { kind: "warpPreparing", destinationID: 40009089, distance: 2 * AU });
  assert.deepEqual(warpIndication(warping({ preparing: false, point, destinationID: 40009089 })), { kind: "warpActive", destinationID: 40009089, distance: 2 * AU });
  // Aimed at no thing the page can name: the distance is to the warp's own point.
  assert.deepEqual(warpIndication(warping({ preparing: false, point, destinationID: null })), { kind: "warpActive", destinationID: null, distance: 2 * AU - 5_000_000 });
  // Aimed at a thing that is not in view: the same.
  assert.deepEqual(warpIndication(warping({ preparing: false, point, destinationID: 777 })), { kind: "warpActive", destinationID: null, distance: 2 * AU - 5_000_000 });
  // The distance is from where the ship is.
  assert.equal(warpIndication(warping({ preparing: false, point, destinationID: 40009089 }, { position: along(AU) }))?.distance, AU);
});

test("nothing is said of a warp the ship is not in, or one the server has given no point for", () => {
  const point = along(AU);
  assert.equal(warpIndication(warping(null)), null, "the gateway's snapshot says nothing of a warp");
  assert.equal(warpIndication(warping({ preparing: true, point: null, destinationID: 40009089 })), null);
  assert.equal(warpIndication(warping({ preparing: false, point, destinationID: null }, { mode: "STOP" })), null, "a warp left over on a ship that has stopped");
  assert.equal(warpIndication(warping({ preparing: false, point, destinationID: null }, { mode: "GOTO" })), null);
  assert.equal(warpIndication(null), null);
  // The ship's line asks about the warp before anything else.
  assert.deepEqual(shipIndication(warping({ preparing: false, point, destinationID: null })), { kind: "warpActive", destinationID: null, distance: AU });
});

test("the warp's header is the client's word for lining up or for being under way", () => {
  assert.equal(indicationHeader("warpPreparing", {}), "Lining up for warp");
  assert.equal(indicationHeader("warpActive", {}), "In warp");
  const templates = { [WARP_LABELS.warpPreparing]: "Finding the line", [WARP_LABELS.warpActive]: "Drive on" };
  assert.equal(indicationHeader("warpPreparing", templates), "Finding the line");
  assert.equal(indicationHeader("warpActive", templates), "Drive on");
});

test("the line beneath a warp's header: where to and how far, put together as the client puts it together", () => {
  // Made-up templates in the client's shapes: a destination line, a distance line, and the two that join them.
  const templates = {
    [WARP_LABELS.destination]: "Bound for {destinationName}",
    [WARP_LABELS.distance]: "Still {distToItem}",
    [WARP_LABELS.withDistance]: "{warpDestination}{distance}",
    [WARP_LABELS.withDistanceAndBubble]: "{warpDestination}{distance} to the tunnel's end",
  };
  // Aimed at a named thing: its line, a break, the distance (FmtDist, two decimals for AU).
  assert.equal(warpText({ kind: "warpActive", destinationID: 40009089, distance: 2 * AU }, "A moon", templates), "Bound for A moon · Still 2.00 AU");
  assert.equal(warpText({ kind: "warpPreparing", destinationID: 40009089, distance: 150_000_000 }, "A moon", templates), `Bound for A moon · Still ${(150000).toLocaleString()} km`);
  // Aimed at nothing the client can name: no destination line, and the other joining label.
  assert.equal(warpText({ kind: "warpActive", destinationID: null, distance: 2 * AU }, null, templates), "Still 2.00 AU to the tunnel's end");
  // A name with no thing behind it is not used.
  assert.equal(warpText({ kind: "warpActive", destinationID: null, distance: 2 * AU }, "A moon", templates), "Still 2.00 AU to the tunnel's end");
  // A thing with no name to give is treated as no thing.
  assert.equal(warpText({ kind: "warpActive", destinationID: 40009089, distance: 2 * AU }, null, templates), "Still 2.00 AU to the tunnel's end");
  // No distance left: the destination's line alone, or nothing at all.
  assert.equal(warpText({ kind: "warpActive", destinationID: 40009089, distance: 0 }, "A moon", templates), "Bound for A moon");
  assert.equal(warpText({ kind: "warpActive", destinationID: null, distance: 0 }, null, templates), "");
  // The unit is put on by whoever the caller gives.
  assert.equal(warpText({ kind: "warpActive", destinationID: 40009089, distance: 2 * AU }, "A moon", templates, (unit, figure) => `${figure} of ${unit}`), "Bound for A moon · Still 2.00 of au");
});

test("without all of the client's four labels for it, the warp's line is the page's own", () => {
  assert.equal(warpText({ kind: "warpActive", destinationID: 40009089, distance: 2 * AU }, "A moon", {}), "To A moon · 2.00 AU to go");
  assert.equal(warpText({ kind: "warpActive", destinationID: null, distance: 2 * AU }, null, {}), "2.00 AU to go");
  assert.equal(warpText({ kind: "warpActive", destinationID: 40009089, distance: 0 }, "A moon", {}), "To A moon");
  assert.equal(warpText({ kind: "warpActive", destinationID: null, distance: 0 }, null, {}), "");
  // One of the four missing is none of them: a line half in each would be neither.
  for (const missing of [WARP_LABELS.destination, WARP_LABELS.distance, WARP_LABELS.withDistance, WARP_LABELS.withDistanceAndBubble]) {
    const templates: Record<string, string | null> = {
      [WARP_LABELS.destination]: "Bound for {destinationName}", [WARP_LABELS.distance]: "Still {distToItem}",
      [WARP_LABELS.withDistance]: "{warpDestination}{distance}", [WARP_LABELS.withDistanceAndBubble]: "{warpDestination}{distance} more",
    };
    templates[missing] = null;
    assert.equal(warpText({ kind: "warpActive", destinationID: 40009089, distance: 2 * AU }, "A moon", templates), "To A moon · 2.00 AU to go", missing);
  }
});

// --- after an align ------------------------------------------------------------

const aligned = (alignTarget: unknown, extra: Record<string, unknown> = {}): SpaceSnapshot => ({
  inSpace: true, solarSystemID: 30000142, shipID: 9001, sampledAtMs: 1,
  ship: { itemID: 9001, mode: "GOTO", position: HERE, velocity: { x: 300, y: 0, z: 0 }, gotoPoint: along(1e17), alignTarget, ...extra },
  entities: [{ itemID: 9001, isSelf: true, targetEntityID: null, position: HERE }],
}) as unknown as SpaceSnapshot;

test("after an align the ship is aligning to what was named, for as long as it flies that course", () => {
  assert.deepEqual(alignIndication(aligned({ itemID: 40009089, bookmark: false })), { kind: "alignTo", targetID: 40009089, bookmark: false });
  assert.deepEqual(alignIndication(aligned({ itemID: null, bookmark: true })), { kind: "alignTo", targetID: null, bookmark: true });
  // A bookmark has no thing behind it, whatever else is said.
  assert.deepEqual(alignIndication(aligned({ itemID: 5, bookmark: true })), { kind: "alignTo", targetID: null, bookmark: true });
  // Nothing aligned to; or the ship is doing something else; or there is no ship.
  assert.equal(alignIndication(aligned(null)), null);
  assert.equal(alignIndication(aligned(undefined)), null);
  assert.equal(alignIndication(aligned({ itemID: 40009089, bookmark: false }, { mode: "STOP" })), null);
  assert.equal(alignIndication(null), null);
  // It comes before the rule for a point: lined up on it, where a point would say nothing, the ship is still aligning.
  assert.equal(pointIndication("GOTO", HERE, { x: 300, y: 0, z: 0 }, along(1e17)), null);
  assert.deepEqual(shipIndication(aligned({ itemID: 40009089, bookmark: false })), { kind: "alignTo", targetID: 40009089, bookmark: false });
  assert.equal(shipIndication(aligned(null)), null);
  // And near a point, where the rule for a point would say "approaching", it is still aligning.
  assert.deepEqual(pointIndication("GOTO", HERE, { x: 300, y: 0, z: 0 }, along(50_000)), { kind: "approachPoint" });
  assert.deepEqual(shipIndication(aligned({ itemID: 40009089, bookmark: false }, { gotoPoint: along(50_000) })), { kind: "alignTo", targetID: 40009089, bookmark: false });
});

test("the line after an align: the name after the header, or the client's whole line for a bookmark or the unnameable", () => {
  const templates = {
    [INDICATION_LABELS.alignPoint.header]: "Coming about",
    [ALIGN_LABELS.location]: "towards {targetName}",
    [ALIGN_LABELS.bookmark]: "Coming about to a saved place",
    [ALIGN_LABELS.unknown]: "Coming about to who knows where\n",
  };
  assert.equal(alignText({ kind: "alignTo", targetID: 40009089, bookmark: false }, "A moon", templates), "Coming about towards A moon");
  assert.equal(alignText({ kind: "alignTo", targetID: null, bookmark: true }, null, templates), "Coming about to a saved place");
  assert.equal(alignText({ kind: "alignTo", targetID: null, bookmark: true }, "A moon", templates), "Coming about to a saved place", "a bookmark is not named after a thing");
  assert.equal(alignText({ kind: "alignTo", targetID: 40009089, bookmark: false }, null, templates), "Coming about to who knows where");
  // The page's own words, a label at a time.
  assert.equal(alignText({ kind: "alignTo", targetID: 40009089, bookmark: false }, "A moon", {}), "Aligning A moon");
  assert.equal(alignText({ kind: "alignTo", targetID: null, bookmark: true }, null, {}), "Turning towards a saved location");
  assert.equal(alignText({ kind: "alignTo", targetID: 40009089, bookmark: false }, null, {}), "Turning towards somewhere out of sight");
  assert.equal(indicationHeader("alignTo", {}), "Aligning");
  assert.equal(indicationHeader("alignTo", templates), "Coming about");
});

test("the passing word after a stop is ordered is the client's, for two seconds", () => {
  assert.equal(SHIP_STOPPING_MS, 2_000);
  assert.equal(SHIP_STOPPING_LABEL, "UI/Inflight/Messages/ShipStoppingHeader");
  assert.equal(shipStoppingText({}), "Stopping the ship");
  assert.equal(shipStoppingText({ [SHIP_STOPPING_LABEL]: " Heaving to " }), "Heaving to");
  assert.equal(shipStoppingText({ [SHIP_STOPPING_LABEL]: null }), "Stopping the ship");
});
