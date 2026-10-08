"use strict";

// Set the client's park beside the server's own record of where a ship was.
//
//   node scripts/park-against-movement-log.js <recording.json> <movement log> [more logs…]
//        [--rows=tick|trace] [--summary] [--ship=<itemID>] [--restamp=<entry name>:<ticks>]
//
// The recording is one of this repository's (scripts/record-warp.js,
// scripts/record-destiny.js). The logs are eve.js's
// _local/logs/space-movement-debug*.log for the same minutes (one file an
// hour, named by the hour in UTC). With verbose debugging on, the server
// writes there where it has each piloted ship: about every two seconds
// ("tick"), and at every step of its own, about nine a second, for five
// seconds after an order ("trace.tick"). Places are written to a tenth of a
// metre.
//
// This plays the recording through the client's park
// (src/gamePort/destiny/park.js) as a client would receive it, one tick a
// second, and for each of the server's rows says where the park's ship is at
// that instant and how far that is from the server's.
//
// WHAT "AT THAT INSTANT" MEANS. A row is written at a time on the server's
// clock, and the server's stamps are that clock's whole seconds. The park's
// ship is taken at the same time on the park's own stamps: between two ticks
// by the rule the client draws by (Ballpark.between), in which the tick that
// brought the park to stamp S covers the second from S - 1 to S.
//
// WHAT IT PRINTS, for each row:
//
//   apart     metres between the two ships at that instant
//   later     seconds: the server's ship is where the park's will be this much
//             later (negative: where it was). Found by moving the park's ship
//             along its own path, by the same rule, up to two and a half
//             seconds either way, and on to ten when the nearest is at the
//             end of that. "-" for a ship that is not going anywhere.
//   closest   metres between them when the park's ship is moved by `later`:
//             what is left once the clocks are made to agree
//
// and, at the end, the same three by what the two ships were doing.
//
// How far to trust it. `apart` is as good as the two clocks: the recording
// does not say when on the server's clock the park stepped, only what stamp
// it stepped to. `later` and `closest` do not depend on that. Outside the
// tick it belongs to, the park's path is carried on by the push of that tick
// alone, so `later` is good to the second or so around a turn and better on a
// straight course or in warp, where the path is the warp's own curve.
//
// --restamp=WarpTo:-1 asks what the park would have done had the server
// stamped every update holding a WarpTo one tick sooner: for telling what
// comes of the stamp an order is given from what comes of the order.

const fs = require("node:fs");
const path = require("node:path");
const { isWarping } = require("../src/gamePort/destiny/ballpark");
const { Park } = require("../src/gamePort/destiny/park");
const { MODE_NAME } = require("../src/gamePort/destiny/state");
const { destinyUpdates } = require("../test/helpers/destinyRecording");

const size = (v) => Math.hypot(v.x, v.y, v.z);
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const finite = (v) => v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

/** How far either way the park's ship is moved along its path, in seconds; how far at most, when the nearest is at the end of that; and how finely at first. */
const REACH = 2.5;
const FURTHEST = 10;
const STEP = 0.05;
/** A path shorter than this over the whole reach is a ship going nowhere: no time can be read from it. */
const STILL = 0.5;
const GOLDEN = (Math.sqrt(5) - 1) / 2;

/**
 * The server's rows for one ship, from the text of a movement log, in order of
 * time: { at, atMs, stamp, event, mode, position, speed }. `at` is the row's
 * time in stamps: the stamp the server gave it and how far into that second
 * it was written. Lines that are not rows, rows of other ships, and rows that
 * say again what the row before said at the same instant are left out.
 */
function readMovementLog(text, shipID) {
  const rows = [];
  for (const line of text.split("\n")) {
    const from = line.indexOf("] {");
    if (line[0] !== "[" || from < 0) continue;
    let row = null;
    try {
      row = JSON.parse(line.slice(from + 2));
    } catch {
      continue;
    }
    if (!row || row.shipID !== shipID || !finite(row.position) || !Number.isFinite(row.atMs) || !Number.isFinite(row.destinyStamp)) continue;
    const intoSecond = (row.atMs - Math.floor(row.atMs / 1000) * 1000) / 1000;
    rows.push({
      at: row.destinyStamp + intoSecond,
      atMs: row.atMs,
      stamp: row.destinyStamp,
      event: String(row.event),
      mode: String(row.mode),
      position: { x: row.position.x, y: row.position.y, z: row.position.z },
      speed: Number.isFinite(row.speed) ? row.speed : null,
    });
  }
  rows.sort((a, b) => a.at - b.at);
  return rows.filter((row, index) => {
    const before = rows[index - 1];
    return !(before && before.atMs === row.atMs && before.position.x === row.position.x && before.position.y === row.position.y && before.position.z === row.position.z);
  });
}

/**
 * The rows of every log named, as readMovementLog gives them. Read a piece at
 * a time, keeping only the lines that name the ship: an hour's log can be a
 * hundred megabytes.
 */
