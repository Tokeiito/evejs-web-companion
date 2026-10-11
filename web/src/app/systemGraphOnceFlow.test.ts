import test from "node:test";
import assert from "node:assert/strict";
import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";

// The map's graph is one for everybody, and 745,066 bytes an asking (measured 2026-10-11). Each flow read and kept
// one of its own: a tab with two pilots read it twice, a BFF with ten hosted bots ten times. It is kept by what a
// flow asks with (nav/systemGraphKept.ts): the flows of a page ask with the page's one fetch, and read it once
// between them. A flow handed a fetch of its own, as a test's is and a hosted bot's, keeps its own.

const JITA = 30000142;
const PERIMETER = 30000144;
const MAURASI = 30000140;
/** A map of three systems, Jita gated to the other two, with these names. */
const mapOf = (names: Record<number, string>) => ({
  ok: true,
  systems: names,
  security: {},
  edges: [[JITA, PERIMETER, 501, 502], [PERIMETER, JITA, 502, 501], [JITA, MAURASI, 503, 504], [MAURASI, JITA, 504, 503]],
});
const NAMED = mapOf({ [JITA]: "Jita", [PERIMETER]: "Perimeter", [MAURASI]: "Maurasi" });

/** A fetch that answers the map with `map`, or fails it while `failing()`, and counts its askings of it. */
function fetchOf(map: unknown, failing: () => boolean = () => false) {
  let graphs = 0;
  const fetch = async (input: RequestInfo | URL): Promise<Response> => {
    if (String(input) !== "/api/map/graph") return Response.json({ ok: true });
    graphs += 1;
    return failing() ? Response.json({ ok: false, error: "STATIC_DATA_UNAVAILABLE", message: "No map." }, { status: 503 }) : Response.json(map);
  };
  return { fetch: fetch as typeof globalThis.fetch, graphs: () => graphs };
}
const flowWith = (fetch: typeof globalThis.fetch) => createAppFlow(createClientStore(), { livePush: false, fetch });
/** The systems a flow says Jita's gates lead to, by their names: what it made of the map it read. */
const fromJita = async (flow: ReturnType<typeof flowWith>): Promise<(string | null)[]> =>
  (await flow.nearbyGates(JITA)).map((gate) => gate.toSystemName ?? null).sort();

test("two flows that ask with one fetch read the map's graph once between them, and each has it", async () => {
  const page = fetchOf(NAMED);
  const first = flowWith(page.fetch);
  const second = flowWith(page.fetch);
  assert.deepEqual(await fromJita(first), ["Maurasi", "Perimeter"]);
  assert.equal(page.graphs(), 1);
  assert.deepEqual(await fromJita(second), ["Maurasi", "Perimeter"]);
  assert.deepEqual(await fromJita(first), ["Maurasi", "Perimeter"]);
  assert.equal(page.graphs(), 1, "the second flow asks nothing: the first has read it for the page");
  // And a third, made after: the same.
  assert.deepEqual(await fromJita(flowWith(page.fetch)), ["Maurasi", "Perimeter"]);
  assert.equal(page.graphs(), 1);
});

test("flows that ask at one time, with one fetch, wait for the one read", async () => {
  const page = fetchOf(NAMED);
  const flows = [flowWith(page.fetch), flowWith(page.fetch), flowWith(page.fetch)];
  const answers = await Promise.all(flows.flatMap((flow) => [fromJita(flow), fromJita(flow)]));
  assert.deepEqual(answers, Array.from({ length: 6 }, () => ["Maurasi", "Perimeter"]));
  assert.equal(page.graphs(), 1);
});

test("a flow with a fetch of its own reads the map itself: what one page's flows keep is none of another's", async () => {
  const one = fetchOf(NAMED);
  const other = fetchOf(mapOf({ [JITA]: "Jita", [PERIMETER]: "Elsewhere", [MAURASI]: "Otherwhere" }));
  assert.deepEqual(await fromJita(flowWith(one.fetch)), ["Maurasi", "Perimeter"]);
  assert.deepEqual(await fromJita(flowWith(other.fetch)), ["Elsewhere", "Otherwhere"]);
  assert.deepEqual([one.graphs(), other.graphs()], [1, 1]);
});

test("a read of the map that fails is not kept: the next to ask reads again, whichever flow it is", async () => {
  let down = true;
  const page = fetchOf(NAMED, () => down);
  const first = flowWith(page.fetch);
  const second = flowWith(page.fetch);
  await assert.rejects(first.nearbyGates(JITA));
  await assert.rejects(second.nearbyGates(JITA));
  assert.equal(page.graphs(), 2);
  down = false;
  assert.deepEqual(await fromJita(second), ["Maurasi", "Perimeter"]);
  assert.deepEqual(await fromJita(first), ["Maurasi", "Perimeter"]);
  assert.equal(page.graphs(), 3, "read once more, by the first to ask, and kept for both");
});
