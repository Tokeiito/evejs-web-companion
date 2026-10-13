// Combat positioning — guarding the arithmetic, not the flying.
//
// Numbers used throughout: THREAT_BUFFER_M 5000, LEASH_BUFFER_M 3000,
// RANGE_HYSTERESIS_M 2000. The base fit is one gun with 40 km of loaded reach and
// a 30 km optimal under 60 km of lock range, so its ceiling is
// min(40000, 60000) - 3000 = 37000.

import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_CLOSE_TICKS,
  RAT_COMBAT_ATTRIBUTE_IDS,
  inReach,
  holdNeedsReissue,
  ratCombatFromAttributes,
  ratReachM,
  wantedHold,
  type HoldInputs,
  type RatCombatFacts,
  type WeaponReach,
} from "./combatPosition.ts";
import { LEASH_BUFFER_M, RANGE_HYSTERESIS_M, THREAT_BUFFER_M } from "./kiteBand.ts";

const NO_FACTS: RatCombatFacts = {
  missile: null,
  optimalM: null,
  falloffM: null,
  trackingSpeed: null,
  attackRangeM: null,
  orbitRangeM: null,
  maxVelocity: null,
};

function gun(moduleID: number, reachM: number | null, optimalM: number | null): WeaponReach {
  return { moduleID, reachM, optimalM };
}

function inputs(over: Partial<HoldInputs> = {}): HoldInputs {
  return {
    weapons: [gun(1, 40_000, 30_000)],
    hasCombatDrones: false,
    droneControlRangeM: null,
    lockRangeM: 60_000,
    gridRatReachM: 0,
    scramFloorM: 0,
    targetDistanceM: null,
    target: null,
    ownMaxVelocity: null,
    closingSpent: false,
    ...over,
  };
}

function hold(over: Partial<HoldInputs> = {}) {
  const h = wantedHold(inputs(over));
  assert.notEqual(h, null);
  return h!;
}

// ─── ratCombatFromAttributes / ratReachM ─────────────────────────────────────

test("attribute ids are the seven the spec names, and frozen", () => {
  assert.deepEqual([...RAT_COMBAT_ATTRIBUTE_IDS].sort((a, b) => a - b), [
    37, 54, 158, 160, 247, 416, 507,
  ]);
  assert.ok(Object.isFrozen(RAT_COMBAT_ATTRIBUTE_IDS));
});

test("an empty or null attribute table is all null, missile included", () => {
  assert.deepEqual(ratCombatFromAttributes({}), NO_FACTS);
  assert.deepEqual(ratCombatFromAttributes(null), NO_FACTS);
});

test("attribute 507 present and positive marks a missile rat", () => {
  const facts = ratCombatFromAttributes({ 507: 209, 37: 300, 416: 5000 });
  assert.equal(facts.missile, true);
  assert.equal(facts.maxVelocity, 300);
  assert.equal(facts.orbitRangeM, 5000);
  assert.equal(facts.optimalM, null);
});

test("a non-empty table without 507 is a turret rat, not an unknown", () => {
  const facts = ratCombatFromAttributes({ 54: 12000, 158: 6000, 160: 0.5, 247: 20000 });
  assert.equal(facts.missile, false);
  assert.equal(facts.optimalM, 12000);
  assert.equal(facts.falloffM, 6000);
  assert.equal(facts.trackingSpeed, 0.5);
  assert.equal(facts.attackRangeM, 20000);
});

test("a zero 507 is not a missile rat", () => {
  assert.equal(ratCombatFromAttributes({ 507: 0, 54: 1000 }).missile, false);
});

test("ratReachM is the larger of attack range and optimal plus falloff", () => {
  assert.equal(ratReachM({ ...NO_FACTS, attackRangeM: 20000, optimalM: 5000, falloffM: 5000 }), 20000);
  assert.equal(ratReachM({ ...NO_FACTS, attackRangeM: 8000, optimalM: 12000, falloffM: 6000 }), 18000);
  assert.equal(ratReachM({ ...NO_FACTS, optimalM: 9000 }), 9000);
  assert.equal(ratReachM(NO_FACTS), 0);
  assert.equal(ratReachM(null), 0);
});

// ─── inReach ─────────────────────────────────────────────────────────────────

test("inReach: entering needs reach minus hysteresis", () => {
  assert.equal(inReach(9_500, 10_000, false), true);
  assert.equal(inReach(9_501, 10_000, false), false);
});

