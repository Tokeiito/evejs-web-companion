// The server's questions as the browser reads them. The event below is the one
// src/gamePort/pilots.js publishes for the server's own decline question
// (test/gamePortPilots.test.js builds the same one from the server's call).

import test from "node:test";
import assert from "node:assert/strict";

import {
  answerFits,
  argumentsOf,
  createBotPresses,
  decodeQuestion,
  dialogOfKey,
  questionNameRefs,
  questionText,
  wordsKey,
  wordsLabels,
  wordsNameRefs,
} from "./questions.ts";
import type { JsonValue } from "./wire.ts";

const DECLINE: JsonValue = {
  id: "q-0123456789",
  service: "agents",
  method: "YesNo",
  kind: "yesNo",
  title: { label: "UI/Agents/StandardMission/DeclineMissionTitle", parameters: { type: "dict", entries: [] }, text: null },
  body: {
    label: "UI/Agents/StandardMission/DeclineMessage",
    parameters: { type: "dict", entries: [["when", { type: "long", value: "134359400000000000" }]] },
    text: null,
  },
  agentID: 3008416,
  contentID: 4802,
  suppressID: "AgtDeclineMission",
  askedAtMs: 1_000_000,
  expiresAtMs: 1_110_000,
};

test("the server's decline question decodes whole", () => {
  const question = decodeQuestion(DECLINE);
  assert.deepEqual(question, {
    id: "q-0123456789",
    service: "agents",
    method: "YesNo",
    kind: "yesNo",
    title: { label: "UI/Agents/StandardMission/DeclineMissionTitle", parameters: { type: "dict", entries: [] }, text: null },
    body: {
      label: "UI/Agents/StandardMission/DeclineMessage",
      parameters: { type: "dict", entries: [["when", { type: "long", value: "134359400000000000" }]] },
      text: null,
    },
    agentID: 3008416,
    contentID: 4802,
    suppressID: "AgtDeclineMission",
    askedAtMs: 1_000_000,
    expiresAtMs: 1_110_000,
    choices: [],
    quantity: null,
  });
});

test("what is not a question this client can show is not shown", () => {
  for (const wrong of [
    null, undefined, "q", [], {}, { ...DECLINE, id: "" }, { ...DECLINE, id: 7 }, { ...DECLINE, kind: "essay" },
    // Radio buttons with no buttons, and a number box with no limits.
    { ...DECLINE, kind: "choice" }, { ...DECLINE, kind: "choice", choices: [] }, { ...DECLINE, kind: "quantity" },
  ]) {
    assert.equal(decodeQuestion(wrong as JsonValue), null);
  }
});

test("a question with parts missing still decodes, with nothing made up", () => {
  const question = decodeQuestion({ id: "q1", kind: "yesNo", title: "not words", agentID: "3008416" });
  assert.deepEqual(question, {
    id: "q1",
    service: "",
    method: "",
    kind: "yesNo",
    title: { label: null, parameters: null, text: null },
    body: { label: null, parameters: null, text: null },
    agentID: null,
    contentID: null,
    suppressID: null,
    askedAtMs: 0,
    expiresAtMs: 0,
    choices: [],
    quantity: null,
  });
});

test("a question is worded by its text, then by this client's words for its label, then by the label", () => {
  const words = (label: string | null, text: string | null = null) => ({ label, parameters: null, text });
  assert.equal(questionText(words(null, "Cancel research?")), "Cancel research?");
  // Text wins over a label, should a question ever carry both.
  assert.equal(questionText(words("UI/Agents/StandardMission/QuitMissionTitle", "As written")), "As written");
  assert.equal(questionText(words("UI/Agents/StandardMission/QuitMissionTitle")), "Quit mission");
  assert.match(questionText(words("UI/Agents/StandardMission/QuitMissionMessage")), /^Quit this mission\?.*standing/);
  assert.equal(questionText(words("UI/Agents/StandardMission/DeclineMissionTitle")), "Decline mission");
  assert.match(questionText(words("UI/Agents/StandardMission/DeclineMessage")), /^Decline this mission\?.*four hours.*standing/);
  // A label nobody has worded is shown as it is, not hidden and not guessed at.
  assert.equal(questionText(words("UI/Agents/Research/CancelResearchBody")), "UI/Agents/Research/CancelResearchBody");
  assert.equal(questionText(words(null)), "");
});

// ── a bot's own presses ──────────────────────────────────────────────────────

