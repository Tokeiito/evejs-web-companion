// A mission's page laid out. The templates are made up, in the shape the client's are in; the client's own
// are read from its install. The missions are the recorded ones (missionObjectives.fixtures.ts).

import test from "node:test";
import assert from "node:assert/strict";

import {
  PAGE_LABELS, PAGE_MESSAGES, PAGE_WORD_LABELS, decodeClientMission, fixText, missionPage, pageAgentToLocate, pageMessageIDs, pageMissionState, pageNameRefs, pageObjectives,
  pageOnMissionChange, pageSystemIDs, type ClientMission, type MissionPageInput, type PageContext,
} from "./missionPage.ts";
import { decodeObjectives, type MissionObjectives } from "./missionObjectives.ts";
import { COURIER_OFFERED_GATEWAY, ENCOUNTER_ACCEPTED_GATEWAY, ENCOUNTER_OFFERED_GATEWAY } from "./missionObjectives.fixtures.ts";
import type { JsonValue } from "./wire.ts";
import { INTERVAL_LABELS, SHORT_INTERVAL_WORD_LABELS } from "./timeInterval.ts";

const L = PAGE_LABELS;
const TEMPLATES: Record<string, string> = {
  [L.expired]: "Gone",
  [L.completed]: "Done",
  [L.offered]: "<b>On offer</b>",
  [L.offerExpiresIn]: "Offer goes in {[numeric]expirationTime}",
  [L.missionExpiresIn]: "Mission ends in {[numeric]expirationTime}",
  [L.offerDoesNotExpire]: "The offer stays",
  [L.missionDoesNotExpire]: "The mission stays",
  [L.importantStandings]: "<b><i>This one counts.</i></b>",
  [L.agentLevel]: "Grade {level}",
  [L.effectiveStanding]: "Stands at {[numeric]effectiveStanding, decimalPlaces=1}",
  [L.effectiveStandingLow]: "Stands at <b>{[numeric]effectiveStanding, decimalPlaces=1}</b>, too low",
  [L.briefingTitle]: "What it is",
  [L.objectivesTitle]: "To do",
  [L.agentLocation]: "Agent is at",
  [L.cargo]: "Load",
  [L.pickup]: "From",
  [L.dropOff]: "To",
  [L.objectiveLocation]: "Place",
  [L.reportTo]: "See: {agentLink}",
  [L.transportBlurb]: "Carry these:",
  [L.fetchBlurb]: "Bring these:",
  [L.dungeonBody]: "Destroy them",
  [L.optionalBody]: "Destroy them, if you like",
  [L.cargoWithSize]: "{cargoDescription} ({[numeric]size, decimalPlaces=1} m3)",
  [L.thisStation]: "Right here",
  [L.thisSolarSystem]: "In this system",
  [L.collateralTitle]: "Held",
  [L.collateralText]: "You put this up:",
  [L.grantedItems]: "Given",
  [L.grantedText]: "Yours on accepting:",
  [L.rewardsTitle]: "Pay",
  [L.bonusTitle]: "Extra",
  [L.securityTax]: "<b>Less is paid</b> hereabouts",
  [L.loyaltyPointsShort]: "{[numeric]lpAmount, useGrouping} pts",
  [L.researchPoints]: "{[numeric]rpAmount, useGrouping} research",
  [L.referral]: "A word to {[character]agentID.name}",
  [L.isk]: "{[numeric]amount, useGrouping, decimalPlaces=2} ISK",
  [L.itemLocation]: "{[item]typeID.name} in {[location]locationID.name}",
  [L.quantityAndItem]: "{[numeric]quantity, useGrouping} x {[item]item.name}",
  [L.startConversation]: "Talk",
};

const NOW = 134_000_000_000_000_000n;
const HOUR = 36_000_000_000n;
const RECORD: ClientMission = { nameID: 900260, messages: { [PAGE_MESSAGES.briefing]: 900954, [PAGE_MESSAGES.offered]: 900955, [PAGE_MESSAGES.extraHeader]: 900956, [PAGE_MESSAGES.extraBody]: 900957 } };

const context = (overrides: Partial<PageContext> = {}): PageContext => ({
  templates: TEMPLATES,
  nameOf: (kind, id) => `${kind}#${id}`,
  locationID: null,
  stationID: null,
  solarSystemID: null,
  now: NOW,
  messageText: (messageID) => `Name ${messageID}`,
  sayOfMission: (messageID) => `Message <b>${messageID}</b>`,
  say: (message) => (message.messageID === null ? message.text : `Agent's <i>${message.messageID}</i> of ${message.contentID}`),
  securityOf: () => null,
  ...overrides,
});
const mission = (fixture: JsonValue): MissionObjectives => decodeObjectives(fixture) as MissionObjectives;
const input = (overrides: Partial<MissionPageInput> = {}): MissionPageInput => ({
  missionState: 1,
  important: false,
  expirationTime: null,
  missionTitleID: 57959,
  missionTitle: null,
  objectives: null,
  record: null,
  agent: null,
  agentSolarSystemID: null,
  standings: null,
  skillLevel: null,
  ...overrides,
});
const AGENT = { agentID: 3008416, agentTypeID: 2, divisionID: 22, level: 1, stationID: 60000004, corporationID: 1000002, factionID: 500001, divisionNameID: 900109 };
const dict = (entries: Array<[string, unknown]>) => ({ type: "dict", entries }) as unknown as JsonValue;
const tuple = (...items: unknown[]) => ({ type: "tuple", items }) as unknown as JsonValue;
const list = (...items: unknown[]) => ({ type: "list", items }) as unknown as JsonValue;
const place = (locationID: number, solarsystemID: number) => dict([["locationID", locationID], ["solarsystemID", solarsystemID], ["typeID", 1531]]);
const cargo = (hasCargo: boolean, volume = 0.1) => dict([["typeID", 2595], ["quantity", 3], ["volume", volume], ["hasCargo", hasCargo]]);
/** An answer with these parts, in the shape the server sends. */
const answer = (parts: Array<[string, unknown]>): MissionObjectives => {
  const base: Array<[string, unknown]> = [["contentID", 2156], ["missionState", 2], ["completionStatus", 0]];
  // A part given replaces the base's: a dict is read by its first entry of a name.
  return decodeObjectives(dict([...base.filter(([name]) => !parts.some(([given]) => given === name)), ...parts])) as MissionObjectives;
};

