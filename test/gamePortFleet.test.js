"use strict";

// src/gamePort/pilotFleet.js: the fleet as the retail client's fleet service keeps it, set beside a real
// server's own word for it.
//
// test/fixtures/fleetSession.json is two real game-port sessions on an EveJS server. One pilot forms a fleet and
// invites the other, who joins. The first makes a wing and a squad, names the wing, moves the other into the
// squad and sets a message; each then asks for the wings and the fleet's state. The second leaves, then the
// first. Every notice and session change each was sent is there in order, among the answers each got.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createPilotFleet } = require("../src/gamePort/pilotFleet");

const revive = (key, value) => (value && typeof value.$long === "string" ? BigInt(value.$long) : value && typeof value.$str === "string" ? Buffer.from(value.$str, "latin1") : value);
const recording = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "fleetSession.json"), "utf8"), revive);

const text = (value) => (Buffer.isBuffer(value) ? value.toString("utf8") : value);
const field = (keyVal, name) => (keyVal.args.entries.find(([key]) => text(key) === name) ?? [])[1];
const fieldNames = (keyVal) => keyVal.args.entries.map(([key]) => text(key)).sort();
const keyVal = (entries) => ({ type: "object", name: Buffer.from("util.KeyVal"), args: { type: "dict", entries: entries.map(([key, value]) => [Buffer.from(key), value]) } });
/** A notice of the recording, by name: the nth such, counting from 0. */
const noticeOf = (pilot, method, nth = 0) => pilot.events.filter((event) => event.kind === "notice" && event.method === method)[nth];
const answersOf = (pilot, call) => pilot.events.filter((event) => event.kind === "answer" && event.call === call).map((event) => event.value);

/** What the client keeps of a fleet's state, out of one in the form GetInitState answers: comparable whoever built it. */
function kept(state) {
  const members = field(state, "members").entries.map(([, member]) => Object.fromEntries(["charID", "wingID", "squadID", "role", "job", "memberOptOuts"].map((name) => [name, field(member, name)])));
  return {
    fleetID: field(state, "fleetID"),
    motd: field(state, "motd"),
    options: field(state, "options"),
    wings: field(state, "wings"),
    members: members.sort((a, b) => Number(a.charID) - Number(b.charID)),
  };
}

/**
 * A pilot's half of the recording played to a store as the client's fleet service would take it: the first
 * GetInitState is kept, every notice is fed, wings asked for after a notice that has them asked again are kept.
 * At every later GetInitState, `beside(store, answer, index)` is handed the store and the server's own word.
 */
function replay(pilot, beside) {
  const fleet = createPilotFleet({ characterID: pilot.characterID });
  const did = [];
  let wingsOwed = false;
  for (const [index, event] of pilot.events.entries()) {
    if (event.kind === "sessionchange") {
      if ("fleetid" in event.changes) fleet.sessionChanged();
    } else if (event.kind === "notice") {
      const next = fleet.feed(event);
      did.push([event.method, next]);
      if (next.includes("wings")) wingsOwed = true;
    } else if (event.call === "GetWings" && wingsOwed) {
      fleet.setWings(event.value);
      wingsOwed = false;
    } else if (event.call === "GetInitState") {
      if (!fleet.inited) assert.equal(fleet.init(event.value), true);
      else beside(fleet, event.value, index);
    }
  }
  return { fleet, did };
}

test("the state the server answers is kept, and read back in the form it came in", () => {
  for (const pilot of [recording.founder, recording.joiner]) {
    const fleet = createPilotFleet({ characterID: pilot.characterID });
    assert.deepEqual([fleet.inited, fleet.read(), fleet.wings(), fleet.motd()], [false, null, null, null]);
    const [first] = answersOf(pilot, "GetInitState");
    assert.equal(fleet.init(first), true);
    assert.equal(fleet.inited, true);
    assert.deepEqual(fleet.read(), first);
    assert.deepEqual([fleet.wings(), fleet.motd()], [field(first, "wings"), field(first, "motd")]);
  }
  // What is no fleet's state is not kept, and leaves what was kept as it was.
  const fleet = createPilotFleet({ characterID: recording.joiner.characterID });
  const [state] = answersOf(recording.joiner, "GetInitState");
  for (const other of [null, undefined, 7, field(state, "members"), keyVal([["fleetID", 1]]), keyVal([["members", null]]), { type: "object", name: "util.KeyVal", args: null }]) {
    assert.equal(fleet.init(other), false, JSON.stringify(other, (key, value) => (typeof value === "bigint" ? String(value) : value)));
    assert.equal(fleet.inited, false);
  }
  fleet.init(state);
  assert.equal(fleet.init(null), false);
  assert.deepEqual(fleet.read(), state);
});

