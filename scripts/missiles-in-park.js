"use strict";

// Every missile of a recording, measured in the client's own park.
//
//   node scripts/missiles-in-park.js <recording.jsonl> [rows]
//
// The recording is one made by scripts/record-game-port.js, between a client
// (the BFF's game port will do: start the BFF with EVEJS_GAME_PORT at the
// recorder's port) and the server. Its ballpark updates are played through the
// client's park (src/gamePort/destiny/park.js) as a client gets them, one tick
// a second, each update as it arrived. For each missile this says:
//
//   came      what its ball was as the launch left it: mode, radius, speed,
//             the range it follows at, how far off its target was
//   touched   the tick in which the park's ball touched the ball it follows.
//             That is CCP's own collision (Ballpark::Potential notes it, and
//             the client's missile is told it has hit from there:
//             spaceObject/missile.py DoCollision, 208)
//   removed   the stamp the server took it away at, and whether
//             TerminalPlayDestructionEffect came with it
//   damage    the stamps at which its target's damage state came, from its
//             launch to two stamps past its removal
//
// HOW TO READ IT. An entry stamped R is applied before the park's step from
// R, so a ball's last step is the one from R - 1. A ball that touched in the
// tick from t has therefore touched by the time a removal stamped t + 1 is
// applied: "removed 0 stamps after its touch was done" is that.
//
// WHAT TRANQUILITY DOES, from its recordings (720 launches in 8): every
// missile is removed with TerminalPlayDestructionEffect(missile, None) at the
// removal's stamp, one to seven ticks after its launch, and where its target's
// damage state came within a stamp of that it was at the same stamp for 485
// of 507. Those recordings cannot be played through this: the client's logger
// cuts each whole state at 64 KB, and the pilot's own ship is not always in
// what is left. So "at its touch" is not measured of Tranquility: it is what
// the client's own code needs (missile.py 243: a missile released before its
// ball has collided loses its warhead in flight).
//
// It changes nothing and reads only the recording.

const fs = require("node:fs");
const zlib = require("node:zlib");
const { marshalDecode } = require("../src/gameProtocol/marshal");
const { TYPE, parsePacket } = require("../src/gamePort/packets");
const { readNotification } = require("../src/gamePort/session");
const { Park } = require("../src/gamePort/destiny/park");
const { MODE } = require("../src/gamePort/destiny/state");

const text = (value) => (Buffer.isBuffer(value) ? value.toString("latin1") : typeof value === "string" ? value : value && typeof value.value === "string" ? value.value : null);
const items = (value) => (Array.isArray(value) ? value : value && Array.isArray(value.items) ? value.items : []);
const key = (id) => String(typeof id === "bigint" ? id : BigInt(Math.trunc(Number(id))));
const length = (v) => Math.hypot(v.x, v.y, v.z);

/** The server's frames of a recording, by connection. */
function framesByConnection(file) {
  const byConnection = new Map();
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const frame = JSON.parse(line);
    if (frame.from !== "server") continue;
    if (!byConnection.has(frame.connection)) byConnection.set(frame.connection, []);
    byConnection.get(frame.connection).push(frame);
  }
  return byConnection;
}

/** A connection's ballpark updates, in order: { atMs, entries, waitForBubble }. Both notices of them are read. */
function updatesOf(frames) {
  const updates = [];
  for (const frame of frames) {
    let payload = Buffer.from(frame.hex, "hex");
    if (payload[0] !== 0x7e) {
      try { payload = zlib.inflateSync(payload); } catch { continue; }
    }
    let packet = null;
    try { packet = parsePacket(marshalDecode(payload)); } catch { continue; }
    if (!packet || packet.command !== TYPE.NOTIFICATION) continue;
    const notice = readNotification(packet);
    const each = notice.method === "DoDestinyUpdate" ? [notice.args] : notice.method === "DoDestinyUpdates" ? items(notice.args[0]) : [];
    for (const update of each) {
      updates.push({ atMs: frame.at, entries: items(update[0]).map(([stamp, [name, args]]) => [stamp, [text(name), args]]), waitForBubble: update[1] });
    }
  }
  return updates;
}

/**
 * The updates played through a park, and every missile launched in them:
 * { missiles: [{ id, launched, target, launcher, came, touched: [ticks], removed, terminal: [stamp, effect] | null,
 * damage: [stamps] }], steps, resets, failed: Map }.
 */
