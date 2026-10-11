// A ship sent to a point in space by the page itself, held to the ship and the system the point was measured in;
// a ship aligned to a thing; and a thing approached, or kept at range.

import test from "node:test";
import assert from "node:assert/strict";

import { alignTo, approach, goToPoint, keepAtRange, APPROACH_RANGE_M, KEEP_AT_RANGE_DEFAULT_M, type FlightNow } from "./movementWrites.ts";

const [SHIP, SYSTEM] = [9988400023309, 30000144];
const POINT = { x: 1000, y: -2500.5, z: 300000000000 };
const MEASURED = { shipID: SHIP, solarSystemID: SYSTEM };
const HERE: FlightNow = { inSpace: true, shipID: SHIP, solarSystemID: SYSTEM };

/** An asker and a reader of the pilot's flight that say what was done, in order. */
function harness(now: FlightNow | Error = HERE, refusal: Error | null = null) {
  const did: string[] = [];
  const asked: unknown[][] = [];
  const act = async (service: string, method: string, args: readonly unknown[], kwargs?: unknown) => {
    did.push("sent");
    asked.push([service, method, args, kwargs ?? null]);
    if (refusal) throw refusal;
    return null;
  };
  const flightNow = async (): Promise<FlightNow> => {
    did.push("read");
    if (now instanceof Error) throw now;
    return now;
  };
  return { did, asked, act, flightNow };
}

test("the point's three go to beyonce's CmdGotoPoint, once the pilot's flight has been read", async () => {
  const { did, asked, act, flightNow } = harness();

  await goToPoint(act, flightNow, POINT, MEASURED);

  // movementFunctions.py 324: bp.CmdGotoPoint(*position), and nothing else.
  assert.deepEqual(asked, [["beyonce", "CmdGotoPoint", [1000, -2500.5, 300000000000], null]]);
  assert.deepEqual(did, ["read", "sent"]);
});

test("a point measured for another ship is not flown to", async () => {
  const { did, act, flightNow } = harness({ ...HERE, shipID: SHIP + 1 });

  await assert.rejects(goToPoint(act, flightNow, POINT, MEASURED), /The observed movement ship changed\./);
  assert.deepEqual(did, ["read"]);
});

test("nor one measured in another system", async () => {
  const { did, act, flightNow } = harness({ ...HERE, solarSystemID: SYSTEM + 1 });

  await assert.rejects(goToPoint(act, flightNow, POINT, MEASURED), /The measured movement system changed\./);
  assert.deepEqual(did, ["read"]);
});

test("nothing is sent for a pilot that is not in space", async () => {
  const { did, act, flightNow } = harness({ ...HERE, inSpace: false });

  await assert.rejects(goToPoint(act, flightNow, POINT, MEASURED), /The ship is not in space; undock first\./);
  assert.deepEqual(did, ["read"]);
});

test("a ship or a system that is not known now is not taken for the measured one", async () => {
  for (const now of [{ ...HERE, shipID: null }, { ...HERE, solarSystemID: null }]) {
    const { did, act, flightNow } = harness(now);
    await assert.rejects(goToPoint(act, flightNow, POINT, MEASURED), /changed\./);
    assert.deepEqual(did, ["read"]);
  }
});

test("what is no point, or no ship or system, never leaves: nothing is read either", async () => {
  const bad: [typeof POINT, typeof MEASURED][] = [
    [{ ...POINT, x: Number.NaN }, MEASURED],
    [{ ...POINT, y: Number.POSITIVE_INFINITY }, MEASURED],
    [{ ...POINT, z: Number.NEGATIVE_INFINITY }, MEASURED],
    [POINT, { ...MEASURED, shipID: 0 }],
    [POINT, { ...MEASURED, shipID: 1.5 }],
    [POINT, { ...MEASURED, solarSystemID: -1 }],
    [POINT, { ...MEASURED, solarSystemID: Number.NaN }],
  ];
  for (const [point, measured] of bad) {
    const { did, act, flightNow } = harness();
    await assert.rejects(goToPoint(act, flightNow, point, measured), /Unknown movement geometry or scope\./, JSON.stringify([point, measured]));
    assert.deepEqual(did, []);
  }
});

