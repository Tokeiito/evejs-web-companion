// A GM's command, sent by the page itself (the plan's Phase 6b).
//
// Until 2026-10-10 it was one route of the BFF (POST /api/bridge/gm/slash), which checked that the page had said
// `confirm`, that there was a line and that it began as a command begins, and sent it as it stood.
//
// ⚠⚠ AN OPERATOR'S CONSOLE, AND IT REACHES EVERYTHING. This world's own chat commands, about a hundred and fifty of
// them: the item-granting ones the console exists for (/giveitem, /gmships, /gmweapons, /giveskill), and ones that
// destroy (/suicide) or spawn (/npc). The server asks for no role: any pilot may type the same in a chat channel.
// The line goes VERBATIM. A console that curated the list would be a worse, staler copy of the server's own.
//
// THE CALL, as the client makes it: sm.RemoteSvc('slash').SlashCmd(line), the one line of text, by the service's
// name. Its GM menus send lines of their own so (menusvc.py 834 and its neighbours); what a GM types in chat goes
// through the client's own slash service, which works out its aliases and then sends the same (svc_slash.py 520
// to 523). No Tranquility recording has one: they are a player's.
//
// THE REPLY is the server's own sentence, ITS FAILURES AMONG THEM: eve.js catches a command it could not run and
// answers "Command failed: …" or "Unknown command: …" rather than refusing the call. So a refusal arrives as an
// ordinary answer with a sentence in it, and whoever shows the reply shows that sentence. The one thing it
// refuses outright is a bare stroke, which it answers with its list of commands.
//
// A line that is no command is not sent: the server answers a bare word with that whole list, which is a wall of
// noise where one sentence says what is wrong.

import type { Ask } from "./ask.ts";

/** carbon/common/script/sys/serviceConst.py ROLE_GML (33) and ROLE_WORLDMOD (63): the roles a GM's buttons go by. */
export const ROLE_GML = 18014398509481984n;
export const ROLE_WORLDMOD = 4096n;

/** session.role & role == role: whether the session has that role (its roles a 64-bit mask, as its digits). */
export function sessionHasRole(sessionRole: string | null | undefined, role: bigint): boolean {
  return typeof sessionRole === "string" && /^\d+$/.test(sessionRole) && (BigInt(sessionRole) & role) === role;
}

/** Sends one line to the world as a GM's command and answers the world's reply ("" where it said nothing). */
export async function runSlashCommand(act: Ask, command: string): Promise<string> {
  const line = command.trim();
  if (line === "") {
    throw new Error("A command is required.");
  }
  if (!line.startsWith("/") && !line.startsWith(".")) {
    throw new Error("A GM command starts with / (or . for the container commands).");
  }
  const reply = await act("slash", "SlashCmd", [line]);
  return typeof reply === "string" ? reply : "";
}
