// Questions the SERVER asks the player.
//
// The server calls the client's own services and waits for the answer, and the
// retail client puts a window up for each:
//
//   agents.YesNo               a Yes/No window (before a mission is quit or
//                              declined, before research is cancelled)
//   agents.SingleChoiceBox     radio buttons with OK / Cancel (which field a
//                              research agent should work on)
//   agents.GetQuantity         a number box with OK / Cancel (how many
//                              datacores to buy)
//   XmppChat.AskYesNoQuestion  a Yes/No dialog (customs, over contraband)
//
// (eve/client/script/ui/station/agents/agents.py, xmppchatclient/xmppchatsvc.py.)
// On the game-port transport the BFF holds that call open, sends the question
// here on the pilot's event stream, and gives the server whatever comes back
// through POST /api/bridge/questions/:id/answer (src/gamePort/pilots.js).
//
// The server words a question with localisation labels, (labelID, parameters),
// or a dialog's message ID, which only the retail client's own data turns into
// text. The few it sends today are worded here, in this client's words; any
// other label is shown as the label, which is at least true.

import type { ClientQuestion, QuestionAnswer, QuestionWords } from "../store/types.ts";
import type { NameKind, NameRef } from "../store/names.ts";
import { formatTemplate, templateNameRefs, type TemplateArguments } from "./clientWords.ts";
import type { JsonValue } from "./wire.ts";

/**
 * The retail client's own text, when the page has it: its templates by label
 * (`store.words`), the character being flown (the client's `player` in every
 * message), and whatever else the client adds to this message's arguments
 * (for what an agent says, the agent's own IDs).
 */
export interface ClientWording {
  readonly templates: Readonly<Record<string, string | null>>;
  readonly playerID?: number | null;
  readonly extra?: TemplateArguments;
}

/** How a name is looked up for the words below: the page's name cache, or a stand-in. */
export type NameOf = (kind: NameKind, id: number) => string;

type Wording = string | ((parameters: Readonly<Record<string, JsonValue>>, nameOf: NameOf) => string);

/** A label's parameters, {type: "dict", entries: [[name, value], ...]}, by name. */
function parametersOf(value: unknown): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  const record = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, JsonValue>;
  const entries = Array.isArray(record.entries) ? record.entries : [];
  for (const entry of entries) {
    if (Array.isArray(entry) && typeof entry[0] === "string") {
      out[entry[0]] = entry[1] ?? null;
    }
  }
  return out;
}

const wholeNumber = (value: JsonValue | undefined): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : null;