test("kept right by the server's notices, a fleet is what the server says it is whenever it is asked again", () => {
  for (const [name, pilot, times] of [["founder", recording.founder, 3], ["joiner", recording.joiner, 2]]) {
    let compared = 0;
    replay(pilot, (fleet, answer, index) => {
      compared += 1;
      assert.deepEqual(kept(fleet.read()), kept(answer), `${name}, at the answer that is event ${index}`);
    });
    assert.equal(compared, times, name);
  }
  // The recording has what this is about: a member joined, moved and left, wings and a squad made, a wing named,
  // a message set. Nothing was compared against an unchanged fleet.
  const states = answersOf(recording.founder, "GetInitState").map(kept);
  const [first, later] = states;
  const last = states.at(-1);
  assert.deepEqual([first.members.length, later.members.length, last.members.length], [1, 2, 1]);
  assert.deepEqual([first.wings.entries.length, later.wings.entries.length, text(first.motd), text(later.motd)], [1, 2, "", "Fly safe"]);
  assert.notDeepEqual(later.members[1].squadID, field(noticeOf(recording.founder, "OnFleetJoin").args[0], "squadID"));
});

test("each notice has the client do what it does: read the state again, ask for the wings again, or nothing", () => {
  const founder = replay(recording.founder, () => {});
  const joiner = replay(recording.joiner, () => {});
  assert.deepEqual(founder.did, [
    ["OnFleetJoin", []],
    ["OnFleetWingAdded", ["wings"]],
    ["OnFleetSquadAdded", ["wings"]],
    ["OnFleetWingNameChanged", ["wings"]],
    ["OnFleetMemberChanged", []],
    ["OnFleetMotdChanged", []],
    ["OnFleetLeave", []],
    // The founder is the last one out: the fleet is disbanded, and it is among those named.
    ["OnFleetDisbanded", ["left"]],
  ]);
  assert.deepEqual([founder.fleet.inited, founder.fleet.read()], [false, null]);
  assert.deepEqual(joiner.did, [
    ["OnFleetInvite", []],
    ["OnFleetRespawnPointsUpdate", []],
    ["OnFleetStateChange", []],
    // The pilot's own joining: InitFleet.
    ["OnFleetJoin", ["init"]],
    ["OnFleetWingAdded", ["wings"]],
    ["OnFleetSquadAdded", ["wings"]],
    ["OnFleetWingNameChanged", ["wings"]],
    ["OnFleetMemberChanged", []],
    // The pilot has been moved: FinishMove.
    ["OnFleetMove", ["move"]],
    ["OnFleetMotdChanged", []],
  ]);
  // The three the recording has none of.
  const fleet = createPilotFleet({ characterID: 7 });
  for (const method of ["OnFleetWingDeleted", "OnFleetSquadDeleted", "OnFleetSquadNameChanged"]) assert.deepEqual(fleet.feed({ method, args: [1n, "x"] }), ["wings"], method);
  assert.deepEqual(fleet.feed({ method: "OnFleetBroadcast", args: [] }), []);
  assert.deepEqual(fleet.feed({ method: "OnFleetWingAdded", args: null }), ["wings"]);
});

