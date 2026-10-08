"use strict";

// Hold our ballpark up to the server's own account of where things are.
//
//   node scripts/destiny-compare.js [recording.json]
//
// The recording is one made by scripts/record-destiny.js with probeEverySeconds
// set: while in space the server was asked for its whole state again every so
// often. This plays the recording through the client's park
// (src/gamePort/destiny/park.js) as a client would receive it, and at each of
// those states says how far the park's ship is from the server's at that tick,
// just before the park is replaced by it.
//
// What a difference means: the park steps once a second by CCP's rules, from
// the last state the server gave it. Distances are also given in ticks of
// travel (metres over speed), and "seconds of slowing" is how long the server's
// ship has been slowing compared with ours, from the two speeds.
//
// How far to trust it: to about a tick, no finer. eve.js answers a request for
// its state with where its ships are at that moment, under the stamp of the
// next whole second, and its one-second steps do not begin on the stamp's
// seconds. So such a state can be most of a tick behind the tick it names, or
// ahead of it, depending on when in the second it was asked for. Velocities
// while cruising, modes, and what the park does with each state are what this
// shows well. For positions to the metre, the server's own record of each step
// is eve.js/_local/logs/space-movement-debug.log.

const path = require("node:path");
const { Ballpark } = require("../src/gamePort/destiny/ballpark");
const { Park } = require("../src/gamePort/destiny/park");
const { MODE, MODE_NAME, readState } = require("../src/gamePort/destiny/state");
const { destinyUpdates, keyValField } = require("../test/helpers/destinyRecording");

const DEFAULT_RECORDING = path.resolve(__dirname, "..", "test", "fixtures", "destinyUndockProbed.json");
const size = (v) => Math.hypot(v.x, v.y, v.z);
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

/** Every state after the first, with the park's ship beside the server's. */
function compare(recording) {
  const park = new Park();
  const updates = destinyUpdates(recording);
  const rows = [];
  let firstStamp = null;
  let clock = updates[0].atMs;
  for (const update of updates) {
    while (clock + 1000 <= update.atMs) {
      park.tick();
      clock += 1000;
    }
    const [stamp, [name, args]] = update.entries[0];
    if (name === "SetState") {
      firstStamp ??= stamp;
      if (park.validState) {
        const copy = new Ballpark();
        copy.readState(park.ballpark.writeState(), 0);
        while (copy.currentTime < stamp) copy.evolve();
        const ours = copy.ball(recording.shipID);
        const theirs = readState(keyValField(args[0], "state")).balls.find((ball) => ball.id === recording.shipID);
        const between = sub(theirs.position, ours.newPos);
        const speed = size(theirs.velocity);
        // Positive: the server's ship is further along its heading than ours.
        const ahead = speed > 0 ? dot(between, theirs.velocity) / speed : 0;
        const decay = ours.mode === MODE.STOP && speed > 0 ? Math.log(size(ours.newVel) / speed) / (1e6 / (ours.mass * ours.agility)) : null;
        rows.push({
          atMs: update.atMs - updates[0].atMs,
          stamp: stamp - firstStamp,
          parkAt: park.currentTime - firstStamp,
          mode: `${MODE_NAME[theirs.mode]}/${MODE_NAME[ours.mode]}`,
          metresApart: size(between),
          metresAhead: ahead,
          ticksAhead: ours.maxVelocity > 0 ? ahead / ours.maxVelocity : null,
          speedTheirs: speed,
          speedOurs: size(ours.newVel),
          velocityApart: size(sub(theirs.velocity, ours.newVel)),
          secondsOfSlowingAhead: decay,
        });
      }
    }
    park.doDestinyUpdate(update.entries, update.waitForBubble);
  }
  park.tick();
  return { rows, failed: [...park.failed], resets: park.resets, fatalDesyncs: park.fatalDesyncs };
}

function main(argv = process.argv.slice(2)) {
  const recording = require(argv[0] ? path.resolve(argv[0]) : DEFAULT_RECORDING);
  const { rows, failed, resets, fatalDesyncs } = compare(recording);
  if (rows.length === 0) console.log("The recording holds no second state. Record with probeEverySeconds set.");
  const fixed = (value, digits) => (value === null ? "-" : value.toFixed(digits));
  console.log("arrived  stamp  park  mode(theirs/ours)  apart(m)   server ahead(m)  (ticks)   speed theirs/ours     slowing ahead(s)");
  for (const row of rows) {
    console.log([
      `${String(row.atMs).padStart(6)}ms`, `+${row.stamp}`.padStart(5), `+${row.parkAt}`.padStart(5), row.mode.padEnd(17),
      fixed(row.metresApart, 3).padStart(9), fixed(row.metresAhead, 3).padStart(15), fixed(row.ticksAhead, 4).padStart(9),
      `${fixed(row.speedTheirs, 4)}/${fixed(row.speedOurs, 4)}`.padStart(21), fixed(row.secondsOfSlowingAhead, 4).padStart(12),
    ].join("  "));
  }
  console.log(`entries that failed: ${JSON.stringify(failed)}; resets: ${resets}; updates holding two ticks: ${fatalDesyncs}`);
}

if (require.main === module) main();

module.exports = { compare };