// ── what the page is made from ───────────────────────────────────────────────

test("the client's record of a mission is read for its name and its messages, and for nothing it does not hold", () => {
  assert.deepEqual(decodeClientMission({ nameID: 900260, contentTemplate: "x", messages: { "messages.mission.briefing": 900954, odd: "text", none: 0, half: 1.5 } }), {
    nameID: 900260,
    messages: { "messages.mission.briefing": 900954 },
  });
  assert.deepEqual(decodeClientMission({}), { nameID: null, messages: {} });
  assert.deepEqual(decodeClientMission({ nameID: -1, messages: [1, 2] }), { nameID: null, messages: {} });
  for (const nothing of [null, undefined, 3, "text", [1]]) {
    assert.equal(decodeClientMission(nothing), null);
  }
});

test("the record's keys the page reads are the client's own", () => {
  assert.deepEqual(PAGE_MESSAGES, {
    briefing: "messages.mission.briefing",
    offered: "messages.mission.offered.agentsays",
    extraHeader: "messages.mission.extrainfo.header",
    extraBody: "messages.mission.extrainfo.body",
  });
});

test("the messages the page words are the record's name, briefing, offer and extra information, and no other", () => {
  assert.deepEqual(pageMessageIDs(RECORD), [900260, 900954, 900955, 900956, 900957]);
  assert.deepEqual(pageMessageIDs({ nameID: null, messages: { [PAGE_MESSAGES.briefing]: 5, "messages.mission.completed.agentsays": 6 } }), [5]);
  assert.deepEqual(pageMessageIDs(null), []);
});

test("every label the page uses is asked for", () => {
  // Its own, and those its time left is written with.
  assert.deepEqual([...PAGE_WORD_LABELS].sort(), [...Object.values(L), ...SHORT_INTERVAL_WORD_LABELS, "UI/Agents/LocationWrapper", "UI/Agents/LowSecWarning"].sort());
  assert.ok(PAGE_WORD_LABELS.includes("/Carbon/UI/Common/WrittenDateTimeQuantityShort/Hour"));
  assert.ok(PAGE_WORD_LABELS.includes("UI/Chat/StartConversationAgent"));
  assert.ok(PAGE_WORD_LABELS.includes("UI/Agents/AgentEntry/Level"));
  assert.ok(PAGE_WORD_LABELS.includes("UI/Agents/Dialogue/EffectiveStanding"));
  assert.ok(PAGE_WORD_LABELS.includes("UI/Agents/Dialogue/EffectiveStandingLow"));
  assert.ok(PAGE_WORD_LABELS.includes("UI/Journal/JournalWindow/Agents/OfferExpiresIn"));
  assert.ok(PAGE_WORD_LABELS.includes("UI/Agents/StandardMission/SecurityTaxMessage"));
});

test("an answer about this mission is kept; one about another mission, or none, changes nothing", () => {
  const held = mission(COURIER_OFFERED_GATEWAY);
  const fresh = { ...held, missionState: 2 };
  assert.equal(pageObjectives(held, fresh, 2156), fresh);
  assert.equal(pageObjectives(null, fresh, 2156), fresh);
  assert.equal(pageObjectives(held, null, 2156), held);
  assert.equal(pageObjectives(held, mission(ENCOUNTER_OFFERED_GATEWAY), 2156), held);
  assert.equal(pageObjectives(held, { ...fresh, contentID: null }, null), held);
  assert.equal(pageObjectives(null, null, 2156), null);
});

test("the server saying a mission changed gives its page a state and a fresh read, a fresh read alone, or closes it", () => {
  assert.deepEqual(pageOnMissionChange("completed"), { missionState: 4 });
  assert.deepEqual(pageOnMissionChange("accepted"), { missionState: 2 });
  for (const action of ["modified", "dungeon_moved", "failed", "offer_expired"]) {
    assert.deepEqual(pageOnMissionChange(action), { missionState: null }, action);
  }
  for (const action of ["offered", "declined", "offer_declined", "offer_removed", "quit", "reset"]) {
    assert.equal(pageOnMissionChange(action), "close", action);
  }
  for (const action of ["prolong", "research_started", "research_update_ppd", "talk_to_completed", ""]) {
    assert.equal(pageOnMissionChange(action), null, action);
  }
});

test("the mission's state is the journal's until its objectives are read, and theirs after", () => {
  assert.equal(pageMissionState(input({ missionState: 1 })), 1);
  assert.equal(pageMissionState(input({ missionState: 1, objectives: mission(ENCOUNTER_ACCEPTED_GATEWAY) })), 2);
  assert.equal(pageMissionState(input({ missionState: 2, objectives: { ...mission(COURIER_OFFERED_GATEWAY), missionState: null } })), null);
});

test("text is tidied as the client tidies it before it is shown", () => {
  assert.equal(fixText("  One\r\ntwo\nthree<br><br>  "), "Onetwothree");
  assert.equal(fixText("a<br>b<br>"), "a<br>b");
  assert.equal(fixText("<br>"), "");
});