test("a member who joins is kept as the server sent it; one who is changed is a new record of six things only", () => {
  const { founder } = recording;
  const fleet = createPilotFleet({ characterID: founder.characterID });
  fleet.init(answersOf(founder, "GetInitState")[0]);
  const joined = noticeOf(founder, "OnFleetJoin");
  const charID = field(joined.args[0], "charID");
  fleet.feed(joined);
  const members = () => new Map(field(fleet.read(), "members").entries.map(([key, member]) => [Number(key), member]));
  assert.deepEqual([[...members().keys()], members().get(charID)], [[founder.characterID, charID], joined.args[0]]);
  assert.equal(field(members().get(charID), "shipTypeID"), 648);
  // fleetSvc.OnFleetMemberChanged: self.members[charID] = KeyVal() with charID, wingID, squadID, role, job and
  // memberOptOuts set. The ship it joined in is not among them.
  const changed = noticeOf(founder, "OnFleetMemberChanged");
  fleet.feed(changed);
  const record = members().get(charID);
  assert.deepEqual(fieldNames(record), ["charID", "job", "memberOptOuts", "role", "squadID", "wingID"]);
  assert.deepEqual(["charID", "wingID", "squadID", "role", "job", "memberOptOuts"].map((name) => field(record, name)), [changed.args[0], changed.args[7], changed.args[8], changed.args[9], changed.args[10], changed.args[11]]);
  // The old five are not what is kept.
  assert.notDeepEqual(changed.args[7], changed.args[2]);
  // It is a KeyVal as the others are, and is under the key the member came under.
  assert.deepEqual([record.type, text(record.name)], ["object", "util.KeyVal"]);
  assert.deepEqual(field(fleet.read(), "members").entries.map(([key]) => Number(key)), [founder.characterID, charID]);
  // A member the client never heard of is given a record all the same, and a notice cut short changes nothing.
  fleet.feed({ method: "OnFleetMemberChanged", args: [99, 1, 2, 3, 4, 5, null, 20, 30, 3, 0, null, false] });
  assert.deepEqual(["charID", "wingID", "squadID", "role", "job"].map((name) => field(members().get(99), name)), [99, 20, 30, 3, 0]);
  fleet.feed({ method: "OnFleetMemberChanged", args: [charID, 1, 2, 3, 4, 5, null, 20, 30, 3, 0] });
  assert.deepEqual(members().get(charID), record);
  // A member who joins again is the record the server sends now.
  fleet.feed(joined);
  assert.deepEqual(members().get(charID), joined.args[0]);
});

test("a member who leaves is gone, the pilot's own leaving clears everything, and a disbanded fleet's members have each left", () => {
  const { founder } = recording;
  const [, withTwo] = answersOf(founder, "GetInitState");
  const other = recording.joiner.characterID;
  const fresh = () => { const fleet = createPilotFleet({ characterID: founder.characterID }); fleet.init(withTwo); return fleet; };
  const charIDs = (fleet) => field(fleet.read(), "members").entries.map(([key]) => Number(key));

  let fleet = fresh();
  assert.deepEqual(charIDs(fleet), [founder.characterID, other]);
  assert.deepEqual([fleet.feed(noticeOf(founder, "OnFleetLeave")), charIDs(fleet)], [[], [founder.characterID]]);
  // One who was never there: nothing.
  assert.deepEqual([fleet.feed({ method: "OnFleetLeave", args: [99] }), charIDs(fleet)], [[], [founder.characterID]]);
  assert.deepEqual([fleet.feed({ method: "OnFleetLeave", args: [BigInt(founder.characterID)] }), fleet.inited, fleet.read(), fleet.wings(), fleet.motd()], [["left"], false, null, null, null]);

  // OnFleetDisbanded(charIDs): others only, and with the pilot among them (a list, or a tuple).
  fleet = fresh();
  assert.deepEqual([fleet.feed({ method: "OnFleetDisbanded", args: [{ type: "list", items: [other, 99] }] }), charIDs(fleet)], [[], [founder.characterID]]);
  fleet = fresh();
  assert.deepEqual([fleet.feed({ method: "OnFleetDisbanded", args: [[other, founder.characterID]] }), fleet.inited], [["left"], false]);
  fleet = fresh();
  assert.deepEqual([fleet.feed({ method: "OnFleetDisbanded", args: [[founder.characterID, other]] }), fleet.inited], [["left"], false]);
  // A notice with nothing in it is nobody's leaving.
  fleet = fresh();
  assert.deepEqual([fleet.feed({ method: "OnFleetLeave", args: null }), fleet.feed({ method: "OnFleetDisbanded", args: null }), charIDs(fleet)], [[], [], [founder.characterID, other]]);
  // A member is the same member whether the server writes its number as a long or not.
  const long = createPilotFleet({ characterID: founder.characterID });
  const asLongs = { ...withTwo, args: { ...withTwo.args, entries: withTwo.args.entries.map(([name, value]) => (text(name) === "members" ? [name, { type: "dict", entries: value.entries.map(([key, member]) => [BigInt(key), member]) }] : [name, value])) } };
  long.init(asLongs);
  assert.deepEqual([long.feed({ method: "OnFleetLeave", args: [other] }), charIDs(long)], [[], [founder.characterID]]);
  assert.deepEqual(long.feed({ method: "OnFleetLeave", args: [founder.characterID] }), ["left"]);
});

