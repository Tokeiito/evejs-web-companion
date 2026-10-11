// A ship sent to a point in space by the page itself, held to the ship and the system the point was measured in;
// a ship aligned to a thing; a thing approached, kept at range, or orbited; the ship stopped; and a scan result,
// a bookmark, a launch, a thing and a fleet member warped to.

import test from "node:test";
import assert from "node:assert/strict";

import { alignTo, approach, autopilotWarp, goToPoint, keepAtRange, orbit, stopShip, warpToBookmark, warpToFleetMember, warpToItem, warpToLaunch, warpToScanResult, WARP_RANGES_M, APPROACH_RANGE_M, KEEP_AT_RANGE_DEFAULT_M, ORBIT_DEFAULT_M, type FlightNow, type SitesKnown, type SitesReadIn } from "./movementWrites.ts";

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

// ── a thing orbited ──────────────────────────────────────────────────────────

test("an orbit is one call, the thing and a range: a thousand metres where none is said, cut to a whole number from ten metres and left as it is under that", async () => {
  for (const [range, sent] of [[2500, 2500], [null, 1000], [undefined, 1000], [2500.7, 2500], [10.9, 10], [10, 10], [9.99, 9.99], [5, 5], [2.5, 2.5], [0, 0], [1_000_000, 1_000_000]] as const) {
    const { did, asked, act, flightNow } = harness();
    await (range === undefined ? orbit(act, flightNow, 40009089) : orbit(act, flightNow, 40009089, range));
    // movementFunctions.py 243 and 260: float(range) under ten, int(range) from there; then bp.CmdOrbit(targetID, range).
    assert.deepEqual(asked, [["beyonce", "CmdOrbit", [40009089, sent], null]], String(range));
    assert.deepEqual(did, ["read", "sent"], String(range));
  }
  assert.equal(ORBIT_DEFAULT_M, 1000);
});

test("no orbit is ordered at what is no distance, of what is no thing, for a pilot that is not in space, or of the pilot's own ship", async () => {
  for (const range of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1_000_001]) {
    const { did, act, flightNow } = harness();
    await assert.rejects(orbit(act, flightNow, 40009089, range), /^Error: The orbit range must be a distance in metres\.$/, String(range));
    assert.deepEqual(did, [], String(range));
  }
  for (const thing of [0, -40009089, 1.5, Number.NaN, 2 ** 53]) {
    const { did, act, flightNow } = harness();
    await assert.rejects(orbit(act, flightNow, thing), /^Error: That target could not be identified\.$/, String(thing));
    assert.deepEqual(did, [], String(thing));
  }
  const docked = harness({ ...HERE, inSpace: false });
  await assert.rejects(orbit(docked.act, docked.flightNow, 40009089), /^Error: The ship is not in space; undock first\.$/);
  assert.deepEqual(docked.did, ["read"]);
  // movementFunctions._IsInvalidMovementTarget: itemID == session.shipid, and the client sends nothing.
  const own = harness();
  await assert.rejects(orbit(own.act, own.flightNow, SHIP), /^Error: A ship cannot orbit itself\.$/);
  assert.deepEqual(own.did, ["read"]);
  const unknown = harness({ ...HERE, shipID: null });
  await orbit(unknown.act, unknown.flightNow, SHIP);
  assert.deepEqual(unknown.asked, [["beyonce", "CmdOrbit", [SHIP, 1000], null]]);
  // A flight that cannot be read orders nothing; and the call's refusal is the caller's, as it came.
  const unread = harness(new Error("the session was lost"));
  await assert.rejects(orbit(unread.act, unread.flightNow, 40009089), /the session was lost/);
  assert.deepEqual(unread.did, ["read"]);
  const refused = harness(HERE, new Error("ThrottleGeneric"));
  await assert.rejects(orbit(refused.act, refused.flightNow, 40009089), /ThrottleGeneric/);
  assert.deepEqual(refused.did, ["read", "sent"]);
});

// ── the ship stopped ─────────────────────────────────────────────────────────