test("the server's question about a button a bot is pressing is the bot's to answer, only while the press is in flight", async () => {
  const presses = createBotPresses();
  const question = decodeQuestion(DECLINE)!;
  assert.equal(presses.answers(question), false, "nobody is pressing anything");

  let release: (value: string) => void = () => {};
  const pressed = presses.during(3008416, () => new Promise<string>((resolve) => { release = resolve; }));
  assert.equal(presses.answers(question), true);
  // Another agent's question, or one about no agent at all, is not this press's.
  assert.equal(presses.answers({ ...question, agentID: 3008417 }), false);
  assert.equal(presses.answers({ ...question, agentID: null }), false);
  release("the conversation");
  assert.equal(await pressed, "the conversation");
  assert.equal(presses.answers(question), false, "the press is over");
});

test("a press that fails is over all the same, and two presses on one agent are over when both are", async () => {
  const presses = createBotPresses();
  const question = decodeQuestion(DECLINE)!;
  await assert.rejects(presses.during(3008416, async () => { throw new Error("refused"); }), /refused/);
  assert.equal(presses.answers(question), false);

  const releases: Array<() => void> = [];
  const first = presses.during(3008416, () => new Promise<void>((resolve) => { releases.push(resolve); }));
  const second = presses.during(3008416, () => new Promise<void>((resolve) => { releases.push(resolve); }));
  releases[0]!();
  await first;
  assert.equal(presses.answers(question), true, "one press is still in flight");
  releases[1]!();
  await second;
  assert.equal(presses.answers(question), false);
});

// ── a research agent's boxes, and the customs question ───────────────────────
//
// The events are the ones src/gamePort/pilots.js publishes for the calls eve.js makes
// (test/gamePortPilots.test.js builds the same ones from the server's arguments).

const label = (path: string, entries: JsonValue[] = []): JsonValue => ({ label: path, parameters: { type: "dict", entries }, text: null });
const CHOICE: JsonValue = {
  id: "q-choice",
  service: "agents",
  method: "SingleChoiceBox",
  kind: "choice",
  title: label("UI/Agents/Research/SelectResearchTypeTitle"),
  body: label("UI/Agents/Research/SelectResearchTypeMessage"),
  choices: [11433, 11442].map((skillID) => label("UI/Agents/Research/SkillListing", [["skillID", skillID], ["skillLevel", 2]])),
  agentID: 3009373,
  contentID: null,
  suppressID: null,
  askedAtMs: 1,
  expiresAtMs: 2,
};
const QUANTITY: JsonValue = {
  id: "q-quantity",
  service: "agents",
  method: "GetQuantity",
  kind: "quantity",
  title: label("UI/Agents/Research/Datacores"),
  body: label("UI/Agents/Research/DatacorePrice", [["datacoreTypeID", 20424], ["rpAmount", 100], ["iskAmount", 10000]]),
  agentID: null,
  contentID: null,
  suppressID: null,
  quantity: { min: 1, max: 12, initial: 12, digits: 0 },
  askedAtMs: 1,
  expiresAtMs: 2,
};
const CUSTOMS: JsonValue = {
  id: "q-customs",
  service: "XmppChat",
  method: "AskYesNoQuestion",
  kind: "yesNo",
  title: { label: null, parameters: null, text: null },
  body: label("ChtCustomsConfiscationConfirmation2", [["contraband", [103, [[24, 3721, 10], [24, 3713, 1500]], "<br>"]], ["empire", [2, 500001]]]),
  agentID: null,
  contentID: null,
  suppressID: null,
  askedAtMs: 1,
  expiresAtMs: 2,
};
const names = (kind: string, id: number): string => ({ "type:11433": "Hydromagnetic Physics", "type:11442": "Nanite Engineering", "type:20424": "Datacore - Electronic Engineering", "type:3721": "Slaves", "type:3713": "Soma", "faction:500001": "Caldari State" } as Record<string, string>)[`${kind}:${id}`] ?? `${kind} ${id}`;

test("a choice decodes with what there is to choose from, in the server's order", () => {
  const question = decodeQuestion(CHOICE)!;
  assert.equal(question.kind, "choice");
  assert.equal(question.quantity, null);
  assert.deepEqual(question.choices.map((choice) => [choice.label, choice.parameters]), [
    ["UI/Agents/Research/SkillListing", { type: "dict", entries: [["skillID", 11433], ["skillLevel", 2]] }],
    ["UI/Agents/Research/SkillListing", { type: "dict", entries: [["skillID", 11442], ["skillLevel", 2]] }],
  ]);
  // A Yes/No carries no choices even if something put some on it.
  assert.deepEqual(decodeQuestion({ ...(DECLINE as object), choices: [label("x")] } as JsonValue)!.choices, []);
});

