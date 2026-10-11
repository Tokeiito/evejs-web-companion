// An approach and a keep at range from the page, through the real flow over a faked BFF.
//
// Each is the client's own call (bridge/movementWrites.ts): beyonce's CmdFollowBall with the thing and a range, as
// a pilot's write the page means, and never the routes they went by until 2026-10-11. The routes read the pilot's
// flight before the order, to refuse a pilot that is docked, and after it, for the panel to show. The page reads
// both itself. What the routes kept of their own (an order held back where the ship already flies it, the
// throttle opened first through the gateway) is the BFF's still, and is not seen from here.

import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";
import { flightBody, SHIP_ID, SOLAR_SYSTEM_ID } from "./botFixtures.ts";

const THING = 40009089;
const STATUS = "/api/bridge/flight/status";
const follow = (range: number) => ({ service: "beyonce", method: "CmdFollowBall", args: [THING, range], kwargs: null, pilot: true, confirm: true });

type Answer = { readonly status: number; readonly body: unknown };
/** The pilot's flight in space, its ship flying as said. */
const flying = (shipMode: string): Answer => {
  const body = flightBody(false) as { flight: Record<string, unknown> };
  return { status: 200, body: { ...body, flight: { ...body.flight, shipMode } } };
};

/**
 * A flow for a pilot online, over a BFF that answers each reading of the pilot's flight with the next of
 * `flights` (and every one after them with the last), and a call of beyonce's as taken unless `refusal` says not.
 */
function harness(flights: readonly Answer[], refusal: string | null = null) {
  const store = createClientStore();
  store.apply({ type: "character/online", character: {
    characterID: 140000005, characterName: "Test", stationID: null,
    structureID: null, solarSystemID: SOLAR_SYSTEM_ID, corporationID: 98000000,
  }, station: null });
  const asked: { readonly path: string; readonly body: unknown }[] = [];
  let read = 0;
  const flow = createAppFlow(store, { livePush: false, perSessionToken: true, initialSessionToken: "pilot", fetch: async (input, init) => {
    const path = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    asked.push({ path, body });
    if (path === STATUS) {
      const answer = flights[Math.min(read, flights.length - 1)];
      if (answer === undefined) throw new Error("the stand-in has no flight to answer with");
      read += 1;
      return Response.json(answer.body, { status: answer.status });
    }
    if (path === "/api/bridge/call" && body.service === "beyonce" && refusal !== null) return Response.json({ ok: false, error: "CALL_REFUSED", message: refusal }, { status: 409 });
    if (path === "/api/bridge/call") return Response.json({ ok: true, service: body.service, method: body.method, result: null, notifications: [] });
    return Response.json({ ok: true });
  } });
  /** The readings of the flight and the orders to the ship, in the order they were asked. */
  const steps = () => asked.filter((each) => each.path.startsWith("/api/bridge/flight/") ||
    (each.path === "/api/bridge/call" && (each.body as { service?: string }).service === "beyonce"));
  const panel = () => {
    const flight = store.flight.get();
    return [flight.lastAction, flight.actionError, flight.status?.shipMode ?? null];
  };
  return { flow, store, asked, steps, panel };
}

test("the panel's Approach is the page's own follow at the client's fifty metres, between two readings of the pilot's flight", async () => {
  const { flow, steps, panel } = harness([flying("STOP"), flying("FOLLOW")]);

  await flow.approach(THING);

  assert.deepEqual(steps(), [{ path: STATUS, body: null }, { path: "/api/bridge/call", body: follow(50) }, { path: STATUS, body: null }]);
  assert.deepEqual(panel(), ["Approach", null, "FOLLOW"]);
});

test("an approach told where to stop follows at that range", async () => {
  const { flow, steps } = harness([flying("STOP")]);

  await flow.approach(THING, 2500);

  assert.deepEqual(steps().filter((each) => each.path === "/api/bridge/call").map((each) => each.body), [follow(2500)]);
});

test("the panel's Keep at range is the page's own follow: at the range said, at a thousand metres where none is, and never nearer than fifty", async () => {
  for (const [range, sent] of [[5000, 5000], [undefined, 1000], [null, 1000], [10, 50]] as const) {
    const { flow, steps, panel } = harness([flying("STOP"), flying("FOLLOW")]);

    await (range === undefined ? flow.keepAtRange(THING) : flow.keepAtRange(THING, range));

    assert.deepEqual(steps(), [{ path: STATUS, body: null }, { path: "/api/bridge/call", body: follow(sent) }, { path: STATUS, body: null }], String(range));
    assert.deepEqual(panel(), ["Keep at range", null, "FOLLOW"], String(range));
  }
});

test("neither route is asked", async () => {
  const { flow, asked } = harness([flying("STOP")]);

  await flow.approach(THING);
  await flow.keepAtRange(THING, 5000);

  assert.deepEqual(asked.filter((each) => each.path === "/api/bridge/flight/approach" || each.path === "/api/bridge/flight/keep-at-range"), []);
});

test("docked, nothing is sent, and the panel says why", async () => {
  for (const [order, label] of [[(flow: ReturnType<typeof harness>["flow"]) => flow.approach(THING), "Approach"], [(flow: ReturnType<typeof harness>["flow"]) => flow.keepAtRange(THING, 5000), "Keep at range"]] as const) {
    const { flow, steps, panel } = harness([{ status: 200, body: flightBody(true) }]);

    await order(flow);

    assert.deepEqual(steps().map((each) => each.path), [STATUS, STATUS], label);
    assert.deepEqual(panel(), [null, `${label} refused: The ship is not in space; undock first.`, null], label);
  }
});

test("the pilot's own ship, what is no thing and what is no distance are ordered by no call, and the panel says which", async () => {
  const cases: readonly [(flow: ReturnType<typeof harness>["flow"]) => Promise<void>, string][] = [
    [(flow) => flow.approach(SHIP_ID), "Approach refused: A ship cannot approach itself."],
    [(flow) => flow.keepAtRange(SHIP_ID, 5000), "Keep at range refused: A ship cannot keep at range of itself."],
    [(flow) => flow.approach(0), "Approach refused: That target could not be identified."],
    [(flow) => flow.keepAtRange(0, 5000), "Keep at range refused: That target could not be identified."],
    [(flow) => flow.approach(THING, -5), "Approach refused: The approach range must be a distance in metres."],
    [(flow) => flow.keepAtRange(THING, Number.NaN), "Keep at range refused: The range to hold must be a distance in metres."],
  ];
  for (const [order, words] of cases) {
    const { flow, steps, panel } = harness([flying("STOP")]);

    await order(flow);

    assert.equal(steps().some((each) => each.path === "/api/bridge/call"), false, words);
    assert.deepEqual(panel(), [null, words, "STOP"], words);
  }
});

test("a follow the call refuses is shown as refused, in the refusal's own words, and the flight is read again", async () => {
  const { flow, steps, panel } = harness([flying("STOP"), flying("WARP")], "The pilot has no ballpark to ask: it is not in space.");

  await flow.keepAtRange(THING, 5000);

  assert.deepEqual(steps().map((each) => each.path), [STATUS, "/api/bridge/call", STATUS]);
  assert.deepEqual(panel(), [null, "Keep at range refused: The pilot has no ballpark to ask: it is not in space.", "WARP"]);
});