// ── the page ─────────────────────────────────────────────────────────────────

test("an offered courier: the offer's words, cargo then pick-up then drop-off, and what it pays", () => {
  const page = missionPage(input({ expirationTime: NOW + 5n * HOUR, objectives: mission(COURIER_OFFERED_GATEWAY), record: RECORD }), context({ locationID: 60000004, stationID: 60000004, solarSystemID: 30002780 }));
  assert.deepEqual(page, {
    // The record's name, not the journal's.
    title: "Name 900260",
    state: { kind: "offered", text: "On offer" },
    expires: `Offer goes in ${5n * HOUR}`,
    important: null,
    agent: null,
    corporation: null,
    // On offer, what the agent says on offering stands for the briefing.
    briefing: { title: "What it is", text: "Message 900955" },
    objectives: {
      title: "To do",
      general: {
        briefing: "Carry these:",
        steps: [
          { kind: "cargo", state: "open", title: "Load", where: null, text: "1 x type#2595 (0.1 m3)" },
          // The pilot is docked where the package is.
          { kind: "pickup", state: "done", title: "From", where: "Right here", text: "station#60000004" },
          { kind: "dropoff", state: "open", title: "To", where: null, text: "station#60000019" },
        ],
      },
      extra: { briefing: null, steps: [] },
    },
    collateral: null,
    granted: null,
    rewards: { title: "Pay", rewards: ["13,800.00 ISK", "49 pts"] },
    bonusRewards: { title: "Extra", rewards: ["17,000.00 ISK"] },
    // No agent is known here, so there is nowhere to be safe in.
    reducedRewards: null,
    extra: { title: "Message 900956", text: "Message 900957" },
    talk: "Talk",
  });
});

test("an accepted mission to fight: the briefing itself, the dungeon in the agent's words, and no state to speak of", () => {
  const record: ClientMission = { nameID: null, messages: { [PAGE_MESSAGES.briefing]: 7, [PAGE_MESSAGES.offered]: 8 } };
  const page = missionPage(input({ missionState: 1, missionTitleID: 57212, expirationTime: NOW + HOUR, objectives: mission(ENCOUNTER_ACCEPTED_GATEWAY), record }), context({ solarSystemID: 30002779, locationID: 30002779 }));
  // The objectives say accepted, whatever the journal's line said.
  assert.equal(page.state, null);
  assert.equal(page.expires, `Mission ends in ${HOUR}`);
  // With no name in the record, the journal's.
  assert.equal(page.title, "Name 57212");
  assert.deepEqual(page.briefing, { title: "What it is", text: "Message 7" });
  assert.deepEqual(page.objectives, {
    title: "To do",
    general: { briefing: null, steps: [] },
    extra: { briefing: "Agent's 115502 of 13735", steps: [{ kind: "dungeon", state: "open", title: "Place", where: "In this system", text: "system#30002779" }] },
  });
  assert.deepEqual(page.rewards, { title: "Pay", rewards: ["65,000.00 ISK", "87 pts"] });
  assert.deepEqual(page.bonusRewards, { title: "Extra", rewards: ["80,000.00 ISK"] });
  assert.equal(page.extra, null);
});

test("a page with nothing read yet has its name and its state from the journal, and no more", () => {
  assert.deepEqual(missionPage(input({ missionState: 2, missionTitle: "Told as text" }), context()), {
    title: "Told as text", state: null, expires: null, important: null, agent: null, corporation: null, briefing: null, objectives: null, collateral: null, granted: null, rewards: null, bonusRewards: null, reducedRewards: null, extra: null, talk: "Talk",
  });
  assert.equal(missionPage(input({ missionTitleID: null }), context()).title, null);
  // A name the client has no text for is no name.
  assert.equal(missionPage(input({ record: RECORD }), context({ messageText: () => null })).title, null);
  assert.equal(missionPage(input({ record: RECORD, missionTitle: "Told as text" }), context({ messageText: () => null })).title, "Told as text");
  // The record's name comes before anything the journal said.
  assert.equal(missionPage(input({ record: RECORD, missionTitle: "Told as text" }), context()).title, "Name 900260");
});

test("the state: expired before offered, completed after, and none for a mission under way", () => {
  const state = (overrides: Partial<MissionPageInput>) => missionPage(input(overrides), context()).state;
  assert.deepEqual(state({ missionState: 0 }), { kind: "offered", text: "On offer" });
  assert.deepEqual(state({ missionState: 1, expirationTime: NOW - 1n }), { kind: "expired", text: "Gone" });
  assert.deepEqual(state({ missionState: 2, expirationTime: NOW - 1n }), { kind: "expired", text: "Gone" });
  assert.deepEqual(state({ missionState: 4 }), { kind: "completed", text: "Done" });
  assert.equal(state({ missionState: 2 }), null);
  assert.equal(state({ missionState: 3 }), null);
  assert.equal(state({ missionState: null }), null);
  // No expiry, or an expiry of nought, is not expired.
  assert.deepEqual(state({ missionState: 1, expirationTime: 0n }), { kind: "offered", text: "On offer" });
  // Without the client's words the state is known and not said.
  assert.deepEqual(missionPage(input({ missionState: 1 }), context({ templates: {} })).state, { kind: "offered", text: null });
});

