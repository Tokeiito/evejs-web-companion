// TEST FIXTURES ONLY — the table of agents as the server answers it, for the suites whose flow lists a station's
// agents. Nothing in the app imports this (`botFixtures.ts` is the precedent for a test-only module under src).
//
// agentMgr.GetAgents answers the whole table, a Rowset of a header and lines. The form below is what both
// transports printed for this server on 2026-10-11 (10,941 lines, fifteen fields); the rows are the tests' own.

import type { AgentRow } from "../store/types.ts";

/** The table's fields, in the server's order. */
export const AGENT_FIELDS = [
  "agentID", "agentTypeID", "divisionID", "level", "stationID", "corporationID", "isLocatorAgent", "isInSpace",
  "careerID", "importantMission", "missionKind", "missionTypeLabel", "specialityID", "stationTypeID", "bloodlineID",
] as const;

/** One line of the table for an agent as the page has it: the fields the page reads, and the server's others made up. */
function lineOf(agent: AgentRow): unknown {
  return { type: "list", items: [
    agent.agentID, agent.agentTypeID, agent.divisionID, agent.level, agent.stationID, agent.corporationID, false, agent.stationID === null,
    14, false, agent.missionKind, agent.missionTypeLabel, 15, 1531, agent.bloodlineID ?? null,
  ] };
}

/** agentMgr.GetAgents' own answer for these agents: the Rowset, header and lines. */
export function agentsRowset(agents: readonly AgentRow[]): unknown {
  return {
    type: "object",
    name: "eve.common.script.sys.rowset.Rowset",
    args: { type: "dict", entries: [
      ["header", { type: "list", items: [...AGENT_FIELDS] }],
      ["RowClass", { type: "token", value: "carbon.common.script.sys.row.Row" }],
      ["lines", { type: "list", items: agents.map(lineOf) }],
    ] },
  };
}

/** The generic call's answer for the table (POST /api/bridge/call). */
export function agentsTableAnswer(agents: readonly AgentRow[]): { ok: true; service: string; method: string; result: unknown; notifications: unknown[] } {
  return { ok: true, service: "agentMgr", method: "GetAgents", result: agentsRowset(agents), notifications: [] };
}

/** Whether a request of the page's is its own read of the table: agentMgr.GetAgents by the generic call. */
export function isAgentsTableCall(path: string, body: unknown): boolean {
  const call = body as { service?: unknown; method?: unknown } | null;
  return path === "/api/bridge/call" && call?.service === "agentMgr" && call?.method === "GetAgents";
}

/**
 * A pilot coming online docked at a station, as a store's event: the page lists the agents of the station it has
 * its pilot at, so a flow asked for agents wants a pilot somewhere. With null the pilot is at no station.
 */
export function pilotDockedAt(stationID: number | null): never {
  return {
    type: "character/online",
    character: { characterID: 140000005, characterName: "Test", stationID, structureID: null, solarSystemID: 30002780, corporationID: 1000002 },
    station: null,
  } as never;
}

// agents.py 92: sm.RemoteSvc('agentMgr').GetAgents(), by name and with nothing, as a pilot's read.
export const THE_AGENTS_TABLE_READ = { service: "agentMgr", method: "GetAgents", args: [], kwargs: null, pilot: true };