test("options and the message are kept as they are sent; a session whose fleet changes has no members until it reads again", () => {
  const { joiner } = recording;
  const [state] = answersOf(joiner, "GetInitState");
  const fleet = createPilotFleet({ characterID: joiner.characterID });
  fleet.init(state);
  const options = keyVal([["isFreeMove", true], ["isRegistered", false], ["autoJoinSquadID", 5n]]);
  assert.deepEqual(fleet.feed({ method: "OnFleetOptionsChanged", args: [field(state, "options"), options] }), []);
  assert.deepEqual(field(fleet.read(), "options"), options);
  fleet.feed(noticeOf(joiner, "OnFleetMotdChanged"));
  assert.deepEqual([text(fleet.motd()), text(field(fleet.read(), "motd"))], ["Fly safe", "Fly safe"]);
  // A message the server takes away is None, which is what has the client ask for it (fleetSvc.GetMotd).
  fleet.feed({ method: "OnFleetMotdChanged", args: [null, false] });
  assert.equal(fleet.motd(), null);
  fleet.setMotd(Buffer.from("asked"));
  assert.equal(text(field(fleet.read(), "motd")), "asked");
  fleet.setWings({ type: "dict", entries: [] });
  assert.deepEqual([fleet.wings(), field(fleet.read(), "wings")], [{ type: "dict", entries: [] }, { type: "dict", entries: [] }]);
  // Nothing else of the state is touched by any of it.
  for (const name of ["fleetID", "isLootLogging", "squads", "members"]) assert.deepEqual(field(fleet.read(), name), field(state, name), name);

  fleet.sessionChanged();
  assert.deepEqual([fleet.inited, field(fleet.read(), "members").entries, text(fleet.motd())], [true, [], "asked"]);
  fleet.clear();
  assert.deepEqual([fleet.inited, fleet.read(), fleet.wings(), fleet.motd()], [false, null, null, null]);
});

test("several notices in one are each taken as its own, in order, and what the client does next is done once", () => {
  const { founder } = recording;
  const fleet = createPilotFleet({ characterID: founder.characterID });
  fleet.init(answersOf(founder, "GetInitState")[1]);
  const other = recording.joiner.characterID;
  const changed = (wingID, role) => [Buffer.from("OnFleetMemberChanged"), [other, 1, 2, 3, 4, 0, null, wingID, 30, role, 0, null, false]];
  // BroadcastStuffGPCS: a "__MultiEvent" is a list of (name, args), scattered one by one.
  const next = fleet.feed({ method: "__MultiEvent", args: [changed(20, 3), ["OnFleetWingAdded", [5]], changed(21, 2), { type: "list", items: ["OnFleetSquadAdded", { type: "list", items: [5, 6] }] }] });
  assert.deepEqual(next, ["wings"]);
  const record = field(fleet.read(), "members").entries.find(([key]) => Number(key) === other)[1];
  assert.deepEqual([field(record, "wingID"), field(record, "role")], [21, 2]);
  // Arguments that came as a list are arguments all the same.
  fleet.feed({ method: "__MultiEvent", args: [{ type: "list", items: ["OnFleetLeave", { type: "list", items: [other] }] }] });
  assert.equal(field(fleet.read(), "members").entries.some(([key]) => Number(key) === other), false);
  // What the client does next is in the order the notices came in.
  const own = keyVal([["charID", founder.characterID]]);
  assert.deepEqual(fleet.feed({ method: "__MultiEvent", args: [["OnFleetWingDeleted", [5]], ["OnFleetJoin", [own]], ["OnFleetSquadDeleted", [6]]] }), ["wings", "init"]);
  // One that names the pilot's own joining and its leaving says both, in that order.
  assert.deepEqual(fleet.feed({ method: "__MultiEvent", args: [["OnFleetJoin", [own]], ["OnFleetLeave", [founder.characterID]]] }), ["init", "left"]);
  // An empty one, and one with nothing readable in it: nothing.
  assert.deepEqual([fleet.feed({ method: "__MultiEvent", args: [] }), fleet.feed({ method: "__MultiEvent", args: [null, 7, []] }), fleet.feed({ method: "__MultiEvent", args: null })], [[], [], []]);
});

test("notices that come before any state is kept are taken all the same, and the state that comes is the state", () => {
  const { joiner } = recording;
  const fleet = createPilotFleet({ characterID: joiner.characterID });
  // On this server the pilot's own OnFleetJoin comes before the acceptance is answered: InitFleet, and nothing kept.
  assert.deepEqual([fleet.feed(noticeOf(joiner, "OnFleetJoin")), fleet.inited, fleet.read()], [["init"], false, null]);
  fleet.feed({ method: "OnFleetJoin", args: [keyVal([["charID", 99]])] });
  fleet.feed({ method: "OnFleetMotdChanged", args: ["early", true] });
  assert.deepEqual([fleet.inited, fleet.read(), fleet.motd()], [false, null, "early"]);
  const [state] = answersOf(joiner, "GetInitState");
  fleet.init(state);
  assert.deepEqual(fleet.read(), state);
});

