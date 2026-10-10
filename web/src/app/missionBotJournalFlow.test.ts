// The mission bot's reading of the journal, through the real flow over a faked BFF.
//
// The bot's loop (nav/missionBotLoop.ts) is tested with stand-ins for what it reads. What the flow hands it for
// the journal (makeMissionBotDeps, getJournal) was reached by no test: this starts the bot and watches its first
// reading. The journal is read as the page reads it anywhere, by its own call (bridge/journalReads.ts), and never
// by the route the page read until 2026-10-10.

import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";
import { fittingBody, flightBody, holdsBody, namesBody, spaceBody } from "./botFixtures.ts";

const STATION = 60003760;
const AGENT = 3018920;
const MISSION_REQUEST = { agentID: AGENT, agentName: "Aursa Bemenen", agentStationID: STATION, agentStationName: "Jita IV - Moon 4", maxJumps: 10, maxMissions: 0 };
/** An accepted courier mission of that agent's, as the gateway spells a journal's row. */
const ACCEPTED = { type: "tuple", items: [2, 0, "UI/Agents/MissionTypes/Courier", 5001, AGENT, null, { type: "list", items: [] }, 0, 0, 7] };

interface Asked {
  readonly path: string;
  readonly body: Record<string, unknown>;
}

test("the mission bot reads the journal by the page's own call, and what it read is on the page", async () => {
  const asked: Asked[] = [];
  const fakeFetch = (async (input: unknown, init?: { body?: unknown }) => {
    const path = String(input);
    const body = (init && typeof init.body === "string" ? JSON.parse(init.body) : {}) as Record<string, unknown>;
    asked.push({ path, body });
    let outcome: unknown = { ok: true };
    if (path === "/api/bridge/flight/status") outcome = flightBody(true);
    if (path === "/api/bridge/space/snapshot") outcome = spaceBody();
    if (path === "/api/bridge/fitting") outcome = fittingBody();
    if (path === "/api/bridge/ship/ore-hold") outcome = holdsBody(0, []);
    if (path === "/api/names") outcome = namesBody(body);
    if (path === "/api/bridge/targets") outcome = { ok: true, targetIDs: [], notifications: [] };
    if (path === "/api/bridge/call") {
      const journal = body.service === "agentMgr" && body.method === "GetMyJournalDetails";
      outcome = { ok: true, service: body.service, method: body.method, result: journal ? { type: "tuple", items: [{ type: "list", items: [ACCEPTED] }, { type: "list", items: [] }] } : null, notifications: [] };
    }
    return { ok: true, status: 200, async json() { return outcome; } };
  }) as unknown as typeof fetch;
  const store = createClientStore();
  const flow = createAppFlow(store, { fetch: fakeFetch });
  const journalCalls = () => asked.filter((request) => request.path === "/api/bridge/call" && request.body.service === "agentMgr" && request.body.method === "GetMyJournalDetails");

  assert.equal(store.agents.get().journal, null);
  await flow.startMissionBot(MISSION_REQUEST);
  try {
    assert.equal(store.get().missionBot.status, "running");
    // Its first reading of the world asks for the journal.
    for (let waited = 0; waited < 200 && store.agents.get().journal === null; waited += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    // Asked as the page asks it: the journal service's own call, with nothing, as a pilot's.
    assert.deepEqual(journalCalls()[0]?.body, { service: "agentMgr", method: "GetMyJournalDetails", args: [], kwargs: null, pilot: true });
    assert.equal(asked.some((request) => request.path === "/api/bridge/journal"), false);
    // And what the bot read is what the Agents & Missions window then shows.
    assert.deepEqual(store.agents.get().journal?.active.map((mission) => [mission.agentID, mission.missionState]), [[AGENT, 2]]);
  } finally {
    flow.stopMissionBot();
  }
});