function readMovementLogs(files, shipID) {
  const kept = [];
  const needle = `"shipID":${shipID},`;
  for (const file of files) {
    const handle = fs.openSync(file, "r");
    const buffer = Buffer.alloc(1 << 20);
    let rest = "";
    try {
      for (let read = fs.readSync(handle, buffer, 0, buffer.length, null); read > 0; read = fs.readSync(handle, buffer, 0, buffer.length, null)) {
        const lines = (rest + buffer.toString("latin1", 0, read)).split("\n");
        rest = lines.pop();
        for (const line of lines) if (line.includes(needle)) kept.push(line);
      }
    } finally {
      fs.closeSync(handle);
    }
    if (rest.includes(needle)) kept.push(rest);
  }
  return readMovementLog(kept.join("\n"), shipID);
}

/**
 * Play a recording through the park as it was received: the park is stepped
 * once a second by the recording's own clock, and `afterTick(park)` is called
 * after each step. Returns the park.
 */
function replay(recording, afterTick, { tail = 3, restamp = null } = {}) {
  const park = new Park();
  const updates = destinyUpdates(recording);
  if (updates.length === 0) return park;
  if (restamp) {
    for (const update of updates) {
      if (update.entries.some(([, [name]]) => name === restamp.name)) update.entries = update.entries.map(([stamp, order]) => [stamp + restamp.by, order]);
    }
  }
  let clock = updates[0].atMs;
  const tickTo = (atMs) => {
    while (clock + 1000 <= atMs) {
      park.tick();
      clock += 1000;
      afterTick(park);
    }
  };
  for (const update of updates) {
    tickTo(update.atMs);
    park.doDestinyUpdate(update.entries, update.waitForBubble);
  }
  tickTo(clock + tail * 1000);
  return park;
}

/** One row beside the park's ship, `fraction` of the way through the tick that has just been stepped. */
function measure(ballpark, ball, row, fraction) {
  const awayAt = (moved) => size(sub(row.position, ballpark.between(ball, fraction + moved).p));
  const ours = ballpark.between(ball, fraction);
  const apart = size(sub(row.position, ours.p));
  let later = null;
  let closest = apart;
  const reach = size(sub(ballpark.between(ball, fraction + REACH).p, ballpark.between(ball, fraction - REACH).p));
  if (reach >= STILL) {
    let best = 0;
    let least = apart;
    const look = (from, to) => {
      for (let moved = from; moved <= to + 1e-9; moved += STEP) {
        const away = awayAt(moved);
        if (away < least) [best, least] = [moved, away];
      }
    };
    look(-REACH, REACH);
    // Still nearing at the end of the reach: look on that way.
    for (let end = REACH; end < FURTHEST && Math.abs(Math.abs(best) - end) < STEP / 2; end += REACH) {
      if (best > 0) look(end, end + REACH);
      else look(-end - REACH, -end);
    }
    // Golden section between the neighbours of the nearest of those.
    let low = best - STEP;
    let high = best + STEP;
    let a = high - GOLDEN * (high - low);
    let b = low + GOLDEN * (high - low);
    let awayA = awayAt(a);
    let awayB = awayAt(b);
    for (let round = 0; round < 60; round += 1) {
      if (awayA < awayB) {
        high = b;
        [b, awayB] = [a, awayA];
        a = high - GOLDEN * (high - low);
        awayA = awayAt(a);
      } else {
        low = a;
        [a, awayA] = [b, awayB];
        b = low + GOLDEN * (high - low);
        awayB = awayAt(b);
      }
    }
    later = (low + high) / 2;
    closest = Math.min(awayAt(later), least);
  }
  return {
    at: row.at,
    atMs: row.atMs,
    event: row.event,
    theirMode: row.mode,
    ourMode: isWarping(ball) ? "in warp" : MODE_NAME[ball.mode] ?? String(ball.mode),
    apart,
    later,
    closest,
    theirSpeed: row.speed,
    ourSpeed: size(ours.v),
  };
}

/**
 * Each of the server's rows beside the park's ship at that instant:
 * { rows: [{ at, atMs, event, theirMode, ourMode, apart, later, closest, theirSpeed, ourSpeed }],
 *   unmatched, failed, resets, fatalDesyncs }. `unmatched` counts the rows the
 * park had no ship for: before its first state, while docked, after the
 * recording ends.
 */
function beside(recording, rows, { shipID = recording.shipID, restamp = null } = {}) {
  const out = [];
  let next = 0;
  let unmatched = 0;
  const park = replay(recording, (stepped) => {
    const now = stepped.currentTime;
    const ball = stepped.validState ? stepped.ballpark.ball(shipID) : null;
    for (; next < rows.length && rows[next].at < now; next += 1) {
      // The tick just stepped covers the second up to `now`.
      if (!ball || rows[next].at < now - 1) unmatched += 1;
      else out.push(measure(stepped.ballpark, ball, rows[next], rows[next].at - (now - 1)));
    }
  }, { restamp });
  return { rows: out, unmatched: unmatched + (rows.length - next), failed: [...park.failed], resets: park.resets, fatalDesyncs: park.fatalDesyncs };
}