test("a number box decodes with the server's limits, and nothing made up where it gave none", () => {
  const question = decodeQuestion(QUANTITY)!;
  assert.equal(question.kind, "quantity");
  assert.deepEqual(question.quantity, { min: 1, max: 12, initial: 12, digits: 0 });
  assert.deepEqual(question.choices, []);
  const loose = decodeQuestion({ ...(QUANTITY as object), quantity: { min: "1", digits: 2 } } as JsonValue)!;
  assert.deepEqual(loose.quantity, { min: 0, max: null, initial: null, digits: 2 });
  assert.equal(decodeQuestion(DECLINE)!.quantity, null);
});

test("a research agent's words carry the names of what they are about", () => {
  const choice = decodeQuestion(CHOICE)!;
  assert.equal(questionText(choice.title, names), "Choose a field of research");
  assert.equal(questionText(choice.body, names), "Which field should this agent research for you?");
  assert.deepEqual(choice.choices.map((each) => questionText(each, names)), ["Hydromagnetic Physics (level 2)", "Nanite Engineering (level 2)"]);
  // Without a name cache the ID is shown, said plainly.
  assert.equal(questionText(choice.choices[0]!), "type 11433 (level 2)");

  const quantity = decodeQuestion(QUANTITY)!;
  assert.equal(questionText(quantity.title, names), "Buy datacores");
  assert.equal(questionText(quantity.body, names), "Datacore - Electronic Engineering: each costs 100 research points and 10,000 ISK. How many?");
  assert.equal(questionText({ label: "UI/Agents/Research/CancelResearchQuestion", parameters: null, text: null }), "Cancel research");
  assert.match(questionText({ label: "UI/Agents/Research/SureToCancelResearch", parameters: null, text: null }), /^Cancel your research.*points.*lost\.$/);
  assert.match(questionText({ label: "UI/Agents/Research/SureToCancelResearchAndMission", parameters: null, text: null }), /mission.*failed/);
});

test("the customs question names the faction and lists the contraband", () => {
  const question = decodeQuestion(CUSTOMS)!;
  assert.equal(question.kind, "yesNo");
  assert.equal(questionText(question.title, names), "");
  assert.equal(questionText(question.body, names), "Caldari State customs has found contraband in your cargo: 10 × Slaves, 1,500 × Soma. Hand it over?");
  // With its parameters missing or not as customs sends them, it still asks, and invents nothing.
  assert.equal(questionText({ label: "ChtCustomsConfiscationConfirmation2", parameters: null, text: null }, names), "Customs has found contraband in your cargo. Hand it over?");
  assert.equal(
    questionText(label("ChtCustomsConfiscationConfirmation2", [["contraband", [7, [[24, 3721, 10]]]], ["empire", [3, 500001]]]) as never, names),
    "Customs has found contraband in your cargo. Hand it over?",
  );
});

test("the names a question's words need are asked for, and no others", () => {
  const key = (question: JsonValue) => questionNameRefs(decodeQuestion(question)!).map((ref) => `${ref.kind}:${ref.id}`);
  assert.deepEqual(key(CHOICE), ["type:11433", "type:11442"]);
  assert.deepEqual(key(QUANTITY), ["type:20424"]);
  assert.deepEqual(key(CUSTOMS), ["type:3721", "type:3713", "faction:500001"]);
  assert.deepEqual(key(DECLINE), []);
});

test("an answer fits a question when the question's own window could have given it", () => {
  const yesNo = decodeQuestion(DECLINE)!;
  const choice = decodeQuestion(CHOICE)!;
  const quantity = decodeQuestion(QUANTITY)!;
  const fits = (question: typeof yesNo, answers: unknown[]) => answers.map((answer) => answerFits(question, answer as never));

  assert.deepEqual(fits(yesNo, [true, false, null, 1, { confirmed: true, index: 0 }]), [true, true, false, false, false]);
  assert.deepEqual(
    fits(choice, [{ confirmed: true, index: 0 }, { confirmed: false, index: 1 }, { confirmed: true, index: 2 }, { confirmed: true, index: -1 }, { confirmed: true, index: 0.5 }, true, null, 1]),
    [true, true, false, false, false, false, false, false],
  );
  // Cancel is null. A number has to be whole here, and from 1 to 12.
  assert.deepEqual(fits(quantity, [null, 1, 12, 5, 0, 13, 2.5, Number.NaN, true, { confirmed: true, index: 0 }]), [true, true, true, true, false, false, false, false, false, false]);
  const loose = decodeQuestion({ ...(QUANTITY as object), quantity: { digits: 2 } } as JsonValue)!;
  assert.deepEqual(fits(loose, [2.5, 0, 1e12, -0.01]), [true, true, true, false]);
});

