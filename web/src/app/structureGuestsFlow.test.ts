// A structure's guests on the page.
//
// The retail client's lobby asks for the guests of the structure it is docked in as it comes up, of its structure
// guests service (dockedUI/guests.py 98 to 101; services/structure/structureGuests.py 25), and that service works
// each pilot who enters or leaves into what it keeps (36, 40). The page reads them as its Station panel is
// refreshed in a structure, and again at each of the two notices: the pilot's transport answers from what it
// keeps, changed as the notice said (src/gamePort/pilotStructureGuests.js).
//
// Through the web gateway the call is not carried: its list has a station's guests and nothing of a structure's.
// Then there are none to show, nothing is said of it, and nothing is asked again.

import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";

const PILOT = 140000003;
const CORPORATION = 98000001;
const STATION = 60003760;
const A_STRUCTURE = 1030000000001;

interface PushSource {
  onmessage: ((event: { data: string }) => void) | null;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  close(): void;
}

/** A dict off the wire, as the BFF hands one on. */
const dict = (...entries: ReadonlyArray<readonly [number, readonly unknown[]]>) => ({ type: "dict", entries });
const guest = (characterID: number, corporationID: number | null = 1000044, allianceID: number | null = null, warFactionID: number | null = null) => ({ characterID, corporationID, allianceID, warFactionID });

/**
 * A pilot online, docked in the structure (or in the station, with `structureID` null), its live channel open.
 * `answer` is what the structure's guests are answered now; `refusal` refuses the call instead; `hold` keeps an
 * answer back until it is let go.
 */
async function docked(structureID: number | null = A_STRUCTURE, first: { answer?: unknown; refusal?: { status: number; error: string; message: string } | null } = {}) {
  const store = createClientStore();
  const state: { answer: unknown; refusal: { status: number; error: string; message: string } | null; hold: Promise<void> | null; services: unknown | null } = {
    answer: first.answer ?? dict([PILOT, [CORPORATION, null, null]]),
    refusal: first.refusal ?? null,
    hold: null,
    // Null: the services of the structure asked of. Anything else is answered as it is.
    services: null,
  };
  const asked: Array<[string, string, unknown]> = [];
  const fetchImpl = (async (input: unknown, init?: { method?: string; body?: unknown }) => {
    const path = String(input);
    const body = init && typeof init.body === "string" ? JSON.parse(init.body) : {};
    let status = 200;
    let answer: unknown = { ok: true };
    if (path === "/api/bridge/select") {
      answer = { ok: true, character: { characterID: PILOT, characterName: "Test Three", stationID: structureID === null ? STATION : null, structureID, solarSystemID: 30000142, corporationID: CORPORATION }, droneRecoveryCheckID: "check-1" };
    } else if (path.startsWith("/api/dockable-structures/") && path.endsWith("/services")) {
      answer = state.services ?? { ok: true, structureID: Number(path.split("/")[3]), serviceIDs: [1, 2, 3] };
    } else if (path === "/api/bridge/call" && (body.service === "structureGuests" || (body.service === "station" && body.method === "GetGuests"))) {
      asked.push([body.service, body.method, body.args]);
      const answered = state.answer;
      const refusal = state.refusal;
      if (state.hold) await state.hold;
      if (refusal) {
        status = refusal.status;
        answer = { ok: false, error: refusal.error, message: refusal.message };
      } else {
        answer = { ok: true, service: body.service, method: body.method, result: body.service === "station" ? { type: "list", items: [[PILOT, CORPORATION, null, null]] } : answered, notifications: [] };
      }
    } else if (path === "/api/bridge/call") {
      answer = { ok: true, service: body.service, method: body.method, result: null, notifications: [] };
    }
    return { ok: status >= 200 && status < 300, status, async json() { return answer; } };
  }) as unknown as typeof fetch;
  const sources: PushSource[] = [];
  const eventSource = (): PushSource => {
    const source: PushSource = { onmessage: null, onopen: null, onerror: null, close() {} };
    sources.push(source);
    return source;
  };
  const flow = createAppFlow(store, { fetch: fetchImpl, eventSource });
  await flow.selectCharacter(PILOT);
  const source = sources[0];
  assert.ok(source, "coming online opens the live channel");
  source.onopen?.();
  let sequence = 0;
  /** The server pushes a notification, and what it sets going is given time to finish. */
  const push = async (method: string, args: readonly unknown[]) => {
    sequence += 1;
    source.onmessage?.({ data: JSON.stringify({
      source: "evejs-web-gateway", apiVersion: 1, type: "event", cursor: { epoch: "epoch-1", sequence },
      event: { kind: "notification", notification: { kind: "client", service: null, method, args, kwargs: null } },
    }) });
    await new Promise((resolve) => setTimeout(resolve, 25));
  };
  const shown = () => store.station.get().guests;
  /** The askings of a structure's guests, each by what it was asked with. */
  const ofAStructure = () => asked.filter(([service]) => service === "structureGuests").map(([, method, args]) => [method, args]);
  return { store, flow, state, push, shown, asked, ofAStructure };
}

