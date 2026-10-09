"use strict";

// Record what a server tells a pilot of its skills: test/fixtures/skillsSession.json.
//
// One real game-port session makes the retail client's own calls: the ones its skill services make when a
// character is chosen (skillsvc.py, skillQueueSvc.py, the notifications' skill history), then, after each of a few
// changes, the handler's reads again. Every notice the server sent is written down in order, among the answers.
// The tests of src/gamePort/pilotSkills.js replay it and set what is kept beside the server's own later answers.
//
//   node scripts/record-skills-session.js <out.json> <account> <characterID> <skill typeID> <another skill typeID> <expert system typeID>
//
// The first skill is given by a GM command, queued, and taken away; the second is queued behind it. Neither may
// be one the character has. The expert system is installed and removed: it should lend a skill the character has
// not trained.
//
// ⚠ It SELECTS the character, which evicts any other session holding it, and logs it off at the end. It CHANGES
// the character's skills and skill queue, which the account must be allowed. Put the store aside first.

const fs = require("node:fs");
const [out, accountName, characterID, skillTypeID, otherSkillTypeID, expertSystemTypeID] = process.argv.slice(2);
const { GamePortSession } = require("../src/gamePort/session");
const { connectTcp, gameEndpoint } = require("../src/gamePort/tcp");

setTimeout(() => { console.log("gave up"); process.exit(2); }, 120000).unref();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (value) => (Buffer.isBuffer(value) ? value.toString("utf8") : String(value));

(async () => {
  const session = new GamePortSession({ transport: await connectTcp(gameEndpoint()) });
  const events = [];
  // The character's brain comes with every change of skill, 35 KB of it each time, and is nothing a skill service
  // reads: that it came is written down, and what it carried is not.
  const kept = (notification) => (notification.method === "OnServerBrainUpdated" ? [] : notification.args);
  session.onNotification((notification) => events.push({ kind: "notice", method: notification.method, idtype: notification.idtype ?? null, args: kept(notification) }));
  try {
    await session.login(accountName, "");
    await session.call("charUnboundMgr", "SelectCharacterID", [Number(characterID)]);
    await sleep(1500);
    events.length = 0;
    // skillsvc.GetSkillHandler: the moniker skillMgr2 answers, bound by the first call made on it.
    const moniker = await session.call("skillMgr2", "GetMySkillHandler", []);
    const [service, nodeID, params] = moniker.args;
    if (nodeID !== null && nodeID !== undefined) session.setNodeOfAddress(text(service), params, Number(nodeID));
    const bound = await session.bind(text(service), params, ["GetSkills", [], null]);
    events.push({ kind: "answer", call: "GetSkills", value: bound.result });
    const ask = async (method, args = []) => {
      const value = await session.callBound(bound.objectID, method, args, null);
      events.push({ kind: "answer", call: method, args, value });
      return value;
    };
    const does = async (method, args, kwargs = null) => {
      const value = await session.callBound(bound.objectID, method, args, kwargs);
      events.push({ kind: "does", call: method, value });
      await sleep(900);
    };
    const gm = async (command) => {
      const value = await session.call("slash", "SlashCmd", [command]);
      events.push({ kind: "command", command, value });
      await sleep(900);
    };
    const reads = async () => {
      await ask("GetSkills");
      await ask("GetSkillQueueAndFreePoints");
    };
    // What a real client asked of the handler on this server when its character was chosen, after the bind.
    await ask("GetBoosters");
    await ask("GetSkillQueueAndFreePoints");
    await ask("GetAllSkills");
    await ask("CheckAndSendNotifications");
    await ask("GetSkillHistory", [10]);
    // What its services ask when something first wants them (skillsvc.GetCharacterAttributes, GetFreeSkillPoints, GetRespecInfo).
    await ask("GetImplants");
    await ask("GetAttributes");
    await ask("GetFreeSkillPoints");
    await ask("GetRespecInfo");
    // A skill given at no level, then queued to its first level with another behind it, as skillQueueSvc.CommitTransaction sends a queue.
    await gm(`/giveskill me ${skillTypeID} 0`);
    await reads();
    const queue = (entries) => ({ type: "dict", entries: entries.map(([typeID, level], index) => [index, [Number(typeID), level]]) });
    await does("SaveNewQueue", [queue([[skillTypeID, 1]])], { activate: true });
    await reads();
    await gm(`/giveskill me ${otherSkillTypeID} 0`);
    await does("SaveNewQueue", [queue([[skillTypeID, 1], [otherSkillTypeID, 1]])], { activate: true });
    await reads();
    // The first skill's level given outright while it trains, the queue stopped, and the skill taken away.
    await gm(`/giveskill me ${skillTypeID} 2`);
    await reads();
    await ask("GetSkillHistory", [10]);
    await does("AbortTraining", []);
    await reads();
    await gm(`/removeskill me ${skillTypeID}`);
    await reads();
    await does("SaveNewQueue", [queue([])], { activate: false });
    await gm(`/removeskill me ${otherSkillTypeID}`);
    await reads();
    // An expert system: skills held by a level that is lent and not trained, and then not held.
    await gm(`/expertsystem add ${expertSystemTypeID} me`);
    await reads();
    await gm(`/expertsystem remove ${expertSystemTypeID} me`);
    await reads();
    await ask("GetAllSkills");
    const replacer = (name, value) => {
      if (typeof value === "bigint") return { $long: String(value) };
      if (value && value.type === "Buffer" && Array.isArray(value.data)) return { $str: Buffer.from(value.data).toString("latin1") };
      return value;
    };
    // One event to a line: the lists are long, and a line is what a difference is read by.
    const pilot = { characterID: Number(characterID), skillTypeID: Number(skillTypeID), otherSkillTypeID: Number(otherSkillTypeID), expertSystemTypeID: Number(expertSystemTypeID) };
    fs.writeFileSync(out, `{"pilot":${JSON.stringify(pilot)},"events":[\n${events.map((event) => JSON.stringify(event, replacer)).join(",\n")}\n]}\n`);
    const line = (event) => (event.kind === "notice" ? event.method : event.kind === "answer" ? `>${event.call}` : event.kind === "does" ? `*${event.call}` : `!${event.command}`);
    console.log(events.map(line).join(" "));
  } finally {
    session.close();
    await sleep(500);
    console.log("closed");
  }
})().catch((error) => { console.log("failed:", error && error.stack); process.exitCode = 1; });