test("the options as they are kept, and whether the pilot is the fleet's boss, are what the client would go by", () => {
  const { founder, joiner } = recording;
  // fleetSvc.IsBoss: the pilot's own record's job has the creator's bit (evefleet.fleetJobCreator, 2).
  const boss = createPilotFleet({ characterID: founder.characterID });
  const member = createPilotFleet({ characterID: joiner.characterID });
  assert.deepEqual([boss.isBoss(), boss.options(), member.isBoss()], [false, null, false]);
  boss.init(answersOf(founder, "GetInitState")[1]);
  member.init(answersOf(joiner, "GetInitState")[0]);
  assert.deepEqual([boss.isBoss(), member.isBoss()], [true, false]);
  assert.deepEqual(boss.options(), field(answersOf(founder, "GetInitState")[1], "options"));
  // The boss hands the fleet over: each record is changed by its own notice, and the job is what is read.
  const handed = (charID, job) => ({ method: "OnFleetMemberChanged", args: [charID, 1n, -1, -1, 1, 2 - job, null, -1, -1, 1, job, null, false] });
  for (const fleet of [boss, member]) fleet.feed({ method: "__MultiEvent", args: [["OnFleetMemberChanged", handed(joiner.characterID, 2).args], ["OnFleetMemberChanged", handed(founder.characterID, 0).args]] });
  assert.deepEqual([boss.isBoss(), member.isBoss()], [false, true]);
  // A job with other bits beside the creator's is the boss's still; one without it is not.
  member.feed(handed(joiner.characterID, 3));
  assert.equal(member.isBoss(), true);
  member.feed(handed(joiner.characterID, 1));
  assert.equal(member.isBoss(), false);
  // The options the server sends afterwards are the ones kept.
  const options = keyVal([["isFreeMove", true], ["isRegistered", false], ["autoJoinSquadID", null]]);
  boss.feed({ method: "OnFleetOptionsChanged", args: [boss.options(), options] });
  assert.deepEqual(boss.options(), options);
  // Out of the fleet there are none, and nobody is its boss.
  member.feed(handed(joiner.characterID, 2));
  member.clear();
  assert.deepEqual([member.isBoss(), member.options()], [false, null]);
});

test("the join requests are kept from the server's notices, and asked for once where none is kept", () => {
  const { founder } = recording;
  const fleet = createPilotFleet({ characterID: founder.characterID });
  const empty = { type: "dict", entries: [] };
  assert.deepEqual(fleet.joinRequests(), empty);
  fleet.init(answersOf(founder, "GetInitState")[0]);
  // fleetJoinRequestWnd.LoadJoinRequests: the window asks where the service keeps none (fleetSvc.GetJoinRequests).
  // Shown once for a fleet: it is asked then, and not again however empty the answer.
  assert.equal(fleet.openJoinRequests(), true);
  assert.equal(fleet.openJoinRequests(), false);
  fleet.setJoinRequests(empty);
  assert.deepEqual([fleet.openJoinRequests(), fleet.joinRequests()], [false, empty]);
  // OnFleetJoinRequest(info): self.joinRequests[info.charID] = info.
  const request = (charID, corpID = 98000000) => keyVal([["charID", charID], ["corpID", corpID], ["allianceID", null], ["warFactionID", null], ["securityStatus", 0.5]]);
  assert.deepEqual(fleet.feed({ method: "OnFleetJoinRequest", args: [request(140000003)] }), []);
  fleet.feed({ method: "OnFleetJoinRequest", args: [request(140000004n)] });
  assert.deepEqual(fleet.joinRequests().entries.map(([charID, info]) => [Number(charID), Number(field(info, "charID"))]), [[140000003, 140000003], [140000004, 140000004]]);
  // The same pilot asking again is the request the server sends now, in its place.
  fleet.feed({ method: "OnFleetJoinRequest", args: [request(140000003, 98000001)] });
  assert.deepEqual(fleet.joinRequests().entries.map(([charID, info]) => [Number(charID), field(info, "corpID")]), [[140000003, 98000001], [140000004, 98000000]]);
  // OnJoinRequestUpdate(joinRequests): self.joinRequests = joinRequests, whatever was kept.
  const updated = { type: "dict", entries: [[140000005, request(140000005)]] };
  fleet.feed({ method: "OnJoinRequestUpdate", args: [updated] });
  assert.deepEqual(fleet.joinRequests(), updated);
  fleet.feed({ method: "OnJoinRequestUpdate", args: [empty] });
  assert.deepEqual(fleet.joinRequests(), empty);
  // What the server answers when asked is kept the same way; an answer that is no dict leaves none.
  fleet.setJoinRequests(updated);
  assert.deepEqual(fleet.joinRequests(), updated);
  fleet.setJoinRequests(null);
  assert.deepEqual(fleet.joinRequests(), empty);
  // A pilot is the same pilot whether the server writes its number as a long or not.
  fleet.setJoinRequests({ type: "dict", entries: [[140000005n, request(140000005)]] });
  fleet.feed({ method: "OnFleetJoinRequest", args: [request(140000005, 98000002)] });
  assert.deepEqual(fleet.joinRequests().entries.map(([charID, info]) => [charID, field(info, "corpID")]), [[140000005n, 98000002]]);
  // A request that comes before the window was ever shown is kept, and then nothing needs asking.
  const early = createPilotFleet({ characterID: founder.characterID });
  early.feed({ method: "OnFleetJoinRequest", args: [request(140000003)] });
  assert.equal(early.openJoinRequests(), false);
  // Out of the fleet none is kept, and the next fleet's are asked for afresh.
  fleet.setJoinRequests(updated);
  fleet.clear();
  assert.deepEqual([fleet.joinRequests(), fleet.openJoinRequests(), fleet.openJoinRequests()], [empty, true, false]);
});