test("a stop is one call with nothing, once the pilot's flight has been read; and none for a pilot that is not in space", async () => {
  const { did, asked, act, flightNow } = harness();
  await stopShip(act, flightNow);
  // eveCommands.py 1104: bp.CmdStop(), and nothing with it.
  assert.deepEqual(asked, [["beyonce", "CmdStop", [], null]]);
  assert.deepEqual(did, ["read", "sent"]);

  // CmdStopShip does nothing unless the pilot is in a ship in space (eveCfg.InShipInSpace).
  const docked = harness({ ...HERE, inSpace: false });
  await assert.rejects(stopShip(docked.act, docked.flightNow), /^Error: The ship is not in space; undock first\.$/);
  assert.deepEqual(docked.did, ["read"]);
  // A ship or a system that is not known stops all the same: a stop names neither.
  const unknown = harness({ inSpace: true, shipID: null, solarSystemID: null });
  await stopShip(unknown.act, unknown.flightNow);
  assert.deepEqual(unknown.did, ["read", "sent"]);
  // A flight that cannot be read stops nothing; and the call's refusal is the caller's, as it came.
  const unread = harness(new Error("the session was lost"));
  await assert.rejects(stopShip(unread.act, unread.flightNow), /the session was lost/);
  assert.deepEqual(unread.did, ["read"]);
  const refused = harness(HERE, new Error("ThrottleGeneric"));
  await assert.rejects(stopShip(refused.act, refused.flightNow), /ThrottleGeneric/);
  assert.deepEqual(refused.did, ["read", "sent"]);
});

// ── sent into warp, to a scan result ─────────────────────────────────────────
//
// menusvc._WarpXToScanResult (1418 to 1428), from the scanner's list (scannerListEntries.py 276): the sensor suite
// is asked for a site of the result's label among its anomalies and its structures (sensorSuiteService.py 799);
// where it has one the warp is to the site's own number as an item, and by the label only where it has none.
// minRange=None and fleet=False go with both.

const KEYWORDS = { minRange: null, fleet: false };
const site = (siteID: number | string | null, targetID: string | null) => ({ siteID, targetID });
const NO_SITES: SitesKnown = { anomalies: [], structures: [] };
const readIn = (sites: SitesKnown, solarSystemID: number | null = SYSTEM): SitesReadIn => ({ ...sites, solarSystemID });

/** The harness, and a reader of the scanner that says it was read ("sites") and answers what the test gives it. */
function scanned(read: SitesKnown | Error = NO_SITES, now: FlightNow | Error = HERE, refusal: Error | null = null) {
  const made = harness(now, refusal);
  const readSites = async (): Promise<SitesKnown> => {
    made.did.push("sites");
    if (read instanceof Error) throw read;
    return read;
  };
  return { ...made, readSites };
}

test("an anomaly the page's last read has is warped to as an item, by its site's number, with no range and no fleet's word: the scanner is not read again", async () => {
  const { did, asked, act, flightNow, readSites } = scanned();
  const kept = readIn({ anomalies: [site(5380000140001, "ABC-123"), site(5380000140002, "YLD-909")], structures: [] });

  await warpToScanResult(act, flightNow, kept, readSites, "YLD-909");

  // menusvc.py 1427 and 1428: michelle.CmdWarpToStuff('item', itemID, minRange=None, fleet=False).
  assert.deepEqual(asked, [["beyonce", "CmdWarpToStuff", ["item", 5380000140002], KEYWORDS]]);
  assert.deepEqual(did, ["read", "sent"]);
});

test("a structure's site is warped to as an item too; and where an anomaly goes by the same label, it is the anomaly", async () => {
  const one = scanned();
  await warpToScanResult(one.act, one.flightNow, readIn({ anomalies: [site(5, "ABC-123")], structures: [site(1030000000001, "STR-001")] }), one.readSites, "STR-001");
  assert.deepEqual(one.asked, [["beyonce", "CmdWarpToStuff", ["item", 1030000000001], KEYWORDS]]);

  // sensorSuiteService.py 800: the anomalies are gone through first.
  const both = scanned();
  await warpToScanResult(both.act, both.flightNow, readIn({ anomalies: [site(5, "DUP-001")], structures: [site(6, "DUP-001")] }), both.readSites, "DUP-001");
  assert.deepEqual(both.asked, [["beyonce", "CmdWarpToStuff", ["item", 5], KEYWORDS]]);
});