test("when it expires: the time left, for an offer or a mission under way, and nothing once it is over", () => {
  const expires = (overrides: Partial<MissionPageInput>) => missionPage(input(overrides), context()).expires;
  assert.equal(expires({ missionState: 0, expirationTime: NOW + 7n }), "Offer goes in 7");
  assert.equal(expires({ missionState: 1, expirationTime: NOW + 7n }), "Offer goes in 7");
  assert.equal(expires({ missionState: 2, expirationTime: NOW + 7n }), "Mission ends in 7");
  assert.equal(expires({ missionState: 3, expirationTime: NOW + 7n }), "Mission ends in 7");
  // To the very tick: not yet expired, and nothing left.
  assert.equal(expires({ missionState: 1, expirationTime: NOW }), "The offer stays");
  assert.equal(expires({ missionState: 2, expirationTime: NOW }), "The mission stays");
  for (const over of [4, 5, 6, 7, null]) {
    assert.equal(expires({ missionState: over, expirationTime: NOW + 7n }), null, String(over));
  }
  assert.equal(expires({ missionState: 1, expirationTime: NOW - 1n }), null);
  assert.equal(expires({ missionState: 1, expirationTime: null }), null);
  assert.equal(expires({ missionState: 1, expirationTime: 0n }), null);
});

test("the time left is written the client's short way when its words for an interval are to hand, and this page's way without them", () => {
  const ASKS = "Goes in {[timeinterval]expirationTime.shortWrittenForm}";
  const units = { [INTERVAL_LABELS.shortPart("day")]: "{[numeric]value} days", [INTERVAL_LABELS.shortPart("hour")]: "{[numeric]value} hrs", [INTERVAL_LABELS.shortPart("second")]: "{[numeric]value} secs", [INTERVAL_LABELS.shortElements(2)]: "{value1}, {value2}", [INTERVAL_LABELS.shortElements(3)]: "{value1}, {value2}, {value3}" };
  const expires = (left: bigint, templates: Record<string, string>) => missionPage(input({ missionState: 1, expirationTime: NOW + left }), context({ templates: { ...templates, [L.offerExpiresIn]: ASKS } })).expires;
  assert.equal(expires(2n * 24n * HOUR + 5n * HOUR, units), "Goes in 2 days, 5 hrs");
  // Rounded up to the second, as the client rounds.
  assert.equal(expires(5n * HOUR + 1n, units), "Goes in 5 hrs, 1 secs");
  // A unit the client's words are not to hand for: this page's own short form, whole.
  assert.equal(expires(5n * HOUR + 3n * 600_000_000n, units), "Goes in 5h 3m");
  assert.equal(expires(2n * 24n * HOUR + 5n * HOUR, {}), "Goes in 2d 5h");
});

test("a mission that matters to standings says so, whether the journal or the objectives say it does", () => {
  const important = (overrides: Partial<MissionPageInput>) => missionPage(input(overrides), context()).important;
  assert.equal(important({ important: true }), "This one counts.");
  assert.equal(important({ objectives: { ...mission(COURIER_OFFERED_GATEWAY), importantStandings: true } }), "This one counts.");
  assert.equal(important({ objectives: mission(COURIER_OFFERED_GATEWAY) }), null);
  assert.equal(important({}), null);
});

test("the agent's card is its level, its name and its division; its corporation's, the corporation and its faction", () => {
  const page = missionPage(input({ agent: AGENT }), context());
  assert.deepEqual(page.agent, { level: "Grade 1", name: "owner#3008416", division: "Name 900109" });
  assert.deepEqual(page.corporation, { standing: null, standingLow: false, name: "corporation#1000002", faction: "faction#500001" });
  // What is not known is left off its card, and the card stays.
  const bare = missionPage(input({ agent: { ...AGENT, level: null, divisionNameID: null, factionID: null } }), context());
  assert.deepEqual(bare.agent, { level: null, name: "owner#3008416", division: null });
  assert.deepEqual(bare.corporation, { standing: null, standingLow: false, name: "corporation#1000002", faction: null });
  // A division whose name the client has no text for.
  assert.equal(missionPage(input({ agent: AGENT }), context({ messageText: () => null })).agent?.division, null);
  // An agent with no corporation has no second card; one the client's agents service does not know has neither.
  const alone = missionPage(input({ agent: { ...AGENT, corporationID: null } }), context());
  assert.notEqual(alone.agent, null);
  assert.equal(alone.corporation, null);
  const unknown = missionPage(input({}), context());
  assert.equal(unknown.agent, null);
  assert.equal(unknown.corporation, null);
  // Without the client's words the level is not said.
  assert.equal(missionPage(input({ agent: AGENT }), context({ templates: {} })).agent?.level, null);
});

test("the corporation's card says the pilot's effective standing with the agent, once its standings and skills are both to hand", () => {
  const card = (overrides: Partial<MissionPageInput>, templates: Record<string, string> = TEMPLATES) => missionPage(input({ agent: AGENT, ...overrides }), context({ templates })).corporation;
  const none = () => 0;
  // The greatest of the three, to one decimal place, in the client's words.
  const standings = new Map([[500001, 1.5], [1000002, 3.04], [3008416, -1.0]]);
  assert.deepEqual(card({ standings, skillLevel: none }), { standing: "Stands at 3.0", standingLow: false, name: "corporation#1000002", faction: "faction#500001" });
  // Raised by the pilot's skill: Connections IV takes 3.04 to 4.1536.
  assert.equal(card({ standings, skillLevel: (typeID) => (typeID === 3359 ? 4 : 0) })?.standing, "Stands at 4.2");
  // A low one is the least of them, in the client's other words, and marked.
  const low = card({ standings: new Map([[500001, -3.5]]), skillLevel: none });
  assert.equal(low?.standing, "Stands at -3.5, too low");
  assert.equal(low?.standingLow, true);
  // Nothing listed is a standing of nought.
  assert.equal(card({ standings: new Map(), skillLevel: none })?.standing, "Stands at 0.0");
  // Until both are read nothing is said, and it is not called low.
  assert.deepEqual([card({ standings, skillLevel: null })?.standing, card({ standings: null, skillLevel: none })?.standing], [null, null]);
  assert.equal(card({ standings: new Map([[500001, -3.5]]), skillLevel: null })?.standingLow, false);
  // Without the client's words it is known and not said.
  const wordless = card({ standings: new Map([[500001, -3.5]]), skillLevel: none }, {});
  assert.equal(wordless?.standing, null);
  assert.equal(wordless?.standingLow, true);
});

