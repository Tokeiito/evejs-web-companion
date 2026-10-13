"use strict";

// How far each entry's stamp is past the client's own tick as it arrives.
//
//   node scripts/park-tick-against-stamps.js <recording.jsonl>
//        [--connection=<n>] [--server-clock=<ms to add>] [--timeline]
//
// The recording is one made by scripts/record-game-port.js. Its ballpark
// updates are played through the client's park (src/gamePort/destiny/park.js)
// clocked as the client clocks it: the park is started when the server's
// answer to GetFormations came (michelle.AddBallpark asks for the formations
// and then starts the park; a park's first tick is its start, and every later
// one a whole second of its own clock after), shown the clock every 50 ms as
// the BFF shows it, and handed each update as it arrived. Where a recording
// has no such answer the park is started as its first update arrives. One
// park is kept for a whole connection: where the pilot docks and comes out
// again, the client makes a new park and this does not.
//
// WHAT IT SAYS.
//
//   by name       for each kind of entry, how many came with their stamp so
//                 many ticks past the park's tick (0: at it; -1: one behind)
//   went back     how many times the park had to go back to a state it kept,
//                 for an entry behind its tick
//                 (michelle.py SynchroniseToSimulationTime, 1076)
//   new state     how many times it found no such state and asked the server
//                 for the whole state again (RequestReset)
//   forward       how many times it stepped forward at once to an entry three
//                 or more ahead (DoPreTick, 906)
//   --server-clock=<ms>   the ms to add to the recorder's clock to have the
//                 server's (reckon it from a frame sent at a known server
//                 time: the WarpTo after `warp.requested` in the movement
//                 debug log, or a whole state's building in the authority's
//                 trace). With it: the park's tick less the server's stamp,
//                 as each update arrived.
//   --timeline    with the server's clock: every moment that difference
//                 changed, and what was arriving
//
// HOW TO READ IT. A client's park and a server agree on a tick's number and
// never on when in the second it falls. The park does not keep to one tick a
// second either: before each tick it applies what is due, and while more than
// one later stamp is still queued it steps once more and looks again
// (michelle.py DoPreTick, 912 to 915). So a server that sends stamps spread
// over several ticks pulls the park ahead of its own stamp, and what it then
// stamps low arrives behind the park's tick. Tranquility's entries arrive
// none or one ahead (never two, in 6,203 updates of 46 recordings), and one
// behind for 77.
//
// It changes nothing and reads only the recording.

const { NON_DESTINY_CRITICAL, Park } = require("../src/gamePort/destiny/park");
const { framesByConnection, updatesOf } = require("./missiles-in-park");

const FRAME_MS = 50;
const ASKED = Buffer.from("GetFormations", "latin1").toString("hex");
const count = (map, key) => map.set(key, (map.get(key) || 0) + 1);

/**
 * A connection's frames played through a park on the client's own clocking:
 * { startedAtMs, firstStateAtMs, byName: Map<name, Map<lead, count>>, wentBack, resets, forward: [{ ticks, stamp }],
 *   failed: Map, ahead: Map<ticks, count> | null, timeline: [{ atMs, park, server, intoSecond, arriving }] }.
 * `serverClock` is the ms to add to the recorder's clock for the server's, or null.
 */