test("a flight that cannot be read sends nothing, and the failure is the caller's", async () => {
  const { did, act, flightNow } = harness(new Error("the session was lost"));

  await assert.rejects(goToPoint(act, flightNow, POINT, MEASURED), /the session was lost/);
  assert.deepEqual(did, ["read"]);
});

test("the call's refusal is the caller's, as it came", async () => {
  const { did, act, flightNow } = harness(HERE, new Error("You are warping."));

  await assert.rejects(goToPoint(act, flightNow, POINT, MEASURED), /You are warping\./);
  assert.deepEqual(did, ["read", "sent"]);
});

// ── aligned to a thing ───────────────────────────────────────────────────────

test("an align names the thing by name and no bookmark, with nothing by position, once the pilot's flight has been read", async () => {
  const { did, asked, act, flightNow } = harness();

  await alignTo(act, flightNow, 40009089);

  // menusvc.py 2790: bp.CmdAlignTo(dstID=targetID, bookmarkID=bookmarkID), and nothing else.
  assert.deepEqual(asked, [["beyonce", "CmdAlignTo", [], { dstID: 40009089, bookmarkID: null }]]);
  assert.deepEqual(did, ["read", "sent"]);
});

test("nothing is aligned for a pilot that is not in space", async () => {
  const { did, act, flightNow } = harness({ ...HERE, inSpace: false });

  await assert.rejects(alignTo(act, flightNow, 40009089), /^Error: The ship is not in space; undock first\.$/);
  assert.deepEqual(did, ["read"]);
});

test("the pilot's own ship is aligned to by no call, and a ship that is not known is not taken for the thing", async () => {
  const own = harness();
  await assert.rejects(alignTo(own.act, own.flightNow, SHIP), /^Error: A ship cannot align to itself\.$/);
  assert.deepEqual(own.did, ["read"]);

  const unknown = harness({ ...HERE, shipID: null });
  await alignTo(unknown.act, unknown.flightNow, SHIP);
  assert.deepEqual(unknown.asked, [["beyonce", "CmdAlignTo", [], { dstID: SHIP, bookmarkID: null }]]);
});