test("a bot's press answers a Yes/No about its agent, and never a choice or a number", async () => {
  const presses = createBotPresses();
  const choice = decodeQuestion({ ...(CHOICE as object), agentID: 3008416 } as JsonValue)!;
  const quantity = decodeQuestion({ ...(QUANTITY as object), agentID: 3008416 } as JsonValue)!;
  let release: () => void = () => {};
  const pressed = presses.during(3008416, () => new Promise<void>((resolve) => { release = resolve; }));
  assert.equal(presses.answers(decodeQuestion(DECLINE)!), true);
  assert.equal(presses.answers(choice), false);
  assert.equal(presses.answers(quantity), false);
  release();
  await pressed;
});

// ── the retail client's own words ────────────────────────────────────────────
//
// The templates are made up, with the tags the client's real texts carry for
// these labels (scripts/client-words.js shows them).

const TEMPLATES: Record<string, string | null> = {
  "UI/Agents/StandardMission/DeclineMissionTitle": "A made-up title?",
  "UI/Agents/StandardMission/DeclineMessage": "Decline before {[datetime]when} and it costs you.",
  "UI/Agents/Research/SkillListing": "{[item]skillID.name} level {[numeric]skillLevel}",
  "UI/Agents/Research/DatacorePrice": "{[item]datacoreTypeID.name}: {[numeric]rpAmount} RP + {[numeric]iskAmount} ISK",
  "UI/Agents/DefaultMessages/RootAgentSays/GenericGreetings": "Greetings, {[character]player.name}, from {[location]agentStationID.name}.",
  // The client has no text for this one.
  "UI/Agents/Research/SelectResearchTypeTitle": null,
};
const withClient = { templates: TEMPLATES, playerID: 140000002 };
const moreNames = (kind: string, id: number): string => ({ "owner:140000002": "Test Two", "station:60010387": "Iyen-Oursta III" } as Record<string, string>)[`${kind}:${id}`] ?? names(kind, id);

test("a label is worded by the client's own text when the page has it, with the server's values filled in", () => {
  const decline = decodeQuestion({
    ...(DECLINE as object),
    body: label("UI/Agents/StandardMission/DeclineMessage", [["when", { type: "long", value: String((BigInt(Date.UTC(2026, 9, 8, 15, 30)) + 11644473600000n) * 10000n) }]]),
  } as JsonValue)!;
  assert.equal(questionText(decline.title, names, withClient), "A made-up title?");
  assert.equal(questionText(decline.body, names, withClient), "Decline before 2026.10.08 15:30 and it costs you.");

  const choice = decodeQuestion(CHOICE)!;
  assert.deepEqual(choice.choices.map((each) => questionText(each, names, withClient)), ["Hydromagnetic Physics level 2", "Nanite Engineering level 2"]);
  assert.equal(questionText(decodeQuestion(QUANTITY)!.body, names, withClient), "Datacore - Electronic Engineering: 100 RP + 10000 ISK");
});

test("where the client has no text, or the page has not got it yet, this client's own words stand", () => {
  const choice = decodeQuestion(CHOICE)!;
  // The client has none for this label.
  assert.equal(questionText(choice.title, names, withClient), "Choose a field of research");
  // Not asked for yet: the label is absent from what the page holds.
  assert.equal(questionText(choice.body, names, withClient), "Which field should this agent research for you?");
  // No client at all.
  assert.equal(questionText(choice.choices[0]!, names, { templates: {} }), "Hydromagnetic Physics (level 2)");
  assert.equal(questionText(choice.choices[0]!, names, null), "Hydromagnetic Physics (level 2)");
  // A dialog's message ID is not a label: the BFF answers null for it, and this client's words are used.
  assert.match(questionText(decodeQuestion(CUSTOMS)!.body, names, { templates: { ChtCustomsConfiscationConfirmation2: null } }), /^Caldari State customs has found contraband/);
  // Plain text is shown as it is, whatever the client has.
  assert.equal(questionText({ label: "UI/Agents/StandardMission/DeclineMissionTitle", parameters: null, text: "As written" }, names, withClient), "As written");
  // A label nobody has words for is shown as the label.
  assert.equal(questionText({ label: "UI/Nobody/Knows", parameters: null, text: null }, names, withClient), "UI/Nobody/Knows");
});