function measure(frames, { serverClock = null } = {}) {
  const updates = updatesOf(frames);
  if (updates.length === 0) return null;
  // The answer nearest the first update, within two seconds of it: the state may come a few ms before the answer.
  const answer = frames
    .filter((frame) => frame.hex.includes(ASKED) && Math.abs(frame.at - updates[0].atMs) <= 2000)
    .sort((a, b) => Math.abs(a.at - updates[0].atMs) - Math.abs(b.at - updates[0].atMs))[0] ?? null;
  const startedAtMs = answer ? answer.at : updates[0].atMs;

  const park = new Park();
  let wentBack = 0;
  const forward = [];
  const synchronise = park.synchroniseToSimulationTime.bind(park);
  park.synchroniseToSimulationTime = (stamp) => {
    if (stamp < park.currentTime) wentBack += 1;
    if (stamp > park.currentTime && park.validState) forward.push({ ticks: stamp - park.currentTime, stamp });
    return synchronise(stamp);
  };
  let clock = startedAtMs;
  park.onTick(clock);
  const showClockUntil = (atMs) => {
    while (clock + FRAME_MS <= atMs) {
      clock += FRAME_MS;
      park.onTick(clock);
    }
  };

  const byName = new Map();
  const ahead = serverClock === null ? null : new Map();
  const timeline = [];
  let lastAhead = null;
  let seenState = false;
  let firstStateAtMs = null;
  for (const update of updates) {
    showClockUntil(update.atMs);
    // Before the park has a state its tick says nothing of the server's.
    const counted = seenState && park.validState;
    if (counted && ahead) {
      const server = Math.floor((update.atMs + serverClock) / 1000);
      const by = park.currentTime - server;
      count(ahead, by);
      if (by !== lastAhead) {
        timeline.push({
          atMs: update.atMs,
          park: park.currentTime,
          server,
          intoSecond: (((update.atMs + serverClock) % 1000) + 1000) % 1000 / 1000,
          arriving: [...new Set(update.entries.map(([stamp, [name]]) => `${name}@${Number(stamp) % 1000}`))],
        });
        lastAhead = by;
      }
    }
    for (const [stamp, [name]] of update.entries) {
      if (name === "SetState") {
        seenState = true;
        firstStateAtMs ??= update.atMs;
        continue;
      }
      if (!counted) continue;
      if (!byName.has(name)) byName.set(name, new Map());
      count(byName.get(name), Number(stamp) - park.currentTime);
    }
    park.doDestinyUpdate(update.entries, update.waitForBubble);
  }
  showClockUntil(clock + 3000);
  return { startedAtMs, firstStateAtMs, byName, wentBack, resets: park.resets, forward, failed: park.failed, ahead, timeline };
}

const counts = (map) => [...map.entries()].sort((a, b) => a[0] - b[0]).map(([lead, each]) => `${lead >= 0 ? "+" : ""}${lead}: ${each}`).join("  ");
const into = (ms) => ((((ms % 1000) + 1000) % 1000) / 1000).toFixed(3);

function main(argv = process.argv.slice(2)) {
  const flags = new Map(argv.filter((arg) => arg.startsWith("--")).map((arg) => arg.slice(2).split("=")).map(([name, value = "true"]) => [name, value]));
  const [file] = argv.filter((arg) => !arg.startsWith("--"));
  if (!file) {
    console.error("usage: node scripts/park-tick-against-stamps.js <recording.jsonl> [--connection=<n>] [--server-clock=<ms to add>] [--timeline]");
    process.exitCode = 2;
    return;
  }
  const byConnection = framesByConnection(file);
  const wanted = flags.has("connection") ? [Number(flags.get("connection"))] : [...byConnection.keys()];
  const serverClock = flags.has("server-clock") ? Number(flags.get("server-clock")) : null;
  for (const connection of wanted) {
    const measured = measure(byConnection.get(connection) ?? [], { serverClock });
    if (!measured) continue;
    console.log(`connection ${connection}: the park started ${into(measured.startedAtMs)} s into a second of the recorder's clock; the first whole state came ${measured.firstStateAtMs === null ? "never" : `${((measured.firstStateAtMs - measured.startedAtMs) / 1000).toFixed(3)} s after`}`);
    console.log(`  went back for an entry behind its tick: ${measured.wentBack}; asked for a new state: ${measured.resets}; stepped forward to an entry three or more ahead: ${measured.forward.length === 0 ? "never" : measured.forward.map((each) => `${each.ticks} to ${each.stamp % 1000}`).join(", ")}; entries that failed: ${[...measured.failed.keys()].join(", ") || "none"}`);
    if (measured.ahead) console.log(`  the park's tick less the server's stamp, as each update arrived: ${counts(measured.ahead)}`);
    for (const [name, leads] of [...measured.byName.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(`  ${(NON_DESTINY_CRITICAL.has(name) ? `${name} *` : name).padEnd(34)} ${counts(leads)}`);
    }
    console.log("  (* applied in its turn without the park being moved to its stamp)");
    if (flags.has("timeline")) {
      for (const each of measured.timeline) {
        console.log(`  at ${each.atMs}: the park ${each.park % 1000}, the server ${each.server % 1000} (${each.park - each.server >= 0 ? "+" : ""}${each.park - each.server}), ${each.intoSecond.toFixed(3)} s into its second; arriving: ${each.arriving.slice(0, 5).join(", ")}`);
      }
    }
  }
}

if (require.main === module) main();

module.exports = { measure };