const finiteNumber = (value: JsonValue | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * The contraband list as customs sends it: (UE_LIST, [(UE_TYPEIDANDQUANTITY,
 * typeID, quantity), ...], separator). eveCfg.__prepdict's codes: 103 and 24.
 */
function contrabandOf(value: JsonValue | undefined): Array<{ typeID: number; quantity: number }> {
  const list = Array.isArray(value) && value[0] === 103 && Array.isArray(value[1]) ? value[1] : [];
  const out: Array<{ typeID: number; quantity: number }> = [];
  for (const entry of list) {
    if (Array.isArray(entry) && entry[0] === 24) {
      const typeID = wholeNumber(entry[1]);
      const quantity = wholeNumber(entry[2]);
      if (typeID !== null && quantity !== null) {
        out.push({ typeID, quantity });
      }
    }
  }
  return out;
}

/** The faction as customs sends it: (UE_OWNERID, factionID). */
const ownerOf = (value: JsonValue | undefined): number | null =>
  Array.isArray(value) && value[0] === 2 ? wholeNumber(value[1]) : null;

const LABEL_WORDS: Readonly<Record<string, Wording>> = Object.freeze({
  "UI/Agents/StandardMission/DeclineMissionTitle": "Decline mission",
  "UI/Agents/StandardMission/DeclineMessage":
    "Decline this mission? Declining a second one from the same agent within four hours costs standing with them.",
  "UI/Agents/StandardMission/QuitMissionTitle": "Quit mission",
  "UI/Agents/StandardMission/QuitMissionMessage":
    "Quit this mission? It cannot be taken up again, and it costs standing with this agent and their corporation.",
  "UI/Agents/Research/CancelResearchQuestion": "Cancel research",
  "UI/Agents/Research/SureToCancelResearch":
    "Cancel your research with this agent? The research points gathered with them are lost.",
  "UI/Agents/Research/SureToCancelResearchAndMission":
    "Cancel your research with this agent? The research points gathered with them are lost, and the mission you have open with them counts as failed.",
  "UI/Agents/Research/SelectResearchTypeTitle": "Choose a field of research",
  "UI/Agents/Research/SelectResearchTypeMessage": "Which field should this agent research for you?",
  "UI/Agents/Research/SkillListing": (parameters, nameOf) => {
    const skillID = wholeNumber(parameters.skillID);
    const level = wholeNumber(parameters.skillLevel);
    const name = skillID === null ? "A skill" : nameOf("type", skillID);
    return level === null ? name : `${name} (level ${level})`;
  },
  "UI/Agents/Research/Datacores": "Buy datacores",
  "UI/Agents/Research/DatacorePrice": (parameters, nameOf) => {
    const typeID = wholeNumber(parameters.datacoreTypeID);
    const points = finiteNumber(parameters.rpAmount);
    const isk = finiteNumber(parameters.iskAmount);
    const name = typeID === null ? "A datacore" : nameOf("type", typeID);
    return `${name}: each costs ${points === null ? "?" : points.toLocaleString("en-US")} research points and ${
      isk === null ? "?" : isk.toLocaleString("en-US")
    } ISK. How many?`;
  },
  ChtCustomsConfiscationConfirmation2: (parameters, nameOf) => {
    const goods = contrabandOf(parameters.contraband)
      .map(({ typeID, quantity }) => `${quantity.toLocaleString("en-US")} × ${nameOf("type", typeID)}`)
      .join(", ");
    const factionID = ownerOf(parameters.empire);
    const who = factionID === null ? "Customs" : `${nameOf("faction", factionID)} customs`;
    return `${who} has found contraband in your cargo${goods ? `: ${goods}` : ""}. Hand it over?`;
  },
});

function decodeWords(value: JsonValue | undefined): QuestionWords {
  const record = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, JsonValue>;
  return {
    label: typeof record.label === "string" ? record.label : null,
    parameters: record.parameters ?? null,
    text: typeof record.text === "string" ? record.text : null,
  };
}

/** A `question` event off the pilot's stream, or null when it is not one this client can show. */
export function decodeQuestion(value: JsonValue | undefined): ClientQuestion | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, JsonValue>;
  const kind = record.kind;
  if (typeof record.id !== "string" || record.id === "" || (kind !== "yesNo" && kind !== "choice" && kind !== "quantity")) {
    return null;
  }
  const choices = kind === "choice" && Array.isArray(record.choices) ? record.choices.map(decodeWords) : [];
  const limits = (kind === "quantity" && record.quantity && typeof record.quantity === "object" && !Array.isArray(record.quantity)
    ? record.quantity
    : null) as Record<string, JsonValue> | null;
  // A choice with nothing to choose from, or a number box with no limits, is not something to show.
  if ((kind === "choice" && choices.length === 0) || (kind === "quantity" && limits === null)) {
    return null;
  }
  return {
    id: record.id,
    service: typeof record.service === "string" ? record.service : "",
    method: typeof record.method === "string" ? record.method : "",
    kind,
    title: decodeWords(record.title),
    body: decodeWords(record.body),
    agentID: wholeNumber(record.agentID),
    contentID: wholeNumber(record.contentID),
    suppressID: typeof record.suppressID === "string" ? record.suppressID : null,
    askedAtMs: wholeNumber(record.askedAtMs) ?? 0,
    expiresAtMs: wholeNumber(record.expiresAtMs) ?? 0,
    choices,
    quantity: limits === null
      ? null
      : {
          min: finiteNumber(limits.min) ?? 0,
          max: finiteNumber(limits.max),
          initial: finiteNumber(limits.initial),
          digits: wholeNumber(limits.digits) ?? 0,
        },
  };
}