test("a result the read has no site of its own for is warped to by its label: one that is no anomaly and no structure, and a site whose number cannot be sent", async () => {
  // menusvc.py 1425: 'scan' and the result's own ID, where the suite answers no item.
  const none = scanned();
  await warpToScanResult(none.act, none.flightNow, readIn(NO_SITES), none.readSites, "QEE-288");
  assert.deepEqual(none.asked, [["beyonce", "CmdWarpToStuff", ["scan", "QEE-288"], KEYWORDS]]);
  assert.deepEqual(none.did, ["read", "sent"]);

  const other = scanned();
  await warpToScanResult(other.act, other.flightNow, readIn({ anomalies: [site(5, "ABC-123")], structures: [site(6, "STR-001")] }), other.readSites, "QEE-288");
  assert.deepEqual(other.asked, [["beyonce", "CmdWarpToStuff", ["scan", "QEE-288"], KEYWORDS]]);

  for (const siteID of [null, "5380000140002", 0, -5, 1.5, 2 ** 60]) {
    const odd = scanned();
    await warpToScanResult(odd.act, odd.flightNow, readIn({ anomalies: [site(siteID, "YLD-909")], structures: [] }), odd.readSites, "YLD-909");
    assert.deepEqual(odd.asked, [["beyonce", "CmdWarpToStuff", ["scan", "YLD-909"], KEYWORDS]], String(siteID));
  }
});

test("where the page has no read of the scanner, or one of another system, the sites are read before the warp, and the warp goes by that read", async () => {
  const fresh: SitesKnown = { anomalies: [site(5380000140002, "YLD-909")], structures: [] };
  const stale: SitesKnown = { anomalies: [site(777, "YLD-909")], structures: [] };
  for (const kept of [null, readIn(stale, SYSTEM + 1), readIn(stale, null)]) {
    const { did, asked, act, flightNow, readSites } = scanned(fresh);
    await warpToScanResult(act, flightNow, kept, readSites, "YLD-909");
    assert.deepEqual(asked, [["beyonce", "CmdWarpToStuff", ["item", 5380000140002], KEYWORDS]], JSON.stringify(kept));
    assert.deepEqual(did, ["read", "sites", "sent"]);
  }
  // A system that is not known now is not taken for the read's, known or not.
  for (const kept of [readIn(stale, SYSTEM), readIn(stale, null)]) {
    const { did, asked, act, flightNow, readSites } = scanned(fresh, { ...HERE, solarSystemID: null });
    await warpToScanResult(act, flightNow, kept, readSites, "YLD-909");
    assert.deepEqual(asked, [["beyonce", "CmdWarpToStuff", ["item", 5380000140002], KEYWORDS]], JSON.stringify(kept));
    assert.deepEqual(did, ["read", "sites", "sent"]);
  }
});

test("nothing is warped for a pilot that is not in space; and for no label nothing is read either", async () => {
  const docked = scanned(NO_SITES, { ...HERE, inSpace: false });
  await assert.rejects(warpToScanResult(docked.act, docked.flightNow, null, docked.readSites, "YLD-909"), /The ship is not in space; undock first\./);
  assert.deepEqual(docked.did, ["read"]);

  const unnamed = scanned();
  await assert.rejects(warpToScanResult(unnamed.act, unnamed.flightNow, null, unnamed.readSites, ""), /A scan-site label is required\./);
  assert.deepEqual(unnamed.did, []);
});

test("a flight or a scanner that cannot be read warps nothing, and the warp's refusal is the caller's, as it came", async () => {
  const unread = scanned(NO_SITES, new Error("flight unreadable"));
  await assert.rejects(warpToScanResult(unread.act, unread.flightNow, null, unread.readSites, "YLD-909"), /flight unreadable/);
  assert.deepEqual(unread.did, ["read"]);

  const blind = scanned(new Error("scanner offline"));
  await assert.rejects(warpToScanResult(blind.act, blind.flightNow, null, blind.readSites, "YLD-909"), /scanner offline/);
  assert.deepEqual(blind.did, ["read", "sites"]);

  const refused = scanned(NO_SITES, HERE, new Error("You cannot warp there right now."));
  await assert.rejects(warpToScanResult(refused.act, refused.flightNow, readIn(NO_SITES), refused.readSites, "YLD-909"), /You cannot warp there right now\./);
  assert.deepEqual(refused.did, ["read", "sent"]);
});