test("what the client adds to a message is used, and what the server sent wins over it", () => {
  const greeting = { label: "UI/Agents/DefaultMessages/RootAgentSays/GenericGreetings", parameters: { type: "dict", entries: [] }, text: null };
  const client = { ...withClient, extra: { agentID: 3009373, agentStationID: 60010387 } };
  assert.equal(questionText(greeting, moreNames, client), "Greetings, Test Two, from Iyen-Oursta III.");
  // The player is whoever the page is flying; with nobody, nothing is shown for it.
  assert.equal(questionText(greeting, moreNames, { ...client, playerID: null }), "Greetings, , from Iyen-Oursta III.");
  // The server's own value for a name the client also adds is the one used.
  const elsewhere = { ...greeting, parameters: { type: "dict", entries: [["agentStationID", 60000004]] } };
  assert.equal(questionText(elsewhere, (kind, id) => `${kind} ${id}`, client), "Greetings, owner 140000002, from station 60000004.");
});

test("the labels among some words are each asked for once, and text and nothing are not labels", () => {
  const choice = decodeQuestion(CHOICE)!;
  assert.deepEqual(wordsLabels([choice.title, choice.body, ...choice.choices, null, undefined, { label: null, parameters: null, text: "plain" }]), [
    "UI/Agents/Research/SelectResearchTypeTitle",
    "UI/Agents/Research/SelectResearchTypeMessage",
    "UI/Agents/Research/SkillListing",
  ]);
  assert.deepEqual(wordsLabels([]), []);
});

test("the names a wording needs follow the wording: the client's template when there is one, this client's when not", () => {
  const key = (refs: ReturnType<typeof wordsNameRefs>) => refs.map((ref) => `${ref.kind}:${ref.id}`);
  const greeting = { label: "UI/Agents/DefaultMessages/RootAgentSays/GenericGreetings", parameters: null, text: null };
  // By the client's template: the player and the agent's station, which this client's own wording knows nothing of.
  assert.deepEqual(key(wordsNameRefs([greeting], { ...withClient, extra: { agentStationID: 60010387 } })), ["owner:140000002", "station:60010387"]);
  assert.deepEqual(key(wordsNameRefs([greeting], null)), []);
  // A question's names are the same either way here, because both wordings name the same things.
  assert.deepEqual(key(questionNameRefs(decodeQuestion(CHOICE)!, withClient)), ["type:11433", "type:11442"]);
  assert.deepEqual(key(questionNameRefs(decodeQuestion(CHOICE)!)), ["type:11433", "type:11442"]);
  // The customs dialog is worded by this client, so its names are found this client's way.
  assert.deepEqual(key(questionNameRefs(decodeQuestion(CUSTOMS)!, withClient)), ["type:3721", "type:3713", "faction:500001"]);
  assert.deepEqual(key(wordsNameRefs([null, undefined], withClient)), []);
});

// ── a mission's own text ─────────────────────────────────────────────────────
//
// What an agent says when offering a mission is a message's number. The client
// fills that message with the mission's keywords, which it asks the agent for
// (agents.py ProcessMessage, PrimeMessageArguments). The keywords here are the
// ones eve.js answered for a courier offer; the text is made up, with the tag
// the client's real text for such an offer carries.

const OFFER = { label: null, parameters: null, text: null, messageID: 129932 };
const KEYWORDS = argumentsOf({ type: "dict", entries: [
  ["objectiveLocationID", 60000004], ["objectiveDestinationID", 60000019], ["objectiveQuantity", 1],
  ["objectiveDestinationSystemID", 30002778], ["objectiveTypeID", 2595], ["objectiveLocationSystemID", 30002780],
  ["rewardTypeID", 29], ["rewardQuantity", 13800],
] });
const offerNames = (kind: string, id: number): string => ({ "system:30002780": "Muvolailen", "system:30002778": "Hirtamon", "type:2595": "Reports" } as Record<string, string>)[`${kind}:${id}`] ?? `${kind} ${id}`;
const offerClient = {
  templates: { "#129932": "Take {[numeric]objectiveQuantity} {[item]objectiveTypeID.name} from {[location]objectiveLocationSystemID.name} to {[location]objectiveDestinationSystemID.name}." },
  playerID: 140000002,
  extra: { ...KEYWORDS, agentID: 3008416 },
};

