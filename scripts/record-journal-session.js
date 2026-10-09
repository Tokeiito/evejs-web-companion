"use strict";

// Record what a server tells a pilot of its agents' journal: test/fixtures/journalSession.json.
//
// One real game-port session makes the retail client's own calls: the whole journal as its journal service asks
// for it (journal.py _UpdateMissionDataFull: agentMgr.GetMyJournalDetails()), then a mission taken through its
// states by pressing an agent's buttons, with, after each press, the agent's own journal as the service asks for
// it once a mission has changed (_UpdateMissionDataPartial: the agent's moniker's GetMyJournalDetails()) and the
// whole journal again, which is the server's own word to set what is kept beside. Every notice the server sent is
// written down in order, among the answers. The tests of src/gamePort/pilotJournal.js replay it.
//
//   node scripts/record-journal-session.js <out.json> <account> <characterID> <agentID>
//
// The pilot should be docked where the agent is, with a mission of that agent's offered and not yet accepted. The
// buttons pressed are Accept, Quit, Request Mission and Decline, each found by its kind in what the agent offers
// (agentDialogueUtil: 2 request, 3 accept, 9 decline, 11 quit); one that is not offered is said and skipped.
//
// ⚠ It SELECTS the character, which evicts any other session holding it, and logs it off at the end. It CHANGES
// the character's missions and its standing with the agent. Put the store aside first.

const fs = require("node:fs");
const [out, accountName, characterID, agentID] = process.argv.slice(2);
const { GamePortSession } = require("../src/gamePort/session");
const { connectTcp, gameEndpoint } = require("../src/gamePort/tcp");

setTimeout(() => { console.log("gave up"); process.exit(2); }, 120000).unref();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const BUTTON = { request: 2, accept: 3, decline: 9, quit: 11 };

(async () => {
  const session = new GamePortSession({ transport: await connectTcp(gameEndpoint()) });
  const events = [];
  session.onNotification((notification) => events.push({ kind: "notice", method: notification.method, idtype: notification.idtype ?? null, args: notification.args }));
  // The server asks the client things while an agent is talked to (a question before a quit, a decline): yes to each.
  session.clientCalls = async (call) => {
    events.push({ kind: "asked", service: call.service, method: call.method });
    return call.method === "YesNo" ? true : null;
  };
  try {
    await session.login(accountName, "");
    await session.call("charUnboundMgr", "SelectCharacterID", [Number(characterID)]);
    await sleep(1500);
    events.length = 0;
    const whole = async () => events.push({ kind: "answer", call: "GetMyJournalDetails", of: "agentMgr", value: await session.call("agentMgr", "GetMyJournalDetails", []) });
    await whole();
    // The agent's moniker, bound by the first call made on it.
    const bound = await session.bind("agentMgr", Number(agentID), ["DoAction", [null], null]);
    let talk = bound.result;
    const own = async () => events.push({ kind: "answer", call: "GetMyJournalDetails", of: Number(agentID), value: await session.callBound(bound.objectID, "GetMyJournalDetails", [], null) });
    const offered = () => (talk && talk[0] && talk[0][1] && talk[0][1].items ? talk[0][1].items : []);
    const press = async (name) => {
      const button = offered().find(([, kind]) => Number(kind) === BUTTON[name]);
      if (!button) {
        console.log(`${name}: not offered (${offered().map(([, kind]) => kind).join(",")})`);
        return;
      }
      await session.callBound(bound.objectID, "DoAction", [button[0]], null);
      events.push({ kind: "pressed", button: name });
      await sleep(1200);
      await own();
      await whole();
      talk = await session.callBound(bound.objectID, "DoAction", [null], null);
      await sleep(300);
    };
    for (const name of ["accept", "quit", "request", "decline"]) await press(name);
    const replacer = (name, value) => {
      if (typeof value === "bigint") return { $long: String(value) };
      if (value && value.type === "Buffer" && Array.isArray(value.data)) return { $str: Buffer.from(value.data).toString("latin1") };
      return value;
    };
    const pilot = { characterID: Number(characterID), agentID: Number(agentID) };
    fs.writeFileSync(out, `{"pilot":${JSON.stringify(pilot)},"events":[\n${events.map((event) => JSON.stringify(event, replacer)).join(",\n")}\n]}\n`);
    const line = (event) => (event.kind === "notice" ? `${event.method}${event.method === "OnAgentMissionChange" ? `(${Buffer.isBuffer(event.args[0]) ? event.args[0].toString() : event.args[0]})` : ""}` : event.kind === "answer" ? `>${event.of}` : event.kind === "pressed" ? `!${event.button}` : `?${event.method}`);
    console.log(events.map(line).join(" "));
  } finally {
    session.close();
    await sleep(500);
    console.log("closed");
  }
})().catch((error) => { console.log("failed:", error && error.stack); process.exitCode = 1; });
