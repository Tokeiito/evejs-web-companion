"use strict";

// Record what a server tells a pilot of its standings: test/fixtures/standingsSession.json.
//
// One real game-port session makes the retail client's own calls: the three its standing service asks when a
// character is chosen (standingsvc.py __RefreshStandings), then, after each of a few changes a GM command makes
// to the pilot's standings, the character's standings again. Every notice the server sent is written down in
// order, among the answers. The tests of src/gamePort/pilotStandings.js replay it and set what is kept beside the
// server's own later answers.
//
//   node scripts/record-standings-session.js <out.json> <account> <characterID> <npc owner ID> [another npc owner ID]
//
// ⚠ It SELECTS the character, which evicts any other session holding it, and logs it off at the end. It CHANGES
// the character's standings with /setstanding, which the account must be allowed. Put the store aside first.

const fs = require("node:fs");
const [out, accountName, characterID, ownerID, otherOwnerID] = process.argv.slice(2);
const { GamePortSession } = require("../src/gamePort/session");
const { connectTcp, gameEndpoint } = require("../src/gamePort/tcp");

setTimeout(() => { console.log("gave up"); process.exit(2); }, 90000).unref();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const session = new GamePortSession({ transport: await connectTcp(gameEndpoint()) });
  const events = [];
  session.onNotification((notification) => events.push({ kind: "notice", method: notification.method, idtype: notification.idtype ?? null, args: notification.args }));
  try {
    await session.login(accountName, "");
    await session.call("charUnboundMgr", "SelectCharacterID", [Number(characterID)]);
    await sleep(1500);
    events.length = 0;
    const ask = async (method) => {
      const value = await session.call("standingMgr", method, []);
      events.push({ kind: "answer", call: method, value });
      return value;
    };
    const gm = async (command) => {
      const value = await session.call("slash", "SlashCmd", [command]);
      events.push({ kind: "command", command, value });
      await sleep(900);
    };
    // standingsvc.py __RefreshStandings.
    await ask("GetNPCNPCStandings");
    await ask("GetCharStandings");
    await ask("GetCorpStandings");
    // A standing where there was none, the same standing changed, another owner's, and one taken away.
    await gm(`/setstanding 3.5 ${ownerID}`);
    await ask("GetCharStandings");
    await gm(`/setstanding -2.25 ${ownerID}`);
    if (otherOwnerID) await gm(`/setstanding 7 ${otherOwnerID}`);
    await ask("GetCharStandings");
    await gm(`/setstanding 0 ${ownerID}`);
    await ask("GetCharStandings");
    const replacer = (name, value) => {
      if (typeof value === "bigint") return { $long: String(value) };
      if (value && value.type === "Buffer" && Array.isArray(value.data)) return { $str: Buffer.from(value.data).toString("latin1") };
      return value;
    };
    const record = { characterID: Number(characterID), corporationID: Number(session.attributes.corpid), raceID: Number(session.attributes.raceID ?? 0) || null, events };
    fs.writeFileSync(out, `${JSON.stringify(record, replacer, 1)}\n`);
    console.log(events.map((event) => (event.kind === "notice" ? event.method : event.kind === "answer" ? `>${event.call}` : `!${event.command}`)).join(" "));
  } finally {
    session.close();
    await sleep(500);
    console.log("closed");
  }
})().catch((error) => { console.log("failed:", error && error.stack); process.exitCode = 1; });