test("the briefing: the offer's words only while it is an offer and the mission has them; tidied, and shown plain", () => {
  const both: ClientMission = { nameID: null, messages: { [PAGE_MESSAGES.briefing]: 7, [PAGE_MESSAGES.offered]: 8 } };
  const briefingOnly: ClientMission = { nameID: null, messages: { [PAGE_MESSAGES.briefing]: 7 } };
  const text = (overrides: Partial<MissionPageInput>, say: PageContext["sayOfMission"] = (id) => `M${id}`) => missionPage(input(overrides), context({ sayOfMission: say })).briefing?.text ?? null;
  assert.equal(text({ missionState: 1, record: both }), "M8");
  assert.equal(text({ missionState: 0, record: both }), "M8");
  assert.equal(text({ missionState: 2, record: both }), "M7");
  assert.equal(text({ missionState: 1, record: briefingOnly }), "M7");
  // The state read from the objectives is the one that counts.
  assert.equal(text({ missionState: 1, record: both, objectives: mission(ENCOUNTER_ACCEPTED_GATEWAY) }), "M7");
  // Line breaks of the text's own go, trailing breaks go, and the client's markup is drawn as plain text.
  assert.equal(text({ missionState: 2, record: both }, () => "  One\r\ntwo<br>three <b>four</b><br><br>\n"), "Onetwo\nthree four");
  // No record, no such message, or no text for it: no briefing at all.
  assert.equal(missionPage(input({}), context()).briefing, null);
  assert.equal(missionPage(input({ record: { nameID: 1, messages: {} } }), context()).briefing, null);
  assert.equal(missionPage(input({ record: both }), context({ sayOfMission: () => null })).briefing, null);
  assert.equal(missionPage(input({ record: both }), context({ sayOfMission: () => "<br>" })).briefing, null);
});

test("extra information is shown only with a body, under its own heading", () => {
  const extra = (messages: Record<string, number>) => missionPage(input({ record: { nameID: null, messages } }), context({ sayOfMission: (id) => `M${id}<br>` })).extra;
  assert.deepEqual(extra({ [PAGE_MESSAGES.extraHeader]: 5, [PAGE_MESSAGES.extraBody]: 6 }), { title: "M5", text: "M6" });
  assert.deepEqual(extra({ [PAGE_MESSAGES.extraBody]: 6 }), { title: "", text: "M6" });
  assert.equal(extra({ [PAGE_MESSAGES.extraHeader]: 5 }), null);
});

test("a courier's steps are marked by where the pilot is and what is aboard", () => {
  const steps = (hasCargo: boolean, locationID: number | null) => {
    const objectives = answer([["objectives", list(tuple("transport", tuple(1000002, place(60000004, 30002780), 1000002, place(60000019, 30002778), cargo(hasCargo))))]]);
    return missionPage(input({ objectives }), context({ locationID, stationID: locationID })).objectives?.general.steps.map((step) => `${step.kind} ${step.state}`);
  };
  assert.deepEqual(steps(false, null), ["cargo open", "pickup open", "dropoff open"]);
  assert.deepEqual(steps(false, 60000004), ["cargo open", "pickup done", "dropoff open"]);
  assert.deepEqual(steps(true, null), ["cargo done", "pickup done", "dropoff open"]);
  assert.deepEqual(steps(true, 60000019), ["cargo done", "pickup done", "dropoff done"]);
  // At the drop-off with nothing picked up, the drop-off is not done.
  assert.deepEqual(steps(false, 60000019), ["cargo open", "pickup open", "dropoff open"]);
});

test("a thing to bring: the cargo and where to bring it, done there only with the thing aboard", () => {
  const fetch = (hasCargo: boolean, locationID: number | null) => missionPage(
    input({ objectives: answer([["objectives", list(tuple("fetch", tuple(1000002, place(60000019, 30002778), cargo(hasCargo, 0))))]]) }),
    context({ locationID, stationID: locationID }),
  ).objectives?.general;
  assert.deepEqual(fetch(false, null), {
    briefing: "Bring these:",
    steps: [
      // Cargo of no size is the quantity and the item, and no more.
      { kind: "cargo", state: "open", title: "Load", where: null, text: "3 x type#2595" },
      { kind: "dropoff", state: "open", title: "To", where: null, text: "station#60000019" },
    ],
  });
  assert.deepEqual(fetch(true, 60000019)?.steps.map((step) => step.state), ["done", "done"]);
  assert.deepEqual(fetch(false, 60000019)?.steps.map((step) => step.state), ["open", "open"]);
  assert.deepEqual(fetch(true, null)?.steps.map((step) => step.state), ["done", "open"]);
  // "There" is where the session is: in space that is the solar system, and a station is not it.
  const inSpace = missionPage(
    input({ objectives: answer([["objectives", list(tuple("fetch", tuple(1000002, place(30002778, 30002778), cargo(true))))]]) }),
    context({ locationID: 30002778, stationID: null, solarSystemID: 30002778 }),
  ).objectives?.general.steps.map((step) => step.state);
  assert.deepEqual(inSpace, ["done", "done"]);
});

test("an agent to see: where it is, and above it whom to report to", () => {
  const page = missionPage(input({ objectives: answer([["objectives", list(tuple("agent", tuple(3009999, place(60000019, 30002778))))]]) }), context({ solarSystemID: 30002778 }));
  assert.deepEqual(page.objectives?.general, {
    briefing: "See: owner#3009999",
    // A station that is not the pilot's stands for its system.
    steps: [{ kind: "agent", state: "open", title: "Agent is at", where: "In this system", text: "station#60000019" }],
  });
});