// ── sent into warp, to a bookmark and to a launch ────────────────────────────
//
// movementFunctions.WarpToBookmark (410 to 421): CmdWarpToStuff('bookmark', bookmarkID, minRange=warpRange,
// fleet=fleet), the range the pilot's own (nought by default) and the fleet's word False. journal.py 453:
// CmdWarpToStuff('launch', launchID), and nothing else.

test("a bookmark is warped to by its number, with a range of nought and fleet=False, once the pilot's flight has been read", async () => {
  const { did, asked, act, flightNow } = harness();

  await warpToBookmark(act, flightNow, 900001732);

  assert.deepEqual(asked, [["beyonce", "CmdWarpToStuff", ["bookmark", 900001732], { minRange: 0, fleet: false }]]);
  assert.deepEqual(did, ["read", "sent"]);

  // A bookmark's number is its own: one that is the ship's number is a bookmark still.
  const same = harness();
  await warpToBookmark(same.act, same.flightNow, SHIP);
  assert.deepEqual(same.asked, [["beyonce", "CmdWarpToStuff", ["bookmark", SHIP], { minRange: 0, fleet: false }]]);
});

test("a launch is warped to by its own number, and nothing goes with it", async () => {
  const { did, asked, act, flightNow } = harness();

  await warpToLaunch(act, flightNow, 910000001);

  assert.deepEqual(asked, [["beyonce", "CmdWarpToStuff", ["launch", 910000001], null]]);
  assert.deepEqual(did, ["read", "sent"]);
});

test("neither is warped to for what is no number, where nothing is read either; nor for a pilot that is not in space", async () => {
  for (const id of [0, -4, 1.5, Number.NaN, 2 ** 60]) {
    const spot = harness();
    await assert.rejects(warpToBookmark(spot.act, spot.flightNow, id), /A bookmark is required\./, String(id));
    assert.deepEqual(spot.did, [], String(id));
    const launch = harness();
    await assert.rejects(warpToLaunch(launch.act, launch.flightNow, id), /A launch is required\./, String(id));
    assert.deepEqual(launch.did, [], String(id));
  }
  for (const warp of [warpToBookmark, warpToLaunch]) {
    const docked = harness({ ...HERE, inSpace: false });
    await assert.rejects(warp(docked.act, docked.flightNow, 900001732), /The ship is not in space; undock first\./);
    assert.deepEqual(docked.did, ["read"]);
  }
});

test("a flight that cannot be read warps to neither, and a warp's refusal is the caller's, as it came", async () => {
  for (const warp of [warpToBookmark, warpToLaunch]) {
    const unread = harness(new Error("flight unreadable"));
    await assert.rejects(warp(unread.act, unread.flightNow, 900001732), /flight unreadable/);
    assert.deepEqual(unread.did, ["read"]);
    const refused = harness(HERE, new Error("BookmarkNotAvailable"));
    await assert.rejects(warp(refused.act, refused.flightNow, 900001732), /BookmarkNotAvailable/);
    assert.deepEqual(refused.did, ["read", "sent"]);
  }
});

// ── sent into warp, to a thing, as the autopilot warps, and to a fleet member ─
//
// movementFunctions.WarpToItem (437 to 452): CmdWarpToStuff('item', itemID, minRange=warpRange), not for the pilot's
// own ship. autopilot.py 465: CmdWarpToStuffAutopilot(destinationID). menusvc.WarpToMember (2748):
// CmdWarpToStuff('char', charID, minRange=warpRange).

test("a thing is warped to as the menu warps to one: its number as an item, and the range said, once the pilot's flight has been read", async () => {
  for (const range of WARP_RANGES_M) {
    const { did, asked, act, flightNow } = harness();
    await warpToItem(act, flightNow, 50001248, range);
    assert.deepEqual(asked, [["beyonce", "CmdWarpToStuff", ["item", 50001248], { minRange: range }]], String(range));
    assert.deepEqual(did, ["read", "sent"]);
  }
  // movementFunctions.GetWarpToRanges (334 to 343): the seven the client's menu offers.
  assert.deepEqual([...WARP_RANGES_M], [0, 10000, 20000, 30000, 50000, 70000, 100000]);
});

