// A station's agents listed by the page itself (the plan's Phase 6b), through the real flow over a faked BFF.
//
// Until 2026-10-11 the page asked GET /api/bridge/agents, which read the pilot's flight, asked the server for the
// whole table of agents, and handed on those at the station the BFF had the pilot at. It is the client's agents
// service's way now (bridge/agentReads.ts): the table asked for once and kept, and the station's agents picked
// from it, by the station the page has its pilot docked at.

import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";
import type { AgentRow } from "../store/types.ts";
import { agentsTableAnswer, isAgentsTableCall, pilotDockedAt, THE_AGENTS_TABLE_READ } from "./agentFixtures.ts";

const STATION_A = 60000004;
const STATION_B = 60003760;
const agent = (agentID: number, stationID: number | null, level = 1): AgentRow =>
  ({ agentID, agentTypeID: 2, divisionID: 22, level, stationID, corporationID: 1000002, missionKind: "courier", missionTypeLabel: "UI/Agents/MissionTypes/Courier" });
/** The whole table: two agents at one station, one at another, and one in space. */
const TABLE = [agent(3000001, STATION_A), agent(3000002, STATION_B, 4), agent(3000003, null), agent(3000004, STATION_A, 2)];

type Answer = { readonly status: number; readonly body: unknown };
const THE_TABLE: Answer = { status: 200, body: agentsTableAnswer(TABLE) };
const refused = (error: string, status: number): Answer => ({ status, body: { ok: false, error, message: error } });

/** A flow whose BFF answers each read of the table as the test says (the first read is 1). `docked` is the station the pilot comes online at; with "nobody" no pilot is online. */
function harness(answerTo: (read: number) => Answer | Promise<Answer> = () => THE_TABLE, docked: number | null | "nobody" = STATION_A) {
  const store = createClientStore();
  if (docked !== "nobody") store.apply(pilotDockedAt(docked));
  const reads: Record<string, unknown>[] = [];
  const routes: string[] = [];
  const flow = createAppFlow(store, { livePush: false, fetch: async (input, init) => {
    const path = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    // The route, which nothing is to ask: it answers another station's agent.
    if (path.startsWith("/api/bridge/agents")) {
      routes.push(path);
      return Response.json({ ok: true, stationID: 60008494, agents: [agent(3009999, 60008494)] });
    }
    if (isAgentsTableCall(path, body)) {
      reads.push(body);
      const answer = await answerTo(reads.length);
      return Response.json(answer.body, { status: answer.status });
    }
    if (path === "/api/names") return Response.json({ ok: true, names: {} });
    return Response.json({ ok: true });
  } });
  const listed = () => store.agents.get().agents.map((each) => each.agentID);
  const movedTo = (stationID: number | null, structureID: number | null = null) =>
    store.apply({ type: "station/relocated", stationID, structureID, solarSystemID: 30000142, station: null } as never);
  return { store, flow, reads, routes, listed, movedTo };
}

test("a station's agents are the table's at the station the page has its pilot docked at: the table asked for by the page's own call, and never the route", async () => {
  const { store, flow, reads, routes, listed } = harness();
  await flow.loadAgents();
  // dockedUI/agents.py 153: sm.GetService('agents').GetAgentsByStationID()[session.stationid].
  assert.deepEqual([listed(), store.agents.get().stationID, store.agents.get().loaded, store.agents.get().actionError], [[3000001, 3000004], STATION_A, true, null]);
  assert.deepEqual(store.agents.get().agents[1], agent(3000004, STATION_A, 2));
  assert.deepEqual(reads, [THE_AGENTS_TABLE_READ]);
  assert.deepEqual(routes, []);
});

test("the table is asked for once and kept, as the client's agents service keeps it: another look, and the pilot docked elsewhere, ask nothing", async () => {
  const { store, flow, reads, routes, listed, movedTo } = harness();
  await flow.loadAgents();
  await flow.loadAgents();
  movedTo(STATION_B);
  await flow.loadAgents();
  assert.deepEqual([listed(), store.agents.get().stationID], [[3000002], STATION_B]);
  // A station with no agent in the table has none, and that is no failure.
  movedTo(60008494);
  await flow.loadAgents();
  assert.deepEqual([listed(), store.agents.get().stationID, store.agents.get().actionError], [[], 60008494, null]);
  assert.deepEqual([reads.length, routes], [1, []]);
});

test("a pilot the page has at no station is listed no agents, and nothing is asked for", async () => {
  for (const [what, docked] of [["in a structure", null], ["nobody online", "nobody"]] as const) {
    const { store, flow, reads, routes, listed } = harness(() => THE_TABLE, docked);
    await flow.loadAgents();
    // Not the agents in space, who are at no station either.
    assert.deepEqual([listed(), store.agents.get().stationID, store.agents.get().loaded, store.agents.get().actionError], [[], null, true, null], what);
    assert.deepEqual([reads, routes], [[], []], what);
  }
});

test("a table that could not be read is said, and asked for again: it is not kept as the table", async () => {
  const answers: Array<[string, Answer]> = [
    ["the call failed", refused("CALL_FAILED", 502)],
    ["nothing", { status: 200, body: { ok: true, service: "agentMgr", method: "GetAgents", result: null, notifications: [] } }],
    ["the route's envelope", { status: 200, body: { ok: true, service: "agentMgr", method: "GetAgents", result: { ok: true, stationID: STATION_A, agents: [agent(3000001, STATION_A)] }, notifications: [] } }],
  ];
  for (const [what, failure] of answers) {
    const { store, flow, reads, routes, listed } = harness((read) => (read === 1 ? failure : THE_TABLE));
    await flow.loadAgents();
    assert.deepEqual([listed(), store.agents.get().loaded], [[], false], what);
    assert.equal(typeof store.agents.get().actionError, "string", what);
    await flow.loadAgents();
    assert.deepEqual([listed(), store.agents.get().actionError, reads.length, routes], [[3000001, 3000004], null, 2, []], what);
  }
  // What came back as no table says so.
  const none = harness(() => ({ status: 200, body: { ok: true, service: "agentMgr", method: "GetAgents", result: null, notifications: [] } }));
  await none.flow.loadAgents();
  assert.match(none.store.agents.get().actionError ?? "", /The agents could not be read \(the server did not answer with their table\)\./);
});

test("a pilot's session gone while the table is read fails the look, and the pilot is offline; the table is asked for again after", async () => {
  const { store, flow, reads } = harness((read) => (read === 1 ? refused("SESSION_NOT_FOUND", 404) : THE_TABLE));
  await assert.rejects(flow.loadAgents(), (reason: { code?: string }) => reason.code === "SESSION_NOT_FOUND");
  assert.equal(store.station.get().online, null);
  store.apply(pilotDockedAt(STATION_A));
  await flow.loadAgents();
  assert.deepEqual([store.agents.get().agents.map((each) => each.agentID), reads.length], [[3000001, 3000004], 2]);
});

test("the agents listed are those of where the pilot is when the table comes, and two looks at once ask for it once", async () => {
  let answer!: (value: Answer) => void;
  const waiting = new Promise<Answer>((resolve) => { answer = resolve; });
  const { store, flow, reads, listed, movedTo } = harness(() => waiting);
  const first = flow.loadAgents();
  const second = flow.loadAgents();
  await new Promise<void>((resolve) => setImmediate(resolve));
  movedTo(STATION_B);
  answer(THE_TABLE);
  await Promise.all([first, second]);
  assert.deepEqual([listed(), store.agents.get().stationID, reads.length], [[3000002], STATION_B, 1]);
});