test("inReach: staying allows reach plus hysteresis", () => {
  assert.equal(inReach(10_500, 10_000, true), true);
  assert.equal(inReach(10_501, 10_000, true), false);
});

test("inReach: no previous state uses the plain edge", () => {
  assert.equal(inReach(10_000, 10_000, null), true);
  assert.equal(inReach(10_001, 10_000, null), false);
});

test("inReach fails open on an unknown reach", () => {
  assert.equal(inReach(500_000, null, false), true);
  assert.equal(inReach(null, null, false), true);
});

test("inReach keeps the previous answer on an unknown distance, true when there is none", () => {
  assert.equal(inReach(null, 10_000, false), false);
  assert.equal(inReach(null, 10_000, true), true);
  assert.equal(inReach(null, 10_000, null), true);
});

test("inReach: a short gun's hysteresis is capped so it can still be entered", () => {
  // 1 km reach: a 500 m hysteresis would demand 500 m to enter; the cap is a quarter.
  assert.equal(inReach(750, 1_000, false), true);
  assert.equal(inReach(751, 1_000, false), false);
});

// ─── wantedHold: gun boat ────────────────────────────────────────────────────

test("no guns and no combat drones: nothing to position for", () => {
  assert.equal(wantedHold(inputs({ weapons: [], hasCombatDrones: false })), null);
});

test("reason kite: out-ranging a known grid keeps range at their reach plus the buffer", () => {
  const h = hold({ gridRatReachM: 20_000 });
  assert.equal(h.order, "keepAtRange");
  assert.equal(h.rangeM, 20_000 + THREAT_BUFFER_M);
  assert.equal(h.kiting, true);
  assert.equal(h.reason, "kite");
  assert.equal(h.ceilingM, 40_000 - LEASH_BUFFER_M);
});

test("the kiting boundary: exactly at the buffer is not kiting", () => {
  const at = hold({ gridRatReachM: 40_000 - THREAT_BUFFER_M });
  assert.equal(at.kiting, false);
  assert.equal(at.order, "orbit");
  assert.equal(at.reason, "orbit-optimal");
  const inside = hold({ gridRatReachM: 40_000 - THREAT_BUFFER_M - 1 });
  assert.equal(inside.kiting, true);
  assert.equal(inside.order, "keepAtRange");
});

test("a kite is clamped under the ceiling", () => {
  const h = hold({ gridRatReachM: 34_999 }); // wants 39999, ceiling 37000
  assert.equal(h.reason, "kite");
  assert.equal(h.rangeM, 37_000);
});

test("a kite is lifted to the floor", () => {
  const h = hold({ gridRatReachM: 10_000, scramFloorM: 22_000 });
  assert.equal(h.reason, "kite");
  assert.equal(h.rangeM, 22_000);
  assert.equal(h.floorM, 22_000);
});

test("an unknown grid (reach 0) is never kited, however short the guns", () => {
  const h = hold({ gridRatReachM: 0, weapons: [gun(1, 8_000, 5_000)] });
  assert.equal(h.kiting, false);
  assert.equal(h.order, "orbit");
});

test("reason orbit-optimal: orbit at the optimal of the SHORTEST-reach weapon", () => {
  const h = hold({
    weapons: [gun(1, 40_000, 30_000), gun(2, 20_000, 12_000), gun(3, 60_000, 50_000)],
    gridRatReachM: 55_000,
  });
  assert.equal(h.order, "orbit");
  assert.equal(h.rangeM, 12_000);
  assert.equal(h.kiting, false);
  assert.equal(h.reason, "orbit-optimal");
});

test("a shortest weapon with no optimal orbits at its reach", () => {
  const h = hold({ weapons: [gun(1, 40_000, 30_000), gun(2, 15_000, null)] });
  assert.equal(h.rangeM, 15_000);
});

test("weapons with unknown reach are ignored for the choice when others are known", () => {
  const h = hold({ weapons: [gun(1, null, null), gun(2, 20_000, 12_000)] });
  assert.equal(h.rangeM, 12_000);
  assert.equal(h.ceilingM, 17_000);
});

test("every reach unknown: orbit at half the lock range, clamped into the band", () => {
  const h = hold({ weapons: [gun(1, null, null)], lockRangeM: 60_000 });
  assert.equal(h.order, "orbit");
  assert.equal(h.rangeM, 30_000);
  assert.equal(h.reason, "orbit-optimal");
  assert.equal(h.ceilingM, 57_000);
});