test("words are kept under their label, or under # and their message's number", () => {
  assert.equal(wordsKey({ label: "UI/A/B", parameters: null, text: null }), "UI/A/B");
  assert.equal(wordsKey(OFFER), "#129932");
  // A label wins over a number, should something carry both.
  assert.equal(wordsKey({ ...OFFER, label: "UI/A/B" }), "UI/A/B");
  assert.equal(wordsKey({ label: null, parameters: null, text: "plain" }), null);
  assert.equal(wordsKey({ label: null, parameters: null, text: null, messageID: null }), null);
  assert.deepEqual(wordsLabels([OFFER, { label: "UI/A/B", parameters: null, text: null }, OFFER]), ["#129932", "UI/A/B"]);
});

test("a mission's keywords are read by name from what the agent answered", () => {
  assert.deepEqual(KEYWORDS, {
    objectiveLocationID: 60000004, objectiveDestinationID: 60000019, objectiveQuantity: 1, objectiveDestinationSystemID: 30002778,
    objectiveTypeID: 2595, objectiveLocationSystemID: 30002780, rewardTypeID: 29, rewardQuantity: 13800,
  });
  for (const nothing of [null, undefined, 7, "x", [], { type: "dict" }]) {
    assert.deepEqual(argumentsOf(nothing), {});
  }
});

test("a mission's text is the client's message for its number, filled with the mission's keywords", () => {
  assert.equal(questionText(OFFER, offerNames, offerClient), "Take 1 Reports from Muvolailen to Hirtamon.");
  // Without the keywords the places and things are not there to name.
  assert.equal(questionText(OFFER, offerNames, { ...offerClient, extra: {} }), "Take   from  to .");
});

test("a mission's text the page does not have is shown as its number, which is what the server sent", () => {
  assert.equal(questionText(OFFER, offerNames, { templates: {} }), "129932");
  assert.equal(questionText(OFFER, offerNames, { templates: { "#129932": null } }), "129932");
  assert.equal(questionText(OFFER, offerNames, null), "129932");
  assert.equal(questionText(OFFER), "129932");
});

test("the names a mission's text needs are the ones its keywords point at", () => {
  const key = (refs: ReturnType<typeof wordsNameRefs>) => refs.map((ref) => `${ref.kind}:${ref.id}`);
  assert.deepEqual(key(wordsNameRefs([OFFER], offerClient)), ["type:2595", "system:30002780", "system:30002778"]);
  // Before the text has arrived there is nothing to say which names it needs.
  assert.deepEqual(key(wordsNameRefs([OFFER], { templates: {}, extra: offerClient.extra })), []);
});

test("the client's own markup in a text is not shown: breaks are new lines, and tags leave their words", () => {
  const marked = { templates: { "#129932": "Take it to <b>{[location]objectiveDestinationSystemID.name}</b>.<br><br>Be quick." }, extra: KEYWORDS };
  assert.equal(questionText(OFFER, offerNames, marked), "Take it to Hirtamon.\n\nBe quick.");
  // Plain text the server sent itself is shown as it came.
  assert.equal(questionText({ label: null, parameters: null, text: "As <b>sent</b><br>by the server" }, offerNames, marked), "As <b>sent</b><br>by the server");
});

// ── a dialog by its name ─────────────────────────────────────────────────────
//
// The customs question as the BFF publishes it now (src/gamePort/pilots.js;
// test/gamePortPilots.test.js builds the same one from the server's call): the
// dialog's name on the title and on the body, and the contraband's entries in
// a list. CUSTOMS above is the same question from before the dialog's name was
// passed on, its entries in a tuple.

