// The Skills window's reads, made by whoever shows it (the plan's Phase 6b).
//
// The page asked one route of the BFF (GET /api/bridge/skills), and the BFF made
// the sheet from what its game-port transport keeps of the skill handler's
// answers. A retail client has no such route: its skill service and its queue
// service ask the handler (eve/client/script/ui/services/skillsvc.py,
// skillQueueSvc.py), and its windows work their figures out of what those keep.
// This is that asking, each call made by the generic call (ask.ts), and the
// sheet made from the answers (skillSheet.ts).
//
// THE CALLS, as the client makes them, each with nothing:
//
//   skillHandler.GetSkillQueueAndFreePoints()   skillQueueSvc.py 117
//   skillHandler.GetSkills()                    skillsvc.py 136
//   skillHandler.GetAllSkills()                 skillsvc.py 142
//   skillHandler.GetFreeSkillPoints()           skillsvc.py 852
//   skillHandler.GetAttributes()                skillsvc.py 224: only where a skill is in training, whose
//                                               points so far are reckoned from the pilot's rate
//
// The client asks each once and keeps the answer right from the server's
// notices. So does the transport on the game port, which answers all five from
// what it keeps and sends nothing (src/gamePort/pilots.js).
//
// WHAT THE CLIENT KNOWS WITHOUT ASKING: a type's name and its group's, and the
// two attributes a skill trains by, from its install. Here they are asked of the
// BFF's static data, once for a type (createSkillTypeFacts).
//
// THROUGH THE WEB GATEWAY the queue's call is not carried (its list has not got
// it), and the sheet there is the gateway's own. `readSkillSheet` then answers
// null, and whoever asked reads the route.

import { failureCode, type Ask } from "./ask.ts";
import { ATTRIBUTE_PRIMARY, ATTRIBUTE_SECONDARY, buildSkillSheet, skillInTraining, skillTypeIDs } from "./skillSheet.ts";
import type { JsonValue } from "./wire.ts";

const HANDLER = "skillHandler";

/** What is known of some skills' types without asking the server. */
export interface SkillTypeFacts {
  name(typeID: number): string | null | undefined;
  groupName(typeID: number): string | null | undefined;
  attribute(typeID: number, attributeID: number): number | null | undefined;
}

/** Whose sheet it is, and what the making needs that no call of the server's answers. */
export interface SkillSheetFor {
  readonly characterID: number;
  readonly characterName: string;
  /** The facts of these types, and of the type in training its two attributes (createSkillTypeFacts). */
  typeFacts(typeIDs: readonly number[], trainingTypeID: number | null): Promise<SkillTypeFacts>;
  /** The server's clock as whoever asks has it, in milliseconds. */
  now(): number;
}

/**
 * The sheet, made from the handler's reads. Fails as a read fails: a sheet with a part missing would say what is
 * not so. Null where the queue's read is not carried (the web gateway): then the route's sheet is the one to read.
 */
export async function readSkillSheet(ask: Ask, whose: SkillSheetFor): Promise<JsonValue | null> {
  let answered: JsonValue;
  try {
    answered = await ask(HANDLER, "GetSkillQueueAndFreePoints", []);
  } catch (error) {
    if (failureCode(error) === "CALL_NOT_ALLOWED") return null;
    throw error;
  }
  // (the queue, the free points). Anything else is no queue, and a sheet that showed none would be a guess.
  const queue = Array.isArray(answered) ? (answered[0] as JsonValue | undefined) : undefined;
  if (queue === null || typeof queue !== "object" || !Array.isArray((queue as { items?: unknown }).items)) {
    throw Object.assign(new Error("The skill queue was not answered as a queue."), { code: "BRIDGE_BAD_RESPONSE" });
  }
  const [skills, allSkills, freeSkillPoints] = await Promise.all([
    ask(HANDLER, "GetSkills", []),
    ask(HANDLER, "GetAllSkills", []),
    ask(HANDLER, "GetFreeSkillPoints", []),
  ]);
  const training = skillInTraining(queue);
  const attributes = training === null ? null : await ask(HANDLER, "GetAttributes", []);
  const facts = await whose.typeFacts(skillTypeIDs(skills), training);
  return buildSkillSheet({
    characterID: whose.characterID,
    characterName: whose.characterName,
    skills,
    allSkills,
    queue,
    freeSkillPoints,
    attributes,
    now: whose.now,
    typeName: facts.name,
    typeGroupName: facts.groupName,
    typeAttribute: facts.attribute,
  });
}

/** The BFF's static data, as the facts are read from it. */
export interface StaticReads {
  /** Names by "kind:id" (POST /api/names). A key that is not there was not answered. */
  names(items: readonly { readonly kind: "type" | "typeGroup"; readonly id: number }[]): Promise<Readonly<Record<string, string | null>>>;
  /** A type's attributes by their IDs (POST /api/types/dogma). */
  typeAttributes(typeIDs: readonly number[], attributeIDs: readonly number[]): Promise<Readonly<Record<number, Readonly<Record<number, number>>>>>;
}

/** How many types' names are asked for at once: the route takes 500 names, and a type is two of them. */
export const TYPES_AT_ONCE = 250;

/**
 * What is known of skills' types, asked of the static data once for each and kept: a type does not change. A name
 * that was not answered is not kept, and is asked for again when it is next wanted.
 */
export function createSkillTypeFacts(reads: StaticReads): SkillSheetFor["typeFacts"] {
  const names = new Map<string, string | null>();
  const trainsBy = new Map<number, Readonly<Record<number, number>>>();
  return async (typeIDs, trainingTypeID) => {
    const wanted = [...new Set(typeIDs)].filter((typeID) => !names.has(`type:${typeID}`) || !names.has(`typeGroup:${typeID}`));
    for (let at = 0; at < wanted.length; at += TYPES_AT_ONCE) {
      const answered = await reads.names(wanted.slice(at, at + TYPES_AT_ONCE).flatMap((id) => [{ kind: "type" as const, id }, { kind: "typeGroup" as const, id }]));
      for (const [key, name] of Object.entries(answered)) names.set(key, name);
    }
    if (trainingTypeID !== null && !trainsBy.has(trainingTypeID)) {
      const answered = (await reads.typeAttributes([trainingTypeID], [ATTRIBUTE_PRIMARY, ATTRIBUTE_SECONDARY]))[trainingTypeID];
      if (answered !== undefined) trainsBy.set(trainingTypeID, answered);
    }
    return {
      name: (typeID) => names.get(`type:${typeID}`),
      groupName: (typeID) => names.get(`typeGroup:${typeID}`),
      attribute: (typeID, attributeID) => trainsBy.get(typeID)?.[attributeID],
    };
  };
}