test("the line above the first group is its last step's: a drop-off's by the kind of the mission's last objective", () => {
  const transport = tuple("transport", tuple(1, place(60000004, 30002780), 1, place(60000019, 30002778), cargo(false)));
  const agent = tuple("agent", tuple(3009999, place(60000019, 30002778)));
  const general = (...objectives: unknown[]) => missionPage(input({ objectives: answer([["objectives", list(...objectives)]]) }), context()).objectives?.general;
  assert.equal(general(agent, transport)?.briefing, "Carry these:");
  assert.equal(general(transport, agent)?.briefing, "See: owner#3009999");
  assert.deepEqual(general(agent, transport)?.steps.map((step) => step.kind), ["agent", "cargo", "pickup", "dropoff"]);
  // An objective the client cannot read whole gives no steps, and the line stays the last step's.
  const noCargo = tuple("transport", tuple(1, place(60000004, 30002780), 1, place(60000019, 30002778), null));
  assert.deepEqual(general(agent, noCargo), { briefing: "See: owner#3009999", steps: [{ kind: "agent", state: "open", title: "Agent is at", where: null, text: "station#60000019" }] });
  // A drop-off left as the last step by an objective that gave none is worded by that objective's kind all the same.
  const bring = tuple("fetch", tuple(1, place(60000019, 30002778), cargo(false)));
  assert.equal(general(bring, noCargo)?.briefing, "Carry these:");
  assert.equal(general(bring)?.briefing, "Bring these:");
  // Nowhere to bring it, or nowhere to fetch it from, is no objective either.
  assert.equal(general(tuple("fetch", tuple(1, null, cargo(false)))), undefined);
  assert.equal(general(tuple("transport", tuple(1, null, 1, place(60000019, 30002778), cargo(false)))), undefined);
  assert.equal(general(tuple("transport", tuple(1, place(60000004, 30002780), 1, null, cargo(false)))), undefined);
});

test("how far a place is: this station, this solar system, or not said", () => {
  const objectives = answer([["objectives", list(tuple("transport", tuple(1, place(60000004, 30002780), 1, place(1030000000001, 30002778), cargo(false))))]]);
  const where = (stationID: number | null, solarSystemID: number | null) => missionPage(input({ objectives }), context({ stationID, solarSystemID })).objectives?.general.steps.map((step) => step.where);
  assert.deepEqual(where(60000004, 30002780), [null, "Right here", null]);
  assert.deepEqual(where(null, 30002780), [null, "In this system", null]);
  assert.deepEqual(where(60000019, 30002780), [null, "In this system", null]);
  // A structure is neither a station nor a system: nothing is said of it, wherever the pilot is.
  assert.deepEqual(where(null, 30002778), [null, null, null]);
  assert.deepEqual(where(null, null), [null, null, null]);
});

test("a place on the page has its system's security rating before it, and a warning where that is low", () => {
  const WRAPPED = { ...TEMPLATES, "UI/Agents/LocationWrapper": "{startFontTag}{[numeric]securityRating, decimalPlaces=1}{endFontTag}{image}&nbsp;{locationName, linkinfo=linkdata} {securityWarning}", "UI/Agents/LowSecWarning": "(low!)" };
  const texts = (security: Record<number, number>, objectives = mission(COURIER_OFFERED_GATEWAY)) =>
    [...(missionPage(input({ objectives }), context({ templates: WRAPPED, securityOf: (id) => security[id] ?? null })).objectives?.general.steps ?? []),
      ...(missionPage(input({ objectives }), context({ templates: WRAPPED, securityOf: (id) => security[id] ?? null })).objectives?.extra.steps ?? [])].map((step) => step.text);
  // The cargo is not a place; the two stations are.
  assert.deepEqual(texts({ 30002780: 0.708087, 30002778: 0.3 }), ["1 x type#2595 (0.1 m3)", "0.7 station#60000004", "0.3 station#60000019 (low!)"]);
  assert.deepEqual(texts({}), ["1 x type#2595 (0.1 m3)", "station#60000004", "station#60000019"]);
  // A dungeon's place, and a ship in space to go to, are wrapped the same.
  assert.deepEqual(texts({ 30002779: -0.2 }, mission(ENCOUNTER_OFFERED_GATEWAY)), ["-0.2 system#30002779 (low!)"]);
  const ship = dict([["locationID", 30002778], ["solarsystemID", 30002778], ["typeID", 5], ["shipTypeID", 606]]);
  assert.deepEqual(texts({ 30002778: 0.830855 }, answer([["objectives", list(tuple("agent", tuple(3009999, ship)))]])), ["0.8 type#606 in system#30002778"]);
});

test("a ship in space to go to is worded by its type", () => {
  const ship = dict([["locationID", 30002778], ["solarsystemID", 30002778], ["typeID", 5], ["shipTypeID", 606]]);
  const page = missionPage(input({ objectives: answer([["objectives", list(tuple("agent", tuple(3009999, ship)))]]) }), context());
  assert.equal(page.objectives?.general.steps[0]?.text, "type#606 in system#30002778");
});