const CUSTOMS_PARAMETERS: JsonValue = {
  type: "dict",
  entries: [["contraband", [103, { type: "list", items: [[24, 3721, 10], [24, 3713, 1500]] }, "<br>"]], ["empire", [2, 500001]]],
};
const CUSTOMS_DIALOG: JsonValue = {
  ...(CUSTOMS as object),
  title: { label: null, dialog: "ChtCustomsConfiscationConfirmation2", part: "title", parameters: CUSTOMS_PARAMETERS, text: null },
  body: { label: "ChtCustomsConfiscationConfirmation2", dialog: "ChtCustomsConfiscationConfirmation2", part: "body", parameters: CUSTOMS_PARAMETERS, text: null },
};
// Made up, with the two parameters the client's own body for this dialog carries.
const DIALOG_TEMPLATES: Record<string, string | null> = {
  "dialog:ChtCustomsConfiscationConfirmation2/title": "A made-up customs title",
  "dialog:ChtCustomsConfiscationConfirmation2/body": "<b>{empire}</b> has found:<br>{contraband}<br><br>Hand it over?",
  "UI/Common/QuantityAndItem": "{[numeric]quantity, useGrouping} of {[item]item.name}",
};
const dialogNames = (kind: string, id: number): string => (kind === "owner" && id === 500001 ? "Caldari State" : names(kind, id));

test("a dialog's title and body decode with the dialog's name and which of the two they are", () => {
  const question = decodeQuestion(CUSTOMS_DIALOG)!;
  assert.deepEqual(question.title, { label: null, dialog: "ChtCustomsConfiscationConfirmation2", part: "title", parameters: CUSTOMS_PARAMETERS, text: null });
  assert.deepEqual(question.body, { label: "ChtCustomsConfiscationConfirmation2", dialog: "ChtCustomsConfiscationConfirmation2", part: "body", parameters: CUSTOMS_PARAMETERS, text: null });
  // Words with no dialog decode as they did, with nothing added.
  assert.deepEqual(Object.keys(decodeQuestion(DECLINE)!.title), ["label", "parameters", "text"]);
  // A name without a part, a part without a name, or either not as the BFF sends it, is no dialog.
  const odds: Array<Record<string, unknown>> = [{ dialog: "SomeDialog" }, { part: "body" }, { dialog: "SomeDialog", part: "footer" }, { dialog: "not a name", part: "body" }, { dialog: "", part: "body" }, { dialog: 7, part: "title" }, { dialog: "x".repeat(101), part: "title" }];
  for (const odd of odds) {
    const decoded: NonNullable<ReturnType<typeof decodeQuestion>> = decodeQuestion({ ...(CUSTOMS as object), body: { label: "L", parameters: null, text: null, ...odd } } as unknown as JsonValue)!;
    assert.deepEqual(decoded.body, { label: "L", parameters: null, text: null }, JSON.stringify(odd));
  }
});

test("a dialog's words are kept under the dialog's name and the part, before any label", () => {
  const question = decodeQuestion(CUSTOMS_DIALOG)!;
  assert.equal(wordsKey(question.title), "dialog:ChtCustomsConfiscationConfirmation2/title");
  assert.equal(wordsKey(question.body), "dialog:ChtCustomsConfiscationConfirmation2/body");
  assert.equal(wordsKey({ label: "UI/A/B", parameters: null, text: null, dialog: "D", part: "title" }), "dialog:D/title");
  // Half a dialog is not one: the label, or nothing.
  assert.equal(wordsKey({ label: "UI/A/B", parameters: null, text: null, dialog: "D" }), "UI/A/B");
  assert.equal(wordsKey({ label: null, parameters: null, text: null, dialog: null, part: "body" }), null);

  assert.deepEqual(dialogOfKey("dialog:ChtCustomsConfiscationConfirmation2/title"), { name: "ChtCustomsConfiscationConfirmation2", part: "title" });
  assert.deepEqual(dialogOfKey("dialog:D_1/body"), { name: "D_1", part: "body" });
  for (const other of ["UI/A/B", "#129932", "dialog:D", "dialog:D/footer", "dialog:/title", "dialog:not a name/title", "xdialog:D/title", "dialog:D/title/more", ""]) {
    assert.equal(dialogOfKey(other), null, other);
  }
});

test("the customs question is worded by the client's own dialog: the faction by name, each load on its own line", () => {
  const question = decodeQuestion(CUSTOMS_DIALOG)!;
  const client = { templates: DIALOG_TEMPLATES, playerID: 140000002 };
  assert.equal(questionText(question.title, dialogNames, client), "A made-up customs title");
  assert.equal(questionText(question.body, dialogNames, client), "Caldari State has found:\n10 of Slaves\n1,500 of Soma\n\nHand it over?");
  // Before the page has the client's quantity label, the loads are said this client's way.
  const { "UI/Common/QuantityAndItem": _left, ...without } = DIALOG_TEMPLATES;
  assert.equal(questionText(question.body, dialogNames, { templates: without }), "Caldari State has found:\n10 × Slaves\n1,500 × Soma\n\nHand it over?");
});

