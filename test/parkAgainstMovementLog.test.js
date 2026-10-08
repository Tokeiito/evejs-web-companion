"use strict";

// scripts/park-against-movement-log.js: the client's park set beside the
// server's own record of where a ship was.
//
// The server's rows here are made up, in the shape eve.js writes them, from
// where the park itself has the ship at each tick of a recorded warp: so what
// the script should say about each is known beforehand.

const test = require("node:test");
const assert = require("node:assert/strict");
const { isWarping } = require("../src/gamePort/destiny/ballpark");
const { MODE } = require("../src/gamePort/destiny/state");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { beside, readMovementLog, readMovementLogs, replay, summary } = require("../scripts/park-against-movement-log");
const warped = require("./fixtures/destinyWarp.json");

const SHIP = warped.shipID;
const size = (v) => Math.hypot(v.x, v.y, v.z);
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (v, by) => ({ x: v.x * by, y: v.y * by, z: v.z * by });

/** A line of the server's movement log. */
const line = (row) => `[2026-01-02T03:04:05.678Z] ${JSON.stringify(row)}`;
const logged = (overrides = {}) => ({
  event: "tick", atMs: 5_000_250, destinyStamp: 5000, charID: 1, shipID: 77, systemID: 3, mode: "GOTO", speedFraction: 1,
  position: { x: 1, y: 2, z: 3 }, velocity: { x: 4, y: 0, z: 0 }, speed: 4, deltaSeconds: 0.108, ...overrides,
});

/** Where the park has the ship at each tick of the recorded warp, read straight off its ball: stamp -> { p, old, v, warping, mode }. */
function track(options) {
  const ticks = new Map();
  replay(warped, (park) => {
    const ball = park.validState ? park.ballpark.ball(SHIP) : null;
    if (ball && !ticks.has(park.currentTime)) {
      ticks.set(park.currentTime, { p: { ...ball.newPos }, old: { ...ball.oldPos }, v: { ...ball.newVel }, warping: isWarping(ball), mode: ball.mode });
    }
  }, options);
  return ticks;
}

/** A server row saying the ship was at `position` at `at`, in stamps. */
const rowAt = (at, position, more = {}) => ({ at, atMs: Math.round(at * 1000), stamp: Math.floor(at), event: "tick", mode: "GOTO", position, speed: null, ...more });

/** Where the park's ship is at the whole stamp `stamp`, by the rule the client draws by, from the tick after it. */
const drawnAt = (ticks, stamp) => (ticks.get(stamp + 1).warping ? ticks.get(stamp + 1).p : ticks.get(stamp + 1).old);

test("the server's log is read a row at a time: one ship's, in order of time, by the server's own stamp", () => {
  const text = [
    line(logged({ atMs: 5_002_500, destinyStamp: 5002, position: { x: 9, y: 9, z: 9 }, event: "trace.tick", mode: "WARP", speed: 7.5 })),
    line(logged()),
    "not a row at all",
    "[2026-01-02T03:04:05.678Z] not json",
    "[2026-01-02T03:04:05.678Z] {\"shipID\":77, broken",
    line(logged({ shipID: 78 })),
    line(logged({ shipID: 770 })),
    // Another ship's row that only mentions this one.
    line(logged({ shipID: 78, event: '"shipID":77,', atMs: 5_003_500, destinyStamp: 5003 })),
    // A row that does not begin as the log's lines do.
    "torn off] " + JSON.stringify(logged({ atMs: 5_003_000, destinyStamp: 5003 })),
    line(logged({ atMs: 5_001_000, destinyStamp: 5001, position: null })),
    line(logged({ atMs: 5_001_000, destinyStamp: 5001, position: { x: 1, y: "two", z: 3 } })),
    line(logged({ atMs: 5_001_000, destinyStamp: null })),
    line(logged({ atMs: null })),
    // Said twice at the same instant, as a "tick" and a "trace.tick" are: once is enough.
    line(logged({ event: "trace.tick" })),
    // The same instant somewhere else is another row.
    line(logged({ position: { x: 1, y: 2, z: 4 } })),
    // The stamp is the server's, whatever its clock's whole seconds come to.
    line(logged({ atMs: 9_999_000_750, destinyStamp: 5004, speed: undefined })),
    "",
  ].join("\n");
  assert.deepEqual(readMovementLog(text, 77), [
    { at: 5000.25, atMs: 5_000_250, stamp: 5000, event: "tick", mode: "GOTO", position: { x: 1, y: 2, z: 3 }, speed: 4 },
    { at: 5000.25, atMs: 5_000_250, stamp: 5000, event: "tick", mode: "GOTO", position: { x: 1, y: 2, z: 4 }, speed: 4 },
    { at: 5002.5, atMs: 5_002_500, stamp: 5002, event: "trace.tick", mode: "WARP", position: { x: 9, y: 9, z: 9 }, speed: 7.5 },
    { at: 5004.75, atMs: 9_999_000_750, stamp: 5004, event: "tick", mode: "GOTO", position: { x: 1, y: 2, z: 3 }, speed: null },
  ]);
  assert.deepEqual(readMovementLog(text, 78).map((row) => row.at), [5000.25, 5003.5]);
  assert.deepEqual(readMovementLog("", 77), []);
});