test("a range that is none of the menu's seven never leaves: nothing is read either", async () => {
  for (const range of [5000, -1, 1, 100001, Number.NaN, Number.POSITIVE_INFINITY]) {
    const { did, act, flightNow } = harness();
    await assert.rejects(warpToItem(act, flightNow, 50001248, range), /The warp range must be one of the offered distances\./, String(range));
    assert.deepEqual(did, [], String(range));
  }
});

test("the autopilot's warp is its own call, with the thing alone", async () => {
  const { did, asked, act, flightNow } = harness();

  await autopilotWarp(act, flightNow, 50001248);

  assert.deepEqual(asked, [["beyonce", "CmdWarpToStuffAutopilot", [50001248], null]]);
  assert.deepEqual(did, ["read", "sent"]);
});

test("a fleet member is warped to by the pilot's number, with a range of nought and nothing else", async () => {
  const { did, asked, act, flightNow } = harness();

  await warpToFleetMember(act, flightNow, 140000003);

  // menusvc.py 712 and 2748: the fleet's menu gives the pilot's own warp distance, nought by default; no fleet's word.
  assert.deepEqual(asked, [["beyonce", "CmdWarpToStuff", ["char", 140000003], { minRange: 0 }]]);
  assert.deepEqual(did, ["read", "sent"]);

  // A pilot's number is its own: one that is the ship's number is a pilot still.
  const same = harness();
  await warpToFleetMember(same.act, same.flightNow, SHIP);
  assert.deepEqual(same.asked, [["beyonce", "CmdWarpToStuff", ["char", SHIP], { minRange: 0 }]]);
});

test("no warp is ordered to what has no number, where nothing is read either; nor for a pilot that is not in space; nor to the pilot's own ship, as a thing or as the autopilot's", async () => {
  const warps = {
    thing: (made: ReturnType<typeof harness>, id: number) => warpToItem(made.act, made.flightNow, id, 0),
    autopilot: (made: ReturnType<typeof harness>, id: number) => autopilotWarp(made.act, made.flightNow, id),
    member: (made: ReturnType<typeof harness>, id: number) => warpToFleetMember(made.act, made.flightNow, id),
  };
  for (const [what, warp] of Object.entries(warps)) {
    for (const id of [0, -4, 1.5, Number.NaN, 2 ** 60]) {
      const none = harness();
      await assert.rejects(warp(none, id), what === "member" ? /A fleet member is required\./ : /That target could not be identified\./, `${what} ${id}`);
      assert.deepEqual(none.did, [], `${what} ${id}`);
    }
    const docked = harness({ ...HERE, inSpace: false });
    await assert.rejects(warp(docked, 50001248), /The ship is not in space; undock first\./, what);
    assert.deepEqual(docked.did, ["read"], what);
  }
  // movementFunctions.py 438: nothing is sent for the pilot's own ship.
  for (const warp of [warps.thing, warps.autopilot]) {
    const itself = harness();
    await assert.rejects(warp(itself, SHIP), /A ship cannot warp to itself\./);
    assert.deepEqual(itself.did, ["read"]);
    // A ship that is not known is not taken for the thing.
    const unknown = harness({ ...HERE, shipID: null });
    await warp(unknown, SHIP);
    assert.deepEqual(unknown.did, ["read", "sent"]);
  }
});

test("a flight that cannot be read warps to none of the three, and a warp's refusal is the caller's, as it came", async () => {
  const warps = [
    (made: ReturnType<typeof harness>) => warpToItem(made.act, made.flightNow, 50001248, 0),
    (made: ReturnType<typeof harness>) => autopilotWarp(made.act, made.flightNow, 50001248),
    (made: ReturnType<typeof harness>) => warpToFleetMember(made.act, made.flightNow, 140000003),
  ];
  for (const warp of warps) {
    const unread = harness(new Error("flight unreadable"));
    await assert.rejects(warp(unread), /flight unreadable/);
    assert.deepEqual(unread.did, ["read"]);
    const refused = harness(HERE, new Error("You are warp scrambled."));
    await assert.rejects(warp(refused), /You are warp scrambled\./);
    assert.deepEqual(refused.did, ["read", "sent"]);
  }
});