test("what is no thing never leaves: nothing is read either", async () => {
  for (const thing of [0, -40009089, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
    const { did, act, flightNow } = harness();
    await assert.rejects(alignTo(act, flightNow, thing), /^Error: That target could not be identified\.$/, String(thing));
    assert.deepEqual(did, [], String(thing));
  }
});

test("a flight that cannot be read aligns nothing, and the failure is the caller's", async () => {
  const { did, act, flightNow } = harness(new Error("the session was lost"));

  await assert.rejects(alignTo(act, flightNow, 40009089), /the session was lost/);
  assert.deepEqual(did, ["read"]);
});

test("the align's refusal is the caller's, as it came", async () => {
  const { did, act, flightNow } = harness(HERE, new Error("The pilot has no ballpark to ask: it is not in space."));

  await assert.rejects(alignTo(act, flightNow, 40009089), /The pilot has no ballpark to ask/);
  assert.deepEqual(did, ["read", "sent"]);
});

// ── an approach, and a thing kept at range ───────────────────────────────────

test("the menu's approach is one follow, the thing and the client's own fifty metres, once the pilot's flight has been read", async () => {
  const { did, asked, act, flightNow } = harness();

  await approach(act, flightNow, 40009089);

  // movementFunctions.py 302: bp.CmdFollowBall(targetID, approachRange), and nothing before it.
  assert.deepEqual(asked, [["beyonce", "CmdFollowBall", [40009089, 50], null]]);
  assert.deepEqual(did, ["read", "sent"]);
  assert.equal(APPROACH_RANGE_M, 50);
});

test("an approach told where to stop is the follow at that range", async () => {
  for (const range of [2500, 1234.5, 1_000_000]) {
    const { asked, act, flightNow } = harness();
    await approach(act, flightNow, 40009089, range);
    assert.deepEqual(asked, [["beyonce", "CmdFollowBall", [40009089, range], null]], String(range));
  }
  // Where none is said, the client's own.
  const unsaid = harness();
  await approach(unsaid.act, unsaid.flightNow, 40009089, null);
  assert.deepEqual(unsaid.asked, [["beyonce", "CmdFollowBall", [40009089, 50], null]]);
});

test("the autopilot's approach opens the throttle and then follows with no range, in that order", async () => {
  const { did, asked, act, flightNow } = harness();

  await approach(act, flightNow, 40009089, 0);

  // autopilot.py 451 to 454: park.CmdSetSpeedFraction(1.0), then park.CmdFollowBall(destinationID, 0.0).
  assert.deepEqual(asked, [["beyonce", "CmdSetSpeedFraction", [1], null], ["beyonce", "CmdFollowBall", [40009089, 0], null]]);
  assert.deepEqual(did, ["read", "sent", "sent"]);
});

test("a throttle that is refused sends no follow after it", async () => {
  const { did, asked, act, flightNow } = harness(HERE, new Error("You are warping."));

  await assert.rejects(approach(act, flightNow, 40009089, 0), /You are warping\./);
  assert.deepEqual([did, asked.length], [["read", "sent"], 1]);
});

test("a thing is kept at the range said, at a thousand metres where none is, and never nearer than the client's approach stops", async () => {
  for (const [range, sent] of [[5000, 5000], [null, 1000], [undefined, 1000], [50, 50], [49.9, 50], [10, 50], [0, 50], [2500.5, 2500.5], [1_000_000, 1_000_000]] as const) {
    const { did, asked, act, flightNow } = harness();
    await (range === undefined ? keepAtRange(act, flightNow, 40009089) : keepAtRange(act, flightNow, 40009089, range));
    // movementFunctions.py 229: bp.CmdFollowBall(targetID, followRange), and nothing before it.
    assert.deepEqual(asked, [["beyonce", "CmdFollowBall", [40009089, sent], null]], String(range));
    assert.deepEqual(did, ["read", "sent"], String(range));
  }
  assert.equal(KEEP_AT_RANGE_DEFAULT_M, 1000);
});

test("what is no distance never leaves: nothing is read either", async () => {
  for (const range of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1_000_001]) {
    const near = harness();
    await assert.rejects(approach(near.act, near.flightNow, 40009089, range), /^Error: The approach range must be a distance in metres\.$/, String(range));
    assert.deepEqual(near.did, [], String(range));
    const kept = harness();
    await assert.rejects(keepAtRange(kept.act, kept.flightNow, 40009089, range), /^Error: The range to hold must be a distance in metres\.$/, String(range));
    assert.deepEqual(kept.did, [], String(range));
  }
});

test("neither is ordered for what is no thing, for a pilot that is not in space, or about the pilot's own ship", async () => {
  for (const order of [approach, keepAtRange]) {
    for (const thing of [0, -40009089, 1.5, Number.NaN, 2 ** 53]) {
      const { did, act, flightNow } = harness();
      await assert.rejects(order(act, flightNow, thing), /^Error: That target could not be identified\.$/, `${order.name} ${thing}`);
      assert.deepEqual(did, [], `${order.name} ${thing}`);
    }
    const docked = harness({ ...HERE, inSpace: false });
    await assert.rejects(order(docked.act, docked.flightNow, 40009089), /^Error: The ship is not in space; undock first\.$/, order.name);
    assert.deepEqual(docked.did, ["read"], order.name);
    // movementFunctions._IsInvalidMovementTarget: itemID == session.shipid, and the client sends nothing.
    const own = harness();
    await assert.rejects(order(own.act, own.flightNow, SHIP), order === approach ? /^Error: A ship cannot approach itself\.$/ : /^Error: A ship cannot keep at range of itself\.$/, order.name);
    assert.deepEqual(own.did, ["read"], order.name);
    // A ship that is not known is not taken for the thing.
    const unknown = harness({ ...HERE, shipID: null });
    await order(unknown.act, unknown.flightNow, SHIP);
    assert.equal(unknown.asked.length, 1, order.name);
    // A flight that cannot be read orders nothing; and the call's refusal is the caller's, as it came.
    const unread = harness(new Error("the session was lost"));
    await assert.rejects(order(unread.act, unread.flightNow, 40009089), /the session was lost/, order.name);
    assert.deepEqual(unread.did, ["read"], order.name);
    const refused = harness(HERE, new Error("The pilot has no ballpark to ask: it is not in space."));
    await assert.rejects(order(refused.act, refused.flightNow, 40009089), /The pilot has no ballpark to ask/, order.name);
    assert.deepEqual(refused.did, ["read", "sent"], order.name);
  }
});
