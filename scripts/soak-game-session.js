"use strict";

// Hold a game-port session open and report everything that crossed it.
//
// The question it answers: does a session that just sits there stay connected,
// and does the session understand everything the server sends it meanwhile?
//
//   node scripts/soak-game-session.js <accountName> <characterID> <minutes> [logPath]
//
// It logs in, selects the character, and then does nothing but what the retail
// client does on its own: answer pings, send a keep-alive after a minute of
// silence, and re-sync its clock every three minutes. Every packet is written
// to the log (one JSON object per line). It exits 1 if the connection dropped
// early or a packet arrived that the session could not name.
//
// ⚠ It SELECTS the character, which evicts any other session holding it, and
// logs it off again at the end. Use a docked character nobody is flying.

const fs = require("node:fs");
const { GamePortSession } = require("../src/gamePort/session");
const { connectTcp, gameEndpoint } = require("../src/gamePort/tcp");
const { text, unwrapSubstream } = require("../src/gamePort/packets");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** What a packet is, in a few words: its kind, and the call or notification it carries. */
function describe(packet, direction) {
  const entry = { direction, kind: packet.className ?? `unknown(${packet.command})` };
  if (packet.className === "CallReq") {
    const pickle = unwrapSubstream(packet.body[0] && packet.body[0][1]);
    entry.call = `${packet.destination.service ?? text(pickle && pickle[0])}.${text(pickle && pickle[1])}`;
    entry.to = packet.destination.kind;
  } else if (packet.className === "Notification") {
    entry.notification = packet.destination.broadcastID ?? null;
    entry.idtype = packet.destination.idtype ?? null;
  }
  return entry;
}

async function soak({ accountName, characterID, minutes, logPath = null, endpoint = gameEndpoint() }) {
  const session = new GamePortSession({ transport: await connectTcp(endpoint) });
  const log = logPath ? fs.createWriteStream(logPath, { flags: "w" }) : null;
  const counts = new Map();
  const started = Date.now();
  let closedEarly = null;
  session.onPacket((packet, direction) => {
    const entry = describe(packet, direction);
    const key = [entry.direction, entry.kind, entry.call ?? entry.notification ?? ""].join(" ").trim();
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (log) log.write(`${JSON.stringify({ at: Date.now() - started, ...entry })}\n`);
  });
  session.onClose((error) => { closedEarly = error; });

  try {
    await session.login(accountName, "");
    await session.call("charUnboundMgr", "SelectCharacterID", [characterID]);
    const until = started + minutes * 60_000;
    while (Date.now() < until && !session.closed) await sleep(Math.min(1000, until - Date.now()));
  } finally {
    const dropped = closedEarly;
    session.close();
    if (log) await new Promise((resolve) => log.end(resolve));
    return {
      seconds: Math.round((Date.now() - started) / 1000),
      dropped: dropped ? dropped.message : null,
      unknownPackets: session.counters.unknownPackets,
      counters: session.counters,
      clockOffsetMs: Math.round(session.clockOffsetMs),
      counts: [...counts.entries()].sort(),
    };
  }
}

async function main(argv = process.argv.slice(2)) {
  const [accountName, characterID, minutes, logPath] = argv;
  if (!accountName || !/^\d+$/.test(characterID ?? "") || !(Number(minutes) > 0)) {
    throw new Error("Usage: node scripts/soak-game-session.js <accountName> <characterID> <minutes> [logPath]");
  }
  const report = await soak({ accountName, characterID: Number(characterID), minutes: Number(minutes), logPath });
  console.log(`Held for ${report.seconds}s. Dropped: ${report.dropped ?? "no"}. Packets the session could not name: ${report.unknownPackets}.`);
  console.log(`Frames sent ${report.counters.sent}, received ${report.counters.received}; clock offset ${report.clockOffsetMs}ms.`);
  for (const [key, count] of report.counts) console.log(`${String(count).padStart(6)}  ${key}`);
  if (report.dropped || report.unknownPackets > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { describe, soak };