test("without the client's dialog, the customs question is in this client's words, and its title is nothing", () => {
  const question = decodeQuestion(CUSTOMS_DIALOG)!;
  const OWN = "Caldari State customs has found contraband in your cargo: 10 × Slaves, 1,500 × Soma. Hand it over?";
  const clients: Array<Parameters<typeof questionText>[2]> = [null, { templates: {} }, { templates: { "dialog:ChtCustomsConfiscationConfirmation2/title": null, "dialog:ChtCustomsConfiscationConfirmation2/body": null } }];
  for (const client of clients) {
    assert.equal(questionText(question.body, names, client), OWN);
    assert.equal(questionText(question.title, names, client), "");
  }
  // The client's text kept under the dialog's name as a LABEL is not the dialog's text.
  assert.equal(questionText(question.body, names, { templates: { ChtCustomsConfiscationConfirmation2: "not this" } }), OWN);
});

test("only a dialog's arguments are prepared: a label's tuple is left as the server sent it", () => {
  const templates = { "UI/Some/Label": "About {thing}.", "dialog:SomeDialog/body": "About {thing}." };
  const parameters = { type: "dict", entries: [["thing", [4, 3721]]] };
  assert.equal(questionText({ label: "UI/Some/Label", parameters, text: null }, names, { templates }), "About .");
  assert.equal(questionText({ label: null, dialog: "SomeDialog", part: "body", parameters, text: null }, names, { templates }), "About Slaves.");
  // And so a label's tuple names nothing to look up, where a dialog's does.
  assert.deepEqual(wordsNameRefs([{ label: "UI/Some/Label", parameters, text: null }], { templates }), []);
  assert.deepEqual(wordsNameRefs([{ label: null, dialog: "SomeDialog", part: "body", parameters, text: null }], { templates }), [{ kind: "type", id: 3721 }]);
});

test("a dialog's words ask for the dialog by name, and for the client's labels its typed values are worded with", () => {
  const question = decodeQuestion(CUSTOMS_DIALOG)!;
  assert.deepEqual(wordsLabels([question.title, question.body]), [
    "dialog:ChtCustomsConfiscationConfirmation2/title",
    "UI/Common/QuantityAndItem",
    "dialog:ChtCustomsConfiscationConfirmation2/body",
  ]);
  // A list with no separator is joined by the client's delimiter, which is asked for too.
  const loose = { label: null, dialog: "SomeDialog", part: "body" as const, parameters: { type: "dict", entries: [["things", [103, { type: "list", items: [[4, 34]] }]]] }, text: null };
  assert.deepEqual(wordsLabels([loose]), ["dialog:SomeDialog/body", "UI/Common/Formatting/ListGenericDelimiter"]);
  // A label's words ask for the label alone, whatever their parameters hold.
  assert.deepEqual(wordsLabels([{ label: "UI/Some/Label", parameters: loose.parameters, text: null }]), ["UI/Some/Label"]);
});

test("the names a dialog's words need are the ones its typed values name, whichever way it ends up worded", () => {
  const question = decodeQuestion(CUSTOMS_DIALOG)!;
  const keys = (client: Parameters<typeof questionNameRefs>[1]) => [...new Set(questionNameRefs(question, client).map((ref) => `${ref.kind}:${ref.id}`))];
  // By the client's dialog: an owner and two types (the title and the body carry the same parameters).
  assert.deepEqual(keys({ templates: DIALOG_TEMPLATES }), ["type:3721", "type:3713", "owner:500001"]);
  // By this client's own words: the faction and the types, the entries read out of their list.
  assert.deepEqual(keys(null), ["type:3721", "type:3713", "faction:500001"]);
  // A dialog whose template has typed tags of its own asks for those too.
  const mixed = { label: null, dialog: "SomeDialog", part: "body" as const, parameters: { type: "dict", entries: [["who", [2, 500001]], ["where", 30002780]] }, text: null };
  assert.deepEqual(
    wordsNameRefs([mixed], { templates: { "dialog:SomeDialog/body": "{who} in {[location]where.name}" } }).map((ref) => `${ref.kind}:${ref.id}`),
    ["system:30002780", "owner:500001"],
  );
});
