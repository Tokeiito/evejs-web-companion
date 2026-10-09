"use strict";

// Record what a server tells two pilots of a fleet: test/fixtures/fleetSession.json.
//
// Two real game-port sessions make the retail client's own calls. One pilot forms a fleet and invites the other,
// who joins; the first makes a wing and a squad, names the wing, moves the other into the squad and sets a
// message; each then asks for the wings and the fleet's state; the second leaves, then the first. Every notice
// and session change each was sent is written down in order, among the answers each got. The tests of
// src/gamePort/pilotFleet.js replay it and set what is kept beside the server's own answers.
//
//   node scripts/record-fleet-session.js <out.json> <founderAccount> <founderID> <founderShipType> <joinerAccount> <joinerID> <joinerShipType>
//
// ⚠ It SELECTS both characters, which evicts any other session holding them, and logs them off at the end. Use
// docked characters nobody is flying, and put the store aside first if the fleet must leave no trace.

const fs = require("node:fs");
const [out, founderName, founderID, founderShip, joinerName, joinerID, joinerShip] = process.argv.slice(2);
const { GamePortSession } = require("../src/gamePort/session");
const { connectTcp, gameEndpoint } = require("../src/gamePort/tcp");
setTimeout(() => { console.log("gave up"); process.exit(2); }, 120000).unref();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (value) => (Buffer.isBuffer(value) ? value.toString("utf8") : typeof value === "string" ? value : null);

/** A bound object's "N=..." out of an answer that is one. */
function objectOf(answer) {
  let value = answer;
  for (let depth = 0; depth < 4 && value && typeof value === "object" && !Array.isArray(value) && !Buffer.isBuffer(value); depth += 1) value = value.value;
  return text(Array.isArray(value) ? value[0] : value);
}

async function pilot(accountName, characterID) {
  const session = new GamePortSession({ transport: await connectTcp(gameEndpoint()) });
  const events = [];
  session.onNotification((notification) => events.push({ kind: "notice", method: notification.method, idtype: notification.idtype ?? null, args: notification.args }));
  session.onSessionChange((changes) => events.push({ kind: "sessionchange", changes: { ...changes } }));
  await session.login(accountName, "");
  await session.call("charUnboundMgr", "SelectCharacterID", [Number(characterID)]);
  await sleep(1500);
  events.length = 0;
  let object = null;
  const ask = async (method, args = [], kwargs = null) => {
    const value = await session.callBound(object, method, args, kwargs);
    events.push({ kind: "answer", call: method, args, value });
    return value;
  };
  return { session, events, ask, hold: (objectID) => { object = objectID; }, characterID: Number(characterID) };
}

(async () => {
  const founder = await pilot(founderName, founderID);
  const joiner = await pilot(joinerName, joinerID);
  try {
    // fleetSvc.CreateFleet
    founder.hold(objectOf(await founder.session.call("fleetObjectHandler", "CreateFleet", [])));
    await founder.ask("Init", [Number(founderShip), null], { adInfoData: null });
    const state = await founder.ask("GetInitState");
    const fleetID = await founder.ask("GetFleetID");
    console.log("formed", String(fleetID));
    // fleetSvc.Invite, and the invited pilot's OnFleetInvite
    await founder.ask("Invite", [joiner.characterID, null, null, null]);
    await sleep(1200);
    const bound = await joiner.session.bind("fleetObjectHandler", fleetID, ["AcceptInvite", [Number(joinerShip)], null]);
    joiner.events.push({ kind: "answer", call: "AcceptInvite", args: [Number(joinerShip)], value: bound.result });
    joiner.hold(bound.objectID);
    await joiner.ask("GetInitState");
    await sleep(800);
    // The boss changes things; each side reads the state after, to set beside what its notices left it holding.
    const wingID = await founder.ask("CreateWing");
    await sleep(500);
    const squadID = await founder.ask("CreateSquad", [wingID]);
    await sleep(500);
    await founder.ask("ChangeWingName", [wingID, "Second wing"]);
    await sleep(500);
    await founder.ask("MoveMember", [joiner.characterID, wingID, squadID, 4]);
    await sleep(800);
    await founder.ask("SetMotdEx", ["Fly safe"]);
    await sleep(500);
    for (const each of [founder, joiner]) {
      await each.ask("GetWings");
      await each.ask("GetInitState");
    }
    await founder.ask("DeleteSquad", [squadID]).catch((error) => console.log("DeleteSquad:", error.message.slice(0, 80)));
    await sleep(500);
    for (const each of [founder, joiner]) {
      await each.ask("GetWings");
      await each.ask("GetInitState");
    }
    await joiner.ask("LeaveFleet");
    await sleep(800);
    await founder.ask("GetInitState");
    await founder.ask("LeaveFleet");
    await sleep(800);
    const replacer = (name, value) => {
      if (typeof value === "bigint") return { $long: String(value) };
      if (value && value.type === "Buffer" && Array.isArray(value.data)) return { $str: Buffer.from(value.data).toString("latin1") };
      return value;
    };
    const record = { fleetID, founder: { characterID: founder.characterID, events: founder.events }, joiner: { characterID: joiner.characterID, events: joiner.events } };
    fs.writeFileSync(out, `${JSON.stringify(record, replacer, 1)}\n`);
    for (const [name, each] of [["founder", founder], ["joiner", joiner]]) {
      console.log(name, each.events.map((event) => (event.kind === "notice" ? event.method : event.kind === "answer" ? `>${event.call}` : `~${Object.keys(event.changes).join("+")}`)).join(" "));
    }
    console.log("state is a", state && state.type, text(state && state.name));
  } finally {
    founder.session.close();
    joiner.session.close();
    await sleep(500);
    console.log("closed");
  }
})().catch((error) => { console.log("failed:", error && error.stack); process.exitCode = 1; });