test("dungeons: failed with the mission, optional ones worded so, and the stock words where the agent has none", () => {
  const dungeon = (parts: Array<[string, unknown]>) => dict([["dungeonID", 3030], ["location", place(30002779, 30002779)], ...parts]);
  const extra = (state: number, ...dungeons: unknown[]) => missionPage(input({ objectives: answer([["missionState", state], ["dungeons", list(...dungeons)]]) }), context()).objectives?.extra;
  assert.deepEqual(extra(2, dungeon([["objectiveCompleted", 1]]), dungeon([["objectiveCompleted", 0]]), dungeon([]))?.steps.map((step) => step.state), ["done", "failed", "open"]);
  assert.deepEqual(extra(3, dungeon([["objectiveCompleted", 1]]), dungeon([]))?.steps.map((step) => step.state), ["failed", "failed"]);
  assert.equal(extra(2, dungeon([]))?.briefing, "Destroy them");
  assert.equal(extra(2, dungeon([["optional", 1]]))?.briefing, "Destroy them, if you like");
  // The agent's own words, tidied and shown plain; and the last dungeon's are the ones above the group.
  const said = extra(2, dungeon([["briefingMessage", tuple(115502, 13735)]]), dungeon([["optional", 1]]));
  assert.equal(said?.briefing, "Destroy them, if you like");
  assert.equal(extra(2, dungeon([]), dungeon([["briefingMessage", tuple(115502, 13735)]]))?.briefing, "Agent's 115502 of 13735");
  // A dungeon the server gives no number for is not one.
  assert.equal(missionPage(input({ objectives: answer([["dungeons", list(dict([["location", place(30002779, 30002779)]]))]]) }), context()).objectives, null);
});

test("what is paid: points by their own labels, a referral by the agent's name, and no bonus without pay", () => {
  const paid = (parts: Array<[string, unknown]>) => {
    const page = missionPage(input({ objectives: answer(parts) }), context());
    return [page.rewards?.rewards ?? null, page.bonusRewards?.rewards ?? null];
  };
  const bonus = list(tuple(HOUR.toString(), 29, 500, null, 60));
  assert.deepEqual(paid([["normalRewards", list(tuple(29, 1000, null), tuple(34, 20, null), tuple(3009999, 1, null), tuple(35, 0, null))], ["loyaltyPoints", 12], ["researchPoints", 2.6], ["bonusRewards", bonus]]),
    [["1,000.00 ISK", "20 x type#34", "owner#3009999", "12 pts", "3 research"], ["500.00 ISK"]]);
  // Points alone are pay.
  assert.deepEqual(paid([["loyaltyPoints", 12], ["bonusRewards", bonus]]), [["12 pts"], ["500.00 ISK"]]);
  assert.deepEqual(paid([["researchPoints", 0.5], ["bonusRewards", bonus]]), [["1 research"], ["500.00 ISK"]]);
  // Research that rounds to nothing is not pay, and with no pay there is no bonus either.
  assert.deepEqual(paid([["researchPoints", 0.4], ["bonusRewards", bonus]]), [null, null]);
  assert.deepEqual(paid([["bonusRewards", bonus]]), [null, null]);
  // Research that rounds to nothing is not listed beside pay that is.
  assert.deepEqual(paid([["normalRewards", list(tuple(29, 5, null))], ["researchPoints", 0.4]]), [["5.00 ISK"], null]);
  // Pay with no bonus has none drawn.
  assert.deepEqual(paid([["normalRewards", list(tuple(29, 5, null))], ["bonusRewards", list(tuple(HOUR.toString(), 29, 0, null, 60))]]), [["5.00 ISK"], null]);
  assert.deepEqual(paid([["normalRewards", list(tuple(29, 5, null))]]), [["5.00 ISK"], null]);
});

test("the banner about reduced rewards: an agent that is no career agent, in a system of the safest class, paying ISK", () => {
  const SAFEST = 30000142;
  const NEARLY = 30000144;
  const security: Record<number, number> = { [SAFEST]: 0.95, [NEARLY]: 0.9499 };
  const asked: number[] = [];
  const securityOf = (id: number): number | null => { asked.push(id); return security[id] ?? null; };
  const isk: Array<[string, unknown]> = [["normalRewards", list(tuple(29, 1000, null))]];
  const banner = (parts: Array<[string, unknown]>, overrides: Partial<MissionPageInput> = {}, templates = TEMPLATES) =>
    missionPage(input({ objectives: answer(parts), agent: AGENT, agentSolarSystemID: SAFEST, ...overrides }), context({ templates, securityOf })).reducedRewards;
  // In the client's words, shown plain.
  assert.equal(banner(isk), "Less is paid hereabouts");
  // A bonus in ISK will do alone, though no bonus is drawn where nothing else is paid.
  const bonusAlone = missionPage(input({ objectives: answer([["bonusRewards", list(tuple(HOUR.toString(), 29, 500, null, 60))]]), agent: AGENT, agentSolarSystemID: SAFEST }), context({ securityOf }));
  assert.equal(bonusAlone.reducedRewards, "Less is paid hereabouts");
  assert.equal(bonusAlone.bonusRewards, null);
  // Nothing in ISK: points and things are not ISK, and ISK of nought is none.
  assert.equal(banner([["normalRewards", list(tuple(34, 20, null))], ["loyaltyPoints", 12], ["researchPoints", 3], ["bonusRewards", list(tuple(HOUR.toString(), 34, 5, null, 60))]]), null);
  assert.equal(banner([["normalRewards", list(tuple(29, 0, null))], ["bonusRewards", list(tuple(HOUR.toString(), 29, 0, null, 60))]]), null);
  assert.equal(banner([]), null);
  // A system just short of the safest class.
  assert.equal(banner(isk, { agentSolarSystemID: NEARLY }), null);
  // What is not known yet: the agent, where it is, how safe that is, and what the mission pays.
  assert.equal(banner(isk, { agent: null }), null);
  assert.equal(banner(isk, { agentSolarSystemID: null }), null);
  assert.equal(banner(isk, { agentSolarSystemID: 30009999 }), null);
  assert.equal(missionPage(input({ agent: AGENT, agentSolarSystemID: SAFEST }), context({ securityOf })).reducedRewards, null);
  // A career agent has none, and its system's security is not looked at.
  asked.length = 0;
  assert.equal(banner(isk, { agent: { ...AGENT, agentTypeID: 12 } }), null);
  assert.deepEqual(asked.filter((id) => id === SAFEST), []);
  // An agent whose type the server did not say is not a career agent.
  assert.equal(banner(isk, { agent: { ...AGENT, agentTypeID: null } }), "Less is paid hereabouts");
  // Without the client's words for it, nothing is put in their place.
  const { [L.securityTax]: _none, ...wordless } = TEMPLATES;
  assert.equal(banner(isk, {}, wordless), null);
});