test("logs are read from disk a piece at a time, however a line falls across two pieces, and several as one", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "movement-log-"));
  try {
    // Each line is a little over a kilobyte, so the megabyte the reader takes at a time ends inside one.
    const filler = "x".repeat(1000);
    const rows = (from, count, shipID) => Array.from({ length: count }, (_, index) => line(logged({ shipID, atMs: (from + index) * 1000 + 250, destinyStamp: from + index, position: { x: index, y: 0, z: 0 }, filler })));
    const first = path.join(folder, "one.log");
    const second = path.join(folder, "two.log");
    fs.writeFileSync(first, [...rows(7000, 1500, 77), ...rows(7000, 700, 78)].join("\n") + "\n");
    // No line feed at the end of this one: its last line counts too.
    fs.writeFileSync(second, rows(9000, 3, 77).join("\n"));
    assert.ok(fs.statSync(first).size > 2 * (1 << 20));
    const read = readMovementLogs([second, first], 77);
    assert.equal(read.length, 1503);
    assert.deepEqual(read.map((row) => row.at), [...Array.from({ length: 1500 }, (_, index) => 7000.25 + index), 9000.25, 9001.25, 9002.25]);
    assert.deepEqual(read.at(-1).position, { x: 2, y: 0, z: 0 });
    assert.equal(readMovementLogs([first], 78).length, 700);
    assert.deepEqual(readMovementLogs([], 77), []);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test("a row on a whole stamp is set beside the park's ship of that stamp: flying, lining up, in warp and coming to rest", () => {
  const ticks = track();
  const stamps = [...ticks.keys()].filter((stamp) => ticks.has(stamp + 1));
  const rows = stamps.map((stamp) => rowAt(stamp, drawnAt(ticks, stamp)));
  const { rows: measured, unmatched, failed } = beside(warped, rows);
  assert.deepEqual([measured.length, unmatched, failed], [rows.length, 0, []]);
  assert.deepEqual(measured.map((row) => row.at), stamps);
  // Far out a double holds a place to well under a millimetre; the warp's curve is good to a hundredth of a metre.
  const worst = Math.max(...measured.map((row) => row.apart));
  assert.ok(worst < 1e-2, `${worst} m apart at worst`);
  // Every kind of flight is among them.
  const doing = new Set(measured.map((row) => row.ourMode));
  assert.deepEqual([...doing].sort(), ["GOTO", "STOP", "WARP", "in warp"]);
  // And a row is not set beside the tick before or after: the ship moved hundreds of metres in each.
  const first = stamps[0];
  const tickOn = beside(warped, [rowAt(first, drawnAt(ticks, first + 1))]).rows[0];
  assert.ok(tickOn.apart > 300 && tickOn.apart < 400, `${tickOn.apart} m`);
});

test("a row displaced from the park's ship is that far apart, whatever the ship is doing", () => {
  const ticks = track();
  const stamps = [...ticks.keys()].filter((stamp) => ticks.has(stamp + 1));
  const rows = stamps.map((stamp) => rowAt(stamp, add(drawnAt(ticks, stamp), { x: 30, y: -40, z: 0 })));
  const { rows: measured } = beside(warped, rows);
  assert.equal(measured.length, rows.length);
  for (const row of measured) assert.ok(Math.abs(row.apart - 50) < 1e-2, `${row.apart} m at ${row.at}`);
});

test("between two ticks the park's ship is placed by how far into the second the row was written", () => {
  const ticks = track();
  const first = [...ticks.keys()][0];
  // The ship flies straight at a steady 341 m/s for its first five seconds.
  const a = ticks.get(first + 2);
  const b = ticks.get(first + 3);
  assert.ok(a.mode === MODE.GOTO && size(sub(a.v, b.v)) < 1e-9 && Math.abs(size(a.v) - 341) < 1e-6);
  const quarter = add(a.p, scale(sub(b.p, a.p), 0.25));
  const [onIt, leftBehind] = beside(warped, [rowAt(first + 2.25, quarter), rowAt(first + 2.75, a.p)]).rows;
  assert.ok(onIt.apart < 1e-3, `${onIt.apart} m`);
  assert.ok(Math.abs(leftBehind.apart - 0.75 * 341) < 1e-3, `${leftBehind.apart} m`);
  assert.ok(Math.abs(onIt.ourSpeed - 341) < 1e-6);
  // Lining up for the warp the ship is turning and slowing: the place and the speed are the tick's own, part way through.
  const turning = [...ticks.keys()].find((stamp) => ticks.get(stamp).mode === MODE.WARP && !ticks.get(stamp).warping) + 1;
  const [early, late] = beside(warped, [rowAt(turning + 0.1, ticks.get(turning).p), rowAt(turning + 0.9, ticks.get(turning + 1).p)]).rows;
  const [from, to] = [size(ticks.get(turning).v), size(ticks.get(turning + 1).v)];
  assert.ok(Math.abs(from - to) > 5, `${from} to ${to} m/s in the tick`);
  assert.ok(Math.abs(early.ourSpeed - from) < Math.abs(early.ourSpeed - to) && Math.abs(late.ourSpeed - to) < Math.abs(late.ourSpeed - from), `${early.ourSpeed}, ${late.ourSpeed}`);
  assert.ok(early.apart > 10 && early.apart < 0.2 * 341 && late.apart > 10 && late.apart < 0.2 * 341, `${early.apart}, ${late.apart}`);
});

test("how much later the park's ship is where the server's was: on a straight course, and in warp by the warp's own curve", () => {
  const ticks = track();
  const first = [...ticks.keys()][0];
  const a = ticks.get(first + 2);
  // 0.43 s further on, 1.27 s back, and 12 m off to the side.
  const heading = scale(a.v, 1 / size(a.v));
  const side = (() => {
    const across = { x: -heading.z, y: 0, z: heading.x };
    return scale(across, 12 / size(across));
  })();
  const [ahead, behind, aside] = beside(warped, [
    rowAt(first + 2, add(a.p, scale(a.v, 0.43))),
    rowAt(first + 2.5, add(a.p, scale(a.v, 0.5 - 1.27))),
    rowAt(first + 3, add(add(ticks.get(first + 3).p, scale(a.v, 0.4)), side)),
  ]).rows;
  assert.ok(Math.abs(ahead.later - 0.43) < 1e-6 && ahead.closest < 1e-3 && Math.abs(ahead.apart - 0.43 * 341) < 1e-3, JSON.stringify(ahead));
  assert.ok(Math.abs(behind.later + 1.27) < 1e-6 && behind.closest < 1e-3 && Math.abs(behind.apart - 1.27 * 341) < 1e-3, JSON.stringify(behind));
  // Off to the side the nearest moment is less sharply marked: twelve metres away, a millimetre along the path changes the distance by a hair.
  assert.ok(Math.abs(aside.later - 0.4) < 1e-3 && Math.abs(aside.closest - 12) < 1e-3, JSON.stringify(aside));
  // Further off than the first reach, the search goes on that way: four seconds on, and six back.
  const [farOn, farBack, tooFar] = beside(warped, [
    rowAt(first + 2, add(a.p, scale(a.v, 4.03))),
    rowAt(first + 2, add(a.p, scale(a.v, -6.01))),
    rowAt(first + 2, add(a.p, scale(a.v, 14))),
  ]).rows;
  assert.ok(Math.abs(farOn.later - 4.03) < 1e-6 && farOn.closest < 1e-3, JSON.stringify(farOn));
  assert.ok(Math.abs(farBack.later + 6.01) < 1e-6 && farBack.closest < 1e-3, JSON.stringify(farBack));
  // And stops at ten seconds, with what is left still to go.
  assert.ok(Math.abs(tooFar.later - 10) < 0.06 && Math.abs(tooFar.closest - 4 * 341) < 0.06 * 341, JSON.stringify(tooFar));
  // In warp: a row where the park's own next tick puts the ship is one second on, to the metre, at any speed.
  const inWarp = [...ticks.keys()].filter((stamp) => [1, 2, 3].every((on) => ticks.get(stamp + on)?.warping));
  assert.ok(inWarp.length >= 15, `${inWarp.length} ticks of warp`);
  const rows = inWarp.map((stamp) => rowAt(stamp, ticks.get(stamp + 2).p));
  const measured = beside(warped, rows).rows;
  let fastest = 0;
  for (const row of measured) {
    assert.ok(Math.abs(row.later - 1) < 1e-6 && row.closest < 1, `at ${row.at - first}: later ${row.later} s, closest ${row.closest} m, of ${row.apart} m`);
    fastest = Math.max(fastest, row.apart);
  }
  assert.ok(fastest > 1e8, `${fastest} m in the fastest second`);
});

test("a ship going nowhere gives no time to read, and the distance is all there is", () => {
  const ticks = track();
  const stamps = [...ticks.keys()];
  // Coasting to a stop after its warp, down to a centimetre a second: five seconds of that is not half a metre.
  const atRest = stamps.find((stamp) => ticks.get(stamp).mode === MODE.STOP && size(ticks.get(stamp).v) < 0.02 && ticks.has(stamp + 1));
  assert.ok(atRest !== undefined, "the recording has the ship all but at rest");
  // While it still coasts at metres a second there is a time to read.
  const coasting = stamps.find((stamp) => ticks.get(stamp).mode === MODE.STOP && size(ticks.get(stamp).v) > 5 && ticks.has(stamp + 1));
  assert.notEqual(beside(warped, [rowAt(coasting, drawnAt(ticks, coasting))]).rows[0].later, null);
  const [row] = beside(warped, [rowAt(atRest, add(drawnAt(ticks, atRest), { x: 0, y: 7, z: 0 }))]).rows;
  assert.equal(row.later, null);
  assert.ok(Math.abs(row.apart - 7) < 1e-2 && row.closest === row.apart);
});

test("rows the park has no ship for are counted, not guessed at", () => {
  const ticks = track();
  const stamps = [...ticks.keys()];
  const [first, last] = [stamps[0], stamps.at(-1)];
  const somewhere = { x: 0, y: 0, z: 0 };
  const { rows, unmatched } = beside(warped, [rowAt(first - 50, somewhere), rowAt(first - 1.5, somewhere), rowAt(first + 2, ticks.get(first + 2).p), rowAt(last + 60, somewhere)]);
  assert.deepEqual([rows.length, unmatched], [1, 3]);
  assert.ok(rows[0].apart < 1e-2);
  // Another ship's rows: the park has no such ball.
  assert.deepEqual(((result) => [result.rows.length, result.unmatched])(beside(warped, [rowAt(first + 2, somewhere)], { shipID: 1 })), [0, 1]);
  assert.deepEqual(((result) => [result.rows.length, result.unmatched])(beside(warped, [])), [0, 0]);
});

test("an update stamped a tick sooner: the park's ship enters warp a tick sooner", () => {
  const entered = (ticks) => [...ticks.keys()].find((stamp) => ticks.get(stamp).warping) - [...ticks.keys()][0];
  const asSent = entered(track());
  assert.equal(entered(track({ restamp: { name: "WarpTo", by: -1 } })), asSent - 1);
  assert.equal(entered(track({ restamp: { name: "NoSuchOrder", by: -1 } })), asSent);
  // And the script's rows follow: where the ship was on its old course is no longer where the park has it.
  const ticks = track();
  const first = [...ticks.keys()][0];
  const turning = first + asSent - 3;
  const row = rowAt(turning, drawnAt(ticks, turning));
  assert.ok(beside(warped, [row]).rows[0].apart < 1e-2);
  assert.ok(beside(warped, [row], { restamp: { name: "WarpTo", by: -1 } }).rows[0].apart > 1);
});

test("the rows are summed up by what the two ships were doing", () => {
  const made = (theirMode, ourMode, apart, later, closest) => ({ theirMode, ourMode, apart, later, closest });
  assert.deepEqual(summary([
    made("GOTO", "GOTO", 5, 0.5, 1),
    made("GOTO", "GOTO", 1, -0.25, 3),
    made("GOTO", "GOTO", 9, null, 9),
    made("GOTO", "GOTO", 3, 0.75, 2),
    made("WARP", "in warp", 4000, 1, 0.5),
    made("STOP", "STOP", 0, null, 0),
  ]), [
    { doing: "GOTO / GOTO", rows: 4, apart: { middle: 3, most: 9 }, later: { least: -0.25, middle: 0.5, most: 0.75, read: 3 }, closest: { middle: 2, most: 9 } },
    { doing: "WARP / in warp", rows: 1, apart: { middle: 4000, most: 4000 }, later: { least: 1, middle: 1, most: 1, read: 1 }, closest: { middle: 0.5, most: 0.5 } },
    { doing: "STOP / STOP", rows: 1, apart: { middle: 0, most: 0 }, later: { least: null, middle: null, most: null, read: 0 }, closest: { middle: 0, most: 0 } },
  ]);
  assert.deepEqual(summary([]), []);
});
