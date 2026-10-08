// The server's questions as the browser reads them. The event below is the one
// src/gamePort/pilots.js publishes for the server's own decline question
// (test/gamePortPilots.test.js builds the same one from the server's call).

import test from "node:test";
import assert from "node:assert/strict";

import { createBotPresses, decodeQuestion, questionText } from "./questions.ts";
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
  });
});

test("what is not a question this client can show is not shown", () => {
  for (const wrong of [null, undefined, "q", [], {}, { ...DECLINE, id: "" }, { ...DECLINE, id: 7 }, { ...DECLINE, kind: "choice" }]) {
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