const NOT_CARRIED = { status: 403, error: "CALL_NOT_ALLOWED", message: "structureGuests.GetGuests is not on the web-call allowlist." };

test("docked in a structure its guests are read as the pilot comes online, by the structure, and again when the panel is refreshed", async () => {
  const { store, flow, state, shown, asked, ofAStructure } = await docked(A_STRUCTURE, { answer: dict([PILOT, [CORPORATION, null, null]], [140000001, [1000044, 99000001, 500001]]) });
  // structureGuests.py 25: GetGuests(session.structureid). A station's guests are not asked for in a structure.
  assert.deepEqual(asked, [["structureGuests", "GetGuests", [A_STRUCTURE]]]);
  assert.deepEqual(shown(), [guest(PILOT, CORPORATION), guest(140000001, 1000044, 99000001, 500001)]);
  // The structure's services were read beside them, and nothing is said to be unreadable.
  assert.deepEqual([store.station.get().structureServiceIDs, store.station.get().readError], [[1, 2, 3], null]);
  state.answer = dict([PILOT, [CORPORATION, null, null]]);
  await flow.refreshStationPanel();
  assert.deepEqual([shown(), ofAStructure().length], [[guest(PILOT, CORPORATION)], 2]);
});

test("in a station the station's guests are read as before, and no structure's", async () => {
  const { shown, asked } = await docked(null);
  assert.deepEqual(asked, [["station", "GetGuests", []]]);
  assert.deepEqual(shown(), [guest(PILOT, CORPORATION)]);
});

test("the server's word of a pilot who entered the structure or left it reads its guests again", async () => {
  const { state, push, shown, ofAStructure } = await docked();
  assert.equal(ofAStructure().length, 1);
  // structureGuests.py 36: OnCharacterEnteredStructure(characterID, corporationID, allianceID, factionID).
  state.answer = dict([PILOT, [CORPORATION, null, null]], [140000001, [1000044, null, null]]);
  await push("OnCharacterEnteredStructure", [140000001, 1000044, null, null]);
  assert.deepEqual([shown(), ofAStructure()], [[guest(PILOT, CORPORATION), guest(140000001)], [["GetGuests", [A_STRUCTURE]], ["GetGuests", [A_STRUCTURE]]]]);
  // structureGuests.py 40: OnCharacterLeftStructure(characterID).
  state.answer = dict([PILOT, [CORPORATION, null, null]]);
  await push("OnCharacterLeftStructure", [140000001]);
  assert.deepEqual([shown(), ofAStructure().length], [[guest(PILOT, CORPORATION)], 3]);
  // Another notice reads nothing.
  await push("OnCharacterSomethingElse", [140000001]);
  await push("OnOfficeRentalChange", [CORPORATION, { type: "long", value: "1054657764826" }]);
  assert.equal(ofAStructure().length, 3);
  // A connection that carries them no more leaves what was shown.
  state.refusal = NOT_CARRIED;
  await push("OnCharacterEnteredStructure", [140000001, 1000044, null, null]);
  assert.deepEqual([shown(), ofAStructure().length], [[guest(PILOT, CORPORATION)], 4]);
});