const sorted = (values) => [...values].sort((a, b) => a - b);
const middle = (values) => (values.length === 0 ? null : sorted(values)[Math.floor((values.length - 1) / 2)]);
const most = (values) => (values.length === 0 ? null : sorted(values).at(-1));
const least = (values) => (values.length === 0 ? null : sorted(values)[0]);

/** The rows gathered by what the two ships were doing: [{ doing, rows, apart, later, closest }], each { middle, most } and for `later` { least, middle, most, read }. */
function summary(rows) {
  const groups = new Map();
  for (const row of rows) {
    const doing = `${row.theirMode} / ${row.ourMode}`;
    if (!groups.has(doing)) groups.set(doing, []);
    groups.get(doing).push(row);
  }
  return [...groups].map(([doing, group]) => {
    const laters = group.map((row) => row.later).filter((value) => value !== null);
    return {
      doing,
      rows: group.length,
      apart: { middle: middle(group.map((row) => row.apart)), most: most(group.map((row) => row.apart)) },
      later: { least: least(laters), middle: middle(laters), most: most(laters), read: laters.length },
      closest: { middle: middle(group.map((row) => row.closest)), most: most(group.map((row) => row.closest)) },
    };
  });
}

function main(argv = process.argv.slice(2)) {
  const flags = new Map(argv.filter((arg) => arg.startsWith("--")).map((arg) => arg.slice(2).split("=")).map(([name, value = "true"]) => [name, value]));
  const [recordingPath, ...logs] = argv.filter((arg) => !arg.startsWith("--"));
  if (!recordingPath || logs.length === 0) {
    console.error("usage: node scripts/park-against-movement-log.js <recording.json> <movement log> [more logs…] [--rows=tick|trace] [--summary] [--ship=<itemID>] [--restamp=<entry name>:<ticks>]");
    process.exitCode = 2;
    return;
  }
  const recording = require(path.resolve(recordingPath));
  const shipID = flags.has("ship") ? Number(flags.get("ship")) : recording.shipID;
  const wanted = { tick: ["tick"], trace: ["trace.tick"] }[flags.get("rows")] ?? null;
  const logged = readMovementLogs(logs.map((file) => path.resolve(file)), shipID).filter((row) => wanted === null || wanted.includes(row.event));
  const [restampName, restampBy] = flags.has("restamp") ? flags.get("restamp").split(":") : [];
  const restamp = restampName && Number.isInteger(Number(restampBy)) ? { name: restampName, by: Number(restampBy) } : null;
  const { rows, unmatched, failed, resets, fatalDesyncs } = beside(recording, logged, { shipID, restamp });
  const fixed = (value, digits) => (value === null ? "-" : value.toFixed(digits));
  if (!flags.has("summary")) {
    const first = rows.length > 0 ? rows[0].at : 0;
    console.log("  seconds  row                        theirs / ours        apart(m)   later(s)   closest(m)   speed theirs / ours");
    for (const row of rows) {
      console.log([
        fixed(row.at - first, 3).padStart(9), row.event.padEnd(26), `${row.theirMode} / ${row.ourMode}`.padEnd(16),
        fixed(row.apart, 1).padStart(12), fixed(row.later, 3).padStart(9), fixed(row.closest, 1).padStart(11),
        `${fixed(row.theirSpeed, 1)} / ${fixed(row.ourSpeed, 1)}`.padStart(27),
      ].join("  "));
    }
    console.log("");
  }
  console.log("theirs / ours        rows   apart(m): middle, most     later(s): least, middle, most (rows read)     closest(m): middle, most");
  for (const group of summary(rows)) {
    console.log([
      group.doing.padEnd(18), String(group.rows).padStart(5),
      `${fixed(group.apart.middle, 1)}, ${fixed(group.apart.most, 1)}`.padStart(26),
      `${fixed(group.later.least, 3)}, ${fixed(group.later.middle, 3)}, ${fixed(group.later.most, 3)} (${group.later.read})`.padStart(42),
      `${fixed(group.closest.middle, 1)}, ${fixed(group.closest.most, 1)}`.padStart(28),
    ].join("  "));
  }
  console.log(`rows of the ship's in the logs: ${logged.length}; set beside the park: ${rows.length}; with no ship in the park at that time: ${unmatched}`);
  console.log(`entries that failed: ${JSON.stringify(failed)}; resets: ${resets}; updates holding two ticks: ${fatalDesyncs}`);
}

if (require.main === module) main();

module.exports = { beside, measure, readMovementLog, readMovementLogs, replay, summary };