/** Names with no cache behind them: the ID, said plainly. */
const nameByID: NameOf = (kind, id) => `${kind} ${id}`;

/** A label's arguments: what the client adds, then what the server sent with it, which wins. */
const argumentsFor = (words: QuestionWords, client: ClientWording): TemplateArguments =>
  ({ ...(client.extra ?? {}), ...parametersOf(words.parameters) });

/**
 * What to show for a title, a body, a choice or an agent's line: its text;
 * the retail client's own text for its label, filled in, when the page has
 * it; failing that this client's words for the label; failing that the label
 * itself.
 */
export function questionText(words: QuestionWords, nameOf: NameOf = nameByID, client: ClientWording | null = null): string {
  if (words.text !== null) {
    return words.text;
  }
  if (words.label !== null) {
    const template = client ? client.templates[words.label] : null;
    if (typeof template === "string") {
      return formatTemplate(template, argumentsFor(words, client as ClientWording), { nameOf, playerID: client?.playerID ?? null });
    }
    const wording = LABEL_WORDS[words.label];
    if (wording === undefined) {
      return words.label;
    }
    return typeof wording === "string" ? wording : wording(parametersOf(words.parameters), nameOf);
  }
  return "";
}

/** The labels among some words, for the page to ask the client's text of. */
export function wordsLabels(all: ReadonlyArray<QuestionWords | null | undefined>): string[] {
  const labels: string[] = [];
  for (const words of all) {
    if (words && words.label !== null && !labels.includes(words.label)) {
      labels.push(words.label);
    }
  }
  return labels;
}

/** The names some words need, whichever way they end up worded, for the page's name cache to fetch. */
export function wordsNameRefs(all: ReadonlyArray<QuestionWords | null | undefined>, client: ClientWording | null = null): NameRef[] {
  const refs: NameRef[] = [];
  for (const words of all) {
    if (!words) {
      continue;
    }
    const template = client && words.label !== null ? client.templates[words.label] : null;
    if (typeof template === "string") {
      refs.push(...templateNameRefs(template, argumentsFor(words, client as ClientWording), { playerID: client?.playerID ?? null }));
      continue;
    }
    const parameters = parametersOf(words.parameters);
    for (const name of ["skillID", "datacoreTypeID"]) {
      const typeID = wholeNumber(parameters[name]);
      if (typeID !== null) {
        refs.push({ kind: "type", id: typeID });
      }
    }
    for (const { typeID } of contrabandOf(parameters.contraband)) {
      refs.push({ kind: "type", id: typeID });
    }
    const factionID = ownerOf(parameters.empire);
    if (factionID !== null) {
      refs.push({ kind: "faction", id: factionID });
    }
  }
  return refs;
}

/** The names a question's words need, for the page's name cache to fetch. */
export function questionNameRefs(question: ClientQuestion, client: ClientWording | null = null): NameRef[] {
  return wordsNameRefs([question.title, question.body, ...question.choices], client);
}

/**
 * Whether an answer is one the question's own window could have given: the
 * BFF refuses any other, so the page does not offer one.
 */
export function answerFits(question: ClientQuestion, answer: QuestionAnswer): boolean {
  switch (question.kind) {
    case "yesNo":
      return typeof answer === "boolean";
    case "choice":
      return typeof answer === "object" && answer !== null && Number.isSafeInteger(answer.index) &&
        answer.index >= 0 && answer.index < question.choices.length;
    case "quantity": {
      if (answer === null) {
        return true;
      }
      const limits = question.quantity;
      return typeof answer === "number" && Number.isFinite(answer) && limits !== null &&
        (limits.digits > 0 || Number.isInteger(answer)) && answer >= limits.min &&
        (limits.max === null || answer <= limits.max);
    }
  }
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