test("the agent the page asks the server to place, and the systems the page is drawn with", () => {
  assert.equal(pageAgentToLocate(input({ agent: AGENT })), 3008416);
  assert.equal(pageAgentToLocate(input({ agent: { ...AGENT, agentTypeID: null } })), 3008416);
  assert.equal(pageAgentToLocate(input({ agent: { ...AGENT, agentTypeID: 12 } })), null);
  assert.equal(pageAgentToLocate(input()), null);
  const courier = mission(COURIER_OFFERED_GATEWAY);
  // The places' systems first, then the agent's; each once.
  assert.deepEqual(pageSystemIDs(input({ objectives: courier, agent: AGENT, agentSolarSystemID: 30000142 })), [30002780, 30002778, 30000142]);
  assert.deepEqual(pageSystemIDs(input({ objectives: courier, agent: AGENT, agentSolarSystemID: 30002778 })), [30002780, 30002778]);
  assert.deepEqual(pageSystemIDs(input({ objectives: courier, agent: AGENT })), [30002780, 30002778]);
  assert.deepEqual(pageSystemIDs(input({ agent: AGENT, agentSolarSystemID: 30000142 })), [30000142]);
  // A career agent's system is not wanted, nor one held for an agent the client does not know.
  assert.deepEqual(pageSystemIDs(input({ agent: { ...AGENT, agentTypeID: 12 }, agentSolarSystemID: 30000142 })), []);
  assert.deepEqual(pageSystemIDs(input({ agentSolarSystemID: 30000142 })), []);
});

test("what is handed over and what is held: one line of all that is given; the collateral for an offer only, and its first amount", () => {
  const gift = ["agentGift", list(tuple(34, 20, null), tuple(29, 1000, null), tuple(3009999, 1, null))] as [string, unknown];
  const held = ["collateral", list(tuple(29, 250000, null), tuple(29, 9, null))] as [string, unknown];
  const page = (state: number) => missionPage(input({ objectives: answer([["missionState", state], gift, held]) }), context());
  assert.deepEqual(page(1).granted, { title: "Given", text: "Yours on accepting:", items: "20 x type#34, 1,000.00 ISK, A word to owner#3009999" });
  assert.deepEqual(page(1).collateral, { title: "Held", text: "You put this up:", items: "250,000.00 ISK" });
  assert.deepEqual(page(0).collateral?.items, "250,000.00 ISK");
  assert.equal(page(2).collateral, null);
  assert.notEqual(page(2).granted, null);
  assert.equal(missionPage(input({ objectives: mission(COURIER_OFFERED_GATEWAY) }), context()).granted, null);
});

test("without the client's words the page keeps its shape and says only what needs none", () => {
  const page = missionPage(input({ objectives: mission(COURIER_OFFERED_GATEWAY), record: RECORD }), context({ templates: {} }));
  assert.equal(page.talk, null);
  assert.deepEqual(page.objectives?.general.steps.map((step) => [step.title, step.text]), [[null, ""], [null, "station#60000004"], [null, "station#60000019"]]);
  assert.equal(page.objectives?.title, null);
  assert.equal(page.rewards, null);
});

test("the names the page needs are those of its places, its cargo, its agents and what it pays in", () => {
  const objectives = answer([
    ["objectives", list(tuple("agent", tuple(3009999, place(60000019, 30002778))), tuple("transport", tuple(1, place(60000004, 30002780), 1, place(1030000000001, 30002778), cargo(false))), tuple("fetch", tuple(1, place(30002779, 30002779), cargo(false))))],
    ["dungeons", list(dict([["dungeonID", 1], ["location", dict([["locationID", 30002779], ["solarsystemID", 30002779], ["shipTypeID", 606]])]]))],
    ["agentGift", list(tuple(34, 1, null))], ["normalRewards", list(tuple(29, 1, null), tuple(3008416, 1, null))], ["bonusRewards", list(tuple("1", 35, 1, null, 1))], ["collateral", list(tuple(29, 1, null))],
  ]);
  assert.deepEqual(pageNameRefs(input({ objectives })).map((ref) => `${ref.kind}:${ref.id}`), [
    "owner:3009999", "station:60000019", "station:60000004", "structure:1030000000001", "type:2595", "system:30002779", "type:2595", "system:30002779", "type:606", "type:34", "owner:3008416", "type:35",
  ]);
  assert.deepEqual(pageNameRefs(input({})), []);
  // The agent's cards need its own name, its corporation's and its faction's, whether or not anything is read of the mission.
  assert.deepEqual(pageNameRefs(input({ agent: AGENT })).map((ref) => `${ref.kind}:${ref.id}`), ["owner:3008416", "corporation:1000002", "faction:500001"]);
  assert.deepEqual(pageNameRefs(input({ agent: { ...AGENT, corporationID: null, factionID: null } })).map((ref) => `${ref.kind}:${ref.id}`), ["owner:3008416"]);
  assert.deepEqual(pageNameRefs(input({ agent: AGENT, objectives })).length, 15);
});
