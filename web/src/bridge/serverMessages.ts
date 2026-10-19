// What the SERVER tells the player, unasked.
//
// The server sends OnRemoteMessage(msgID, dict) and the retail client puts the dialog of that name up, its text
// filled from the dict (gameui.py OnRemoteMessage, 347 to 356: prompt_player_fsd_dialog(msgID, dict)). Most of what
// this server sends is CustomNotify, whose dialog is the dict's own sentence ({notify}); the rest are dialogs of the
// client's own (a mining drone's asteroid gone, a fleet warp followed, a ship's self-destruct).
//
// The page words a message as it words a server's question (bridge/questions.ts): from the client's own dialog where
// the BFF has a client to read, and otherwise in this client's words below, written as the client's are; a message
// neither has words for is not shown.

import { formatTemplate, type TemplateArguments } from "./clientWords.ts";
import { questionText, type ClientWording, type NameOf } from "./questions.ts";
import type { QuestionWords } from "../store/types.ts";
import type { JsonValue } from "./wire.ts";

/** The server's notice of a message for the player. */
export const REMOTE_MESSAGE = "OnRemoteMessage";

export interface ServerMessage {
  readonly words: QuestionWords;
  /** How it is said: an error as an error, everything else as a notice. */
  readonly kind: "notice" | "error";
}

/** A dialog's name, as the server sends one. */
const DIALOG_NAME = /^\w{1,100}$/;

/** The dict's entries by name; a wstring as its text. */
function parametersOf(value: unknown): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  const record = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, JsonValue>;
  for (const entry of Array.isArray(record.entries) ? record.entries : []) {
    if (Array.isArray(entry) && typeof entry[0] === "string") {
      const held = entry[1] ?? null;
      const text = held && typeof held === "object" && !Array.isArray(held) && (held as { type?: unknown }).type === "wstring" ? (held as { value?: JsonValue }).value ?? null : held;
      out[entry[0]] = text;
    }
  }
  return out;
}

/** OnRemoteMessage's arguments, as the words of a dialog; null for what names no dialog. */
export function decodeRemoteMessage(args: readonly unknown[]): ServerMessage | null {
  const name = typeof args[0] === "string" ? args[0] : null;
  if (name === null || !DIALOG_NAME.test(name)) return null;
  const parameters = parametersOf(args[1]);
  return {
    words: { text: null, label: null, messageID: null, dialog: name, part: "body", parameters: { type: "dict", entries: Object.entries(parameters) } },
    kind: name === "CustomError" ? "error" : "notice",
  };
}

/** This client's words for the dialogs this server sends, written as the client's are and filled the same way. */
const OWN_WORDS: Readonly<Record<string, string>> = Object.freeze({
  CustomNotify: "{notify}",
  CustomInfo: "{info}",
  CustomError: "{error}",
  CustomWarning: "{warning}",
  MiningDronesDeactivatedAsteroidEmpty: "{modulename} stops: the resource it was harvesting is gone.",
  FleetWarp: "Following {leader} in warp.",
  ShipInWarp: "You cannot do that while warping.",
});

/**
 * The message as the player reads it: the client's own dialog where the page has it, else this client's words; null
 * where there are none, or where they come out empty.
 */
export function serverMessageText(message: ServerMessage, nameOf: NameOf, client: ClientWording | null): string | null {
  const theirs = questionText(message.words, nameOf, client).trim();
  if (theirs !== "") return theirs;
  const own = OWN_WORDS[message.words.dialog ?? ""];
  if (own === undefined) return null;
  const parameters: TemplateArguments = Object.fromEntries((message.words.parameters as { entries: [string, JsonValue][] }).entries);
  const text = formatTemplate(own, parameters, { nameOf, playerID: client?.playerID ?? null }).trim();
  return text === "" ? null : text;
}
