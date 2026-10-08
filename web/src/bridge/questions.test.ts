// The server's questions as the browser reads them. The event below is the one
// src/gamePort/pilots.js publishes for the server's own decline question
// (test/gamePortPilots.test.js builds the same one from the server's call).

import test from "node:test";
import assert from "node:assert/strict";

import { answerFits, createBotPresses, decodeQuestion, questionNameRefs, questionText } from "./questions.ts";
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