test("every reach unknown and no lock range: 10 km, no ceiling", () => {
  const h = hold({ weapons: [gun(1, null, null)], lockRangeM: null });
  assert.equal(h.rangeM, 10_000);
  assert.equal(h.ceilingM, null);
});

test("lock range shorter than the guns is the ceiling", () => {
  const h = hold({ lockRangeM: 25_000 });
  assert.equal(h.ceilingM, 22_000);
  assert.equal(h.rangeM, 22_000); // optimal 30 km clamped to the ceiling
});

test("reason empty-band: the floor above the ceiling holds at the ceiling", () => {
  const h = hold({ scramFloorM: 45_000, gridRatReachM: 10_000 });
  assert.equal(h.reason, "empty-band");
  assert.equal(h.rangeM, 37_000);
  assert.equal(h.kiting, false);
  assert.equal(h.floorM, 45_000);
});

test("reason unreachable: a faster rat orbiting inside the hold sets the hold at its distance", () => {
  const target: RatCombatFacts = { ...NO_FACTS, maxVelocity: 500, orbitRangeM: 5_000 };
  const h = hold({ target, ownMaxVelocity: 300, targetDistanceM: 8_000 });
  assert.equal(h.reason, "unreachable");
  assert.equal(h.rangeM, 8_000);
  assert.equal(h.kiting, false);
});

test("unreachable never accepts a distance inside the floor, and falls back to the rat's orbit", () => {
  const target: RatCombatFacts = { ...NO_FACTS, maxVelocity: 500, orbitRangeM: 5_000 };
  const floored = hold({ target, ownMaxVelocity: 300, targetDistanceM: 8_000, scramFloorM: 15_000 });
  assert.equal(floored.reason, "unreachable");
  assert.equal(floored.rangeM, 15_000);
  const blind = hold({ target, ownMaxVelocity: 300, targetDistanceM: null });
  assert.equal(blind.reason, "unreachable");
  assert.equal(blind.rangeM, 5_000);
});

test("a slower rat, an unknown speed, or an orbit outside the hold is not unreachable", () => {
  const slow: RatCombatFacts = { ...NO_FACTS, maxVelocity: 200, orbitRangeM: 5_000 };
  assert.equal(hold({ target: slow, ownMaxVelocity: 300 }).reason, "orbit-optimal");
  const fast: RatCombatFacts = { ...NO_FACTS, maxVelocity: 500, orbitRangeM: 5_000 };
  assert.equal(hold({ target: fast, ownMaxVelocity: null }).reason, "orbit-optimal");
  const farOrbit: RatCombatFacts = { ...NO_FACTS, maxVelocity: 500, orbitRangeM: 35_000 };
  assert.equal(hold({ target: farOrbit, ownMaxVelocity: 300 }).reason, "orbit-optimal");
  const noOrbit: RatCombatFacts = { ...NO_FACTS, maxVelocity: 500 };
  assert.equal(hold({ target: noOrbit, ownMaxVelocity: 300 }).reason, "orbit-optimal");
});

test("reason closing-spent: the current distance becomes the hold", () => {
  const h = hold({ closingSpent: true, targetDistanceM: 12_000 });
  assert.equal(h.reason, "closing-spent");
  assert.equal(h.rangeM, 12_000);
  assert.equal(h.order, "orbit");
  assert.equal(h.kiting, false);
});

test("closing-spent respects the floor and needs a known distance", () => {
  assert.equal(hold({ closingSpent: true, targetDistanceM: 12_000, scramFloorM: 20_000 }).rangeM, 20_000);
  assert.equal(hold({ closingSpent: true, targetDistanceM: null }).reason, "orbit-optimal");
});

test("closing-spent on a kite keeps the keepAtRange order but stops claiming a kite", () => {
  const h = hold({ gridRatReachM: 10_000, closingSpent: true, targetDistanceM: 30_000 });
  assert.equal(h.order, "keepAtRange");
  assert.equal(h.rangeM, 30_000);
  assert.equal(h.kiting, false);
});

test("guns decide even when drones are along", () => {
  const h = hold({ hasCombatDrones: true, droneControlRangeM: 27_500 });
  assert.equal(h.order, "orbit");
  assert.equal(h.reason, "orbit-optimal");
});

// ─── wantedHold: drone boat ──────────────────────────────────────────────────

const drones = (over: Partial<HoldInputs> = {}) =>
  inputs({ weapons: [], hasCombatDrones: true, droneControlRangeM: 27_500, ...over });

