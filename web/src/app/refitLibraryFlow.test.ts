// The refit library read by the page itself (the plan's Phase 6b), through the real flow over a faked BFF.
//
// Until 2026-10-11 it was two routes: the pilot's own fittings (GET /api/bridge/fittings) and its
// corporation's (GET /api/bridge/shared-fittings, which read three libraries and of which the page took the
// corporation's). It is the client's fitting service's call now, once for each owner
// (bridge/fittingReads.ts), and neither route.

import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";

const PILOT = 140000005;
const CORPORATION = 98000000;

/** One saved fitting, in the shape every fitting manager answers (buildFittingPayload). */
const fitting = (fittingID: number, name: string, ownerID: number): unknown => ({
  type: "object", name: "util.KeyVal",
  args: { type: "dict", entries: [
    ["description", ""], ["fitData", { type: "list", items: [{ type: "tuple", items: [3651, 28, 1] }] }], ["fittingID", fittingID], ["name", name],
    ["ownerID", ownerID], ["savedDate", { type: "long", value: "134285151537020000" }], ["shipTypeID", 588],
  ] },
});
const library = (...rows: readonly (readonly [number, unknown])[]): unknown => ({ type: "dict", entries: rows });
/** corpFittingMgr.GetFittings answers its library in a cached call's result. */
const cached = (value: unknown): unknown => ({
  type: "object",
  name: { type: "rawstr", value: "carbon.common.script.net.objectCaching.CachedMethodCallResult" },
  args: [{ type: "dict", entries: [[{ type: "rawstr", value: "versionCheck" }, { type: "rawstr", value: "15 minutes" }]] }, { type: "substream", value }, { type: "list", items: [{ type: "long", value: "134292024069930000" }, 61145237] }],
});
const OWN = library([1, fitting(1, "Miner", PILOT)]);
const CORPORATIONS = cached(library([2, fitting(2, "Corp hauler", CORPORATION)]));

type Answer = { readonly status: number; readonly body: unknown };
const answered = (service: string, result: unknown): Answer => ({ status: 200, body: { ok: true, service, method: "GetFittings", result, notifications: [] } });
const refused = (error: string, status: number): Answer => ({ status, body: { ok: false, error, message: error } });

function harness(answers: { own?: Answer; corporation?: Answer } = {}, who: { characterID: number; corporationID: number | null } | null = { characterID: PILOT, corporationID: CORPORATION }) {
  const store = createClientStore();
  if (who !== null) {
    store.apply({ type: "character/online", character: {
      characterID: who.characterID, characterName: "Test", stationID: 60003760,
      structureID: null, solarSystemID: 30000142, corporationID: who.corporationID,
    }, station: null } as never);
  }
  const calls: Record<string, unknown>[] = [];
  const routes: string[] = [];
  const flow = createAppFlow(store, { livePush: false, fetch: async (input, init) => {
    const path = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    let answer: Answer = { status: 200, body: { ok: true } };
    // The two routes, which nothing is to ask: each would answer another library.
    if (path === "/api/bridge/fittings") { routes.push(path); answer = { status: 200, body: { ok: true, fittings: library([9, fitting(9, "The route's", PILOT)]) } }; }
    if (path === "/api/bridge/shared-fittings") { routes.push(path); answer = { status: 200, body: { ok: true, corp: cached(library([8, fitting(8, "The route's", CORPORATION)])), errors: {} } }; }
    if (path === "/api/names") answer = { status: 200, body: { ok: true, names: {} } };
    if (path === "/api/bridge/call" && body.method === "GetFittings") {
      calls.push(body);
      if (body.service === "charFittingMgr") answer = answers.own ?? answered("charFittingMgr", OWN);
      if (body.service === "corpFittingMgr") answer = answers.corporation ?? answered("corpFittingMgr", CORPORATIONS);
    }
    return Response.json(answer.body, { status: answer.status });
  } });
  return { flow, calls, routes };
}

// fittingSvc.py 430: GetFittingMgr(ownerID).GetFittings(ownerID), for the session's character and for its corporation, as a pilot's reads.
const THE_PILOTS = { service: "charFittingMgr", method: "GetFittings", args: [PILOT], kwargs: null, pilot: true };
const THE_CORPORATIONS = { service: "corpFittingMgr", method: "GetFittings", args: [CORPORATION], kwargs: null, pilot: true };
const listed = async (flow: { listSavedFittings(): Promise<readonly { fittingID: number; name: string; source: string }[]> }) =>
  (await flow.listSavedFittings()).map((each) => [each.fittingID, each.name, each.source]);

test("the refit library is read by the page's own call for each owner, the pilot's first, and by neither route", async () => {
  const { flow, calls, routes } = harness();
  assert.deepEqual(await listed(flow), [[1, "Miner", "personal"], [2, "Corp hauler", "corporation"]]);
  assert.deepEqual([...calls].sort((a, b) => String(a.service).localeCompare(String(b.service))), [THE_PILOTS, THE_CORPORATIONS]);
  assert.deepEqual(routes, []);
});

test("a corporation's fittings that could not be read leave the pilot's own standing; the pilot's own failing fails the library", async () => {
  // The server's word for an owner that is not the session's own (a pilot who has changed corporation since).
  const noCorporation = harness({ corporation: refused("CALL_REFUSED", 409) });
  assert.deepEqual(await listed(noCorporation.flow), [[1, "Miner", "personal"]]);
  assert.equal(noCorporation.calls.length, 2);
  const noOwn = harness({ own: refused("CALL_FAILED", 502) });
  await assert.rejects(listed(noOwn.flow));
  assert.deepEqual(noOwn.routes, []);
});

test("a pilot with no corporation known reads its own fittings alone; with no pilot online nothing is asked", async () => {
  const alone = harness({}, { characterID: PILOT, corporationID: null });
  assert.deepEqual(await listed(alone.flow), [[1, "Miner", "personal"]]);
  assert.deepEqual(alone.calls, [THE_PILOTS]);
  const nobody = harness({}, null);
  await assert.rejects(listed(nobody.flow), /There is no pilot to read the fittings of\./);
  assert.deepEqual([nobody.calls, nobody.routes], [[], []]);
});