function measure(updates) {
  const missiles = new Map();
  const damage = new Map();
  const failed = new Map();
  const park = new Park({
    onEvent(name, args, stamp) {
      const list = items(args);
      if (name === "LaunchMissile") {
        const ball = [...park.ballpark.balls.values()].find((each) => key(each.id) === key(list[0]));
        const target = ball && ball.followPtr;
        missiles.set(key(list[0]), {
          id: key(list[0]),
          launched: Number(stamp),
          target: key(list[1]),
          launcher: key(list[2]),
          came: ball
            ? { mode: ball.mode, radius: ball.radius, maxVelocity: ball.maxVelocity, speedFraction: ball.speedFraction, speed: length(ball.newVel), followRange: ball.followRange, targetRadius: target ? target.radius : null, apart: target ? length({ x: target.newPos.x - ball.newPos.x, y: target.newPos.y - ball.newPos.y, z: target.newPos.z - ball.newPos.z }) : null }
            : null,
          touched: [],
          removed: null,
          terminal: null,
        });
      } else if (name === "TerminalPlayDestructionEffect") {
        const record = missiles.get(key(list[0]));
        if (record) record.terminal = [Number(stamp), list[1] === null || list[1] === undefined ? "None" : String(list[1])];
      } else if (name === "RemoveBalls" || name === "RemoveBall") {
        for (const id of name === "RemoveBalls" ? items(list[0]) : [list[0]]) {
          const record = missiles.get(key(id));
          if (record && record.removed === null) record.removed = Number(stamp);
        }
      } else if (name === "OnDamageStateChange") {
        if (!damage.has(key(list[0]))) damage.set(key(list[0]), []);
        damage.get(key(list[0])).push(Number(stamp));
      }
    },
  });
  park.onFail = (name) => failed.set(name, (failed.get(name) || 0) + 1);
  // Each step of the park: which missiles' balls touched the ball they follow during it.
  const evolve = park.ballpark.evolve.bind(park.ballpark);
  park.ballpark.evolve = (timestamp) => {
    const from = park.ballpark.currentTime;
    const out = evolve(timestamp);
    for (const ball of park.ballpark.balls.values()) {
      if (ball.mode !== MODE.MISSILE || !Array.isArray(ball.collisions) || ball.collisions.length === 0) continue;
      const record = missiles.get(key(ball.id));
      if (record && ball.collisions.some((other) => key(other) === record.target) && !record.touched.includes(from)) record.touched.push(from);
    }
    return out;
  };

  let clock = updates[0].atMs;
  let steps = 0;
  const tickTo = (atMs) => {
    while (clock + 1000 <= atMs) {
      park.tick();
      steps += 1;
      clock += 1000;
    }
  };
  for (const update of updates) {
    tickTo(update.atMs);
    park.doDestinyUpdate(update.entries, update.waitForBubble);
  }
  for (let more = 0; more < 5; more += 1) {
    park.tick();
    steps += 1;
  }
  return {
    missiles: [...missiles.values()].map((record) => ({ ...record, damage: (damage.get(record.target) || []).filter((stamp) => stamp >= record.launched && (record.removed === null || stamp <= record.removed + 2)) })),
    steps,
    resets: park.resets,
    failed,
  };
}

function main(argv = process.argv.slice(2)) {
  const [recording, rowsText = "40"] = argv;
  if (!recording) {
    console.log("usage: node scripts/missiles-in-park.js <recording.jsonl> [rows]");
    process.exitCode = 1;
    return;
  }
  for (const [connection, frames] of framesByConnection(recording)) {
    const updates = updatesOf(frames);
    if (updates.length === 0) continue;
    const measured = measure(updates);
    console.log(`connection ${connection}: ${updates.length} updates over ${Math.round((updates[updates.length - 1].atMs - updates[0].atMs) / 1000)} s, ${measured.steps} ticks of the park, ${measured.missiles.length} missiles; resets ${measured.resets}; entries that failed: ${[...measured.failed].map(([name, count]) => `${name} ${count}`).join(", ") || "none"}`);
    const tally = new Map();
    let printed = 0;
    for (const record of measured.missiles) {
      const touch = record.touched.length ? Math.min(...record.touched) : null;
      const after = record.removed === null || touch === null ? null : record.removed - (touch + 1);
      const label = `removed ${after === null ? (record.removed === null ? "never" : "with no touch") : `${after} stamp(s) after its touch was done`}, ${record.terminal ? `with the entry (${record.terminal[1]})` : "with no entry"}`;
      tally.set(label, (tally.get(label) || 0) + 1);
      if (printed >= Number(rowsText)) continue;
      printed += 1;
      const came = record.came;
      console.log(
        `  missile ...${record.id.slice(-6)} | launched ${record.launched} | came: mode ${came && came.mode}, radius ${came && came.radius}, speed ${came && came.speed.toFixed(1)} of ${came && came.maxVelocity && came.maxVelocity.toFixed(0)} at fraction ${came && came.speedFraction}, range ${came && came.followRange}, target ${came && came.apart !== null ? Math.round(came.apart) : "?"} m off (radius ${came && came.targetRadius})`
        + ` | touched in the tick from ${touch === null ? "never" : touch}${record.touched.length > 1 ? ` (and ${record.touched.length - 1} more)` : ""}`
        + ` | removed ${record.removed === null ? "never" : `${record.removed} (${record.removed - record.launched} after launch)`}`
        + ` | entry ${record.terminal ? `${record.terminal[0]} ${record.terminal[1]}` : "none"} | the target's damage at ${record.damage.join(", ") || "none"}`,
      );
    }
    for (const [label, count] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${String(count).padStart(4)} | ${label}`);
  }
}

if (require.main === module) main();

module.exports = { framesByConnection, measure, updatesOf };