test("reason drone-band: keepAtRange at the kiteBand floor", () => {
  const h = wantedHold(drones({ scramFloorM: 15_000 }))!;
  assert.equal(h.order, "keepAtRange");
  assert.equal(h.rangeM, 15_000);
  assert.equal(h.reason, "drone-band");
  assert.equal(h.kiting, false);
  assert.equal(h.floorM, 15_000);
  assert.equal(h.ceilingM, 24_500);
});

test("a drone boat with nothing scramming holds at the far end of its leash", () => {
  const h = wantedHold(drones({ scramFloorM: 0 }))!;
  assert.equal(h.rangeM, 24_500);
  assert.equal(h.reason, "drone-band");
});

test("the drone leash is the control range, and lock range does not stand in for it", () => {
  // No control range: the 20 km fallback leash, not the 60 km lock range.
  const h = wantedHold(drones({ droneControlRangeM: null, scramFloorM: 0 }))!;
  assert.equal(h.ceilingM, 17_000);
});

test("reason empty-band for a drone boat: ceiling under the floor", () => {
  const h = wantedHold(drones({ scramFloorM: 25_000 }))!;
  assert.equal(h.reason, "empty-band");
  assert.equal(h.rangeM, 24_500);
  assert.equal(h.floorM, 25_000);
});

test("a drone boat can run out its closing budget too", () => {
  const h = wantedHold(drones({ scramFloorM: 15_000, closingSpent: true, targetDistanceM: 21_000 }))!;
  assert.equal(h.reason, "closing-spent");
  assert.equal(h.rangeM, 21_000);
});

// ─── never negative, never NaN ───────────────────────────────────────────────

test("no combination of nasty inputs yields a negative or non-finite range", () => {
  const nasty = [null, -5, 0, 1, 500, 10_000, 60_000, Number.NaN, Number.POSITIVE_INFINITY];
  for (const lockRangeM of nasty) {
    for (const reach of nasty) {
      for (const scramFloorM of [0, 5_000, 90_000, -3, Number.NaN]) {
        for (const targetDistanceM of nasty) {
          for (const closingSpent of [false, true]) {
            const h = wantedHold(
              inputs({
                lockRangeM,
                weapons: [gun(1, reach, reach)],
                scramFloorM,
                targetDistanceM,
                closingSpent,
                gridRatReachM: 12_000,
                target: { ...NO_FACTS, maxVelocity: 500, orbitRangeM: 100 },
                ownMaxVelocity: 300,
              }),
            );
            assert.ok(h !== null);
            assert.ok(Number.isFinite(h.rangeM) && h.rangeM >= 0, JSON.stringify(h));
            assert.ok(h.ceilingM === null || (Number.isFinite(h.ceilingM) && h.ceilingM >= 0));
          }
        }
      }
    }
  }
});

// ─── holdNeedsReissue ────────────────────────────────────────────────────────

test("MAX_CLOSE_TICKS matches the drone boat ladder", () => {
  assert.equal(MAX_CLOSE_TICKS, 60);
});

test("holdNeedsReissue: the same order is not re-sent", () => {
  const o = { order: "orbit", targetID: 7, rangeM: 20_000 } as const;
  assert.equal(holdNeedsReissue(o, { ...o }), false);
});

test("holdNeedsReissue: within the hysteresis is not re-sent, past it is", () => {
  const cur = { order: "orbit", targetID: 7, rangeM: 20_000 } as const;
  assert.equal(RANGE_HYSTERESIS_M, 2_000);
  assert.equal(holdNeedsReissue(cur, { ...cur, rangeM: 21_999 }), false);
  assert.equal(holdNeedsReissue(cur, { ...cur, rangeM: 18_001 }), false);
  assert.equal(holdNeedsReissue(cur, { ...cur, rangeM: 22_001 }), true);
  assert.equal(holdNeedsReissue(cur, { ...cur, rangeM: 17_999 }), true);
});

test("holdNeedsReissue: a changed order kind or target is always re-sent", () => {
  const cur = { order: "orbit", targetID: 7, rangeM: 20_000 } as const;
  assert.equal(holdNeedsReissue(cur, { ...cur, order: "keepAtRange" }), true);
  assert.equal(holdNeedsReissue(cur, { ...cur, targetID: 8 }), true);
});

test("holdNeedsReissue: no standing order is always sent", () => {
  assert.equal(holdNeedsReissue(null, { order: "orbit", targetID: 7, rangeM: 20_000 }), true);
});