test("the composition is kept for twenty seconds, and for no time once the pilot's own record has changed", () => {
  const { founder, joiner } = recording;
  const fleet = createPilotFleet({ characterID: founder.characterID });
  const composition = (shipTypeID) => ({ type: "list", items: [keyVal([["characterID", founder.characterID], ["shipTypeID", shipTypeID]])] });
  // fleetSvc.GetFleetComposition: asked where fleetCompositionTimestamp < now, and then good for FLEETCOMPOSITION_CACHE_TIME.
  const start = 1_800_000_000_000;
  assert.deepEqual([fleet.composition(), fleet.compositionDue(start), fleet.compositionDue(0)], [null, true, false]);
  fleet.setComposition(composition(588), start);
  assert.deepEqual(fleet.composition(), composition(588));
  assert.deepEqual([start, start + 1, start + 19_999, start + 20_000, start + 20_001].map((now) => fleet.compositionDue(now)), [false, false, false, false, true]);
  // Asked again, it is good for twenty seconds from then.
  fleet.setComposition(composition(648), start + 30_000);
  assert.deepEqual([fleet.composition(), fleet.compositionDue(start + 49_000), fleet.compositionDue(start + 50_001)], [composition(648), false, true]);
  // OnFleetMemberChanged for another member changes nothing of this; for the pilot's own, the kept one is good no longer.
  fleet.init(answersOf(founder, "GetInitState")[1]);
  const changed = (charID) => ({ method: "OnFleetMemberChanged", args: [charID, 1n, -1, -1, 1, 2, null, -1, -1, 1, 2, null, false] });
  fleet.feed(changed(joiner.characterID));
  assert.equal(fleet.compositionDue(start + 31_000), false);
  fleet.feed(changed(founder.characterID));
  assert.deepEqual([fleet.compositionDue(start + 31_000), fleet.composition()], [true, composition(648)]);
  // Several changes in one notification, the pilot's own among them.
  fleet.setComposition(composition(648), start + 40_000);
  fleet.feed({ method: "__MultiEvent", args: [["OnFleetMemberChanged", changed(joiner.characterID).args], ["OnFleetMemberChanged", changed(founder.characterID).args]] });
  assert.equal(fleet.compositionDue(start + 41_000), true);
  // An answer that is nothing is kept as nothing, and is good for its time all the same.
  fleet.setComposition(null, start + 50_000);
  assert.deepEqual([fleet.composition(), fleet.compositionDue(start + 51_000)], [null, false]);
  // Out of the fleet none is kept, and the next fleet's is due at once.
  fleet.setComposition(composition(588), start + 60_000);
  fleet.clear();
  assert.deepEqual([fleet.composition(), fleet.compositionDue(start + 60_001)], [null, true]);
});
