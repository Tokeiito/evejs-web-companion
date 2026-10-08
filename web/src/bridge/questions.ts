// Questions the SERVER asks the player.
//
// The server calls the client's own services and waits for the answer: before
// a mission is quit or declined it calls agents.YesNo, and the retail client
// puts up a Yes/No window (eve/client/script/ui/station/agents/agents.py). On
// the game-port transport the BFF holds that call open, sends the question
// here on the pilot's event stream, and gives the server whatever comes back
// through POST /api/bridge/questions/:id/answer (src/gamePort/pilots.js).
//
// The server words a question with localisation labels, (labelID, parameters),
// which only the retail client's own data turns into text. The few it sends
// today are worded here, in this client's words; any other label is shown as
// the label, which is at least true.

import type { ClientQuestion, QuestionWords } from "../store/types.ts";
import type { JsonValue } from "./wire.ts";

const LABEL_WORDS: Readonly<Record<string, string>> = Object.freeze({
  "UI/Agents/StandardMission/DeclineMissionTitle": "Decline mission",
  "UI/Agents/StandardMission/DeclineMessage":
    "Decline this mission? Declining a second one from the same agent within four hours costs standing with them.",
  "UI/Agents/StandardMission/QuitMissionTitle": "Quit mission",
  "UI/Agents/StandardMission/QuitMissionMessage":
    "Quit this mission? It cannot be taken up again, and it costs standing with this agent and their corporation.",
});

function decodeWords(value: JsonValue | undefined): QuestionWords {
  const record = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, JsonValue>;
  return {
    label: typeof record.label === "string" ? record.label : null,
    parameters: record.parameters ?? null,
    text: typeof record.text === "string" ? record.text : null,
  };
}

const wholeNumber = (value: JsonValue | undefined): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : null;

/** A `question` event off the pilot's stream, or null when it is not one this client can show. */
export function decodeQuestion(value: JsonValue | undefined): ClientQuestion | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, JsonValue>;
  if (typeof record.id !== "string" || record.id === "" || record.kind !== "yesNo") {
    return null;
  }
  return {
    id: record.id,
    service: typeof record.service === "string" ? record.service : "",
    method: typeof record.method === "string" ? record.method : "",
    kind: "yesNo",
    title: decodeWords(record.title),
    body: decodeWords(record.body),
    agentID: wholeNumber(record.agentID),
    contentID: wholeNumber(record.contentID),
    suppressID: typeof record.suppressID === "string" ? record.suppressID : null,
    askedAtMs: wholeNumber(record.askedAtMs) ?? 0,
    expiresAtMs: wholeNumber(record.expiresAtMs) ?? 0,
  };
}

/** What to show for a title or a body: its text, this client's words for its label, or the label itself. */
export function questionText(words: QuestionWords): string {
  if (words.text !== null) {
    return words.text;
  }
  if (words.label !== null) {
    return LABEL_WORDS[words.label] ?? words.label;
  }
  return "";
}

/**
 * Which agents' buttons a bot of this page is pressing right now.
 *
 * A bot that presses Decline has decided; the server's "are you sure" about
 * that press is answered Yes without being put to the user, who did not press
 * anything. A press by the user is not tracked here, and its question is shown.
 */
export interface BotPresses {
  /** Run one press; the agent counts as being pressed by a bot until it settles, however it settles. */
  during<T>(agentID: number, press: () => Promise<T>): Promise<T>;
  /** Whether a question is the server asking about a press that is in flight. */
  answers(question: ClientQuestion): boolean;
}

export function createBotPresses(): BotPresses {
  const inFlight = new Map<number, number>();
  return {
    async during(agentID, press) {
      inFlight.set(agentID, (inFlight.get(agentID) ?? 0) + 1);
      try {
        return await press();
      } finally {
        const left = (inFlight.get(agentID) ?? 1) - 1;
        if (left > 0) {
          inFlight.set(agentID, left);
        } else {
          inFlight.delete(agentID);
        }
      }
    },
    answers(question) {
      return question.kind === "yesNo" && question.agentID !== null && inFlight.has(question.agentID);
    },
  };
}