test("through a connection that does not carry a structure's guests there are none, nothing is said of it, and a notice asks nothing", async () => {
  const { store, flow, push, shown, ofAStructure } = await docked(A_STRUCTURE, { refusal: NOT_CARRIED });
  assert.deepEqual([shown(), ofAStructure().length, store.station.get().readError, store.station.get().structureServiceIDs], [[], 1, null, [1, 2, 3]]);
  // Never read, the guests are not read at a notice: the client's own service is not there to keep them.
  await push("OnCharacterEnteredStructure", [140000001, 1000044, null, null]);
  await push("OnCharacterLeftStructure", [140000001]);
  assert.equal(ofAStructure().length, 1);
  // The player's own refresh asks, and is answered the same.
  await flow.refreshStationPanel();
  assert.deepEqual([shown(), ofAStructure().length, store.station.get().readError], [[], 2, null]);
});

test("a read of the guests that fails says so, leaves the services and the guests shown, and a later one that answers takes the words away", async () => {
  const { store, flow, state, shown } = await docked();
  const first = shown();
  state.refusal = { status: 502, error: "EVE_GATEWAY_UNREACHABLE", message: "The game server is unreachable." };
  await flow.refreshStationPanel();
  assert.deepEqual([shown(), store.station.get().structureServiceIDs], [first, [1, 2, 3]]);
  assert.match(store.station.get().readError ?? "", /^GetGuests: /);
  state.refusal = null;
  await flow.refreshStationPanel();
  assert.equal(store.station.get().readError, null);
  // Where the services cannot be read either, theirs is what is said.
  state.refusal = { status: 502, error: "EVE_GATEWAY_UNREACHABLE", message: "The game server is unreachable." };
  state.services = { ok: true };
  await flow.refreshStationPanel();
  assert.match(store.station.get().readError ?? "", /^Structure services are unreadable: /);
});

test("guests that are answered after the pilot has gone elsewhere are not shown, at a refresh or at a notice", async () => {
  const { store, flow, state, push, shown } = await docked();
  let release: () => void = () => {};
  state.hold = new Promise<void>((resolve) => { release = resolve; });
  state.answer = dict([PILOT, [CORPORATION, null, null]], [140000001, [1000044, null, null]]);
  const asking = flow.refreshStationPanel();
  await new Promise((resolve) => setTimeout(resolve, 5));
  store.apply({ type: "station/relocated", stationID: null, structureID: A_STRUCTURE + 1, solarSystemID: 30002780, station: null } as never);
  assert.deepEqual(shown(), []);
  release();
  await asking;
  assert.deepEqual(shown(), []);
  // And at a notice: the answer on its way is the old structure's.
  store.apply({ type: "station/guests", guests: [guest(PILOT, CORPORATION)] } as never);
  state.hold = new Promise<void>((resolve) => { release = resolve; });
  const noticed = push("OnCharacterEnteredStructure", [140000001, 1000044, null, null]);
  await new Promise((resolve) => setTimeout(resolve, 5));
  store.apply({ type: "station/relocated", stationID: null, structureID: A_STRUCTURE + 2, solarSystemID: 30002780, station: null } as never);
  release();
  await noticed;
  assert.deepEqual(shown(), []);
  // A read that fails after the pilot has gone elsewhere says nothing of where the pilot is now.
  state.hold = new Promise<void>((resolve) => { release = resolve; });
  state.refusal = { status: 502, error: "EVE_GATEWAY_UNREACHABLE", message: "The game server is unreachable." };
  const failing = flow.refreshStationPanel();
  await new Promise((resolve) => setTimeout(resolve, 5));
  store.apply({ type: "station/relocated", stationID: null, structureID: A_STRUCTURE + 3, solarSystemID: 30002780, station: null } as never);
  release();
  await failing;
  assert.equal(store.station.get().readError, null);
});

test("a pilot whose session is gone as its guests are read is taken offline, as at any read of the panel's", async () => {
  const { store, flow, state } = await docked();
  assert.notEqual(store.station.get().online, null);
  state.refusal = { status: 404, error: "SESSION_NOT_FOUND", message: "The pilot's session is gone." };
  await assert.rejects(flow.refreshStationPanel(), /session is gone/);
  assert.equal(store.station.get().online, null);
});
