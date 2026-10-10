// The lobby's offices on the page.
//
// The retail client's lobby lists the corporations with an office in the station, and how many offices are free,
// when its Offices tab is shown, and lists them again at each office rented or given up, whoever's it is
// (dockedUI/offices.py: LoadPanel, OnOfficeRentalChanged). The page lists them when the player asks, and from then
// on at each notice. Before the player has asked, a notice lists nothing: the client's panel is not loaded either.

import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";

const PILOT = 140000003;
const CORPORATION = 98000001;
const STATION = 60003760;

interface PushSource {
  onmessage: ((event: { data: string }) => void) | null;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  close(): void;
}

/** A docked pilot online with its live channel open. `answer` is what the offices read answers now; `hold` keeps an answer back until it is let go. */
async function docked() {
  const store = createClientStore();
  const state: { answer: unknown; fail: boolean; hold: Promise<void> | null } = {
    answer: { ok: true, available: true, stationID: STATION, corporationIDs: [98000000, 98000003], freeOffices: 17 },
    fail: false,
    hold: null,
  };
  let reads = 0;
  const fetchImpl = (async (input: unknown, init?: { method?: string; body?: unknown }) => {
    const path = String(input);
    const body = init && typeof init.body === "string" ? JSON.parse(init.body) : {};
    let status = 200;
    let answer: unknown = { ok: true };
    if (path === "/api/bridge/select") {
      answer = { ok: true, character: { characterID: PILOT, characterName: "Test Three", stationID: STATION, structureID: null, solarSystemID: 30000142, corporationID: CORPORATION }, droneRecoveryCheckID: "check-1" };
    } else if (path === "/api/bridge/station/offices") {
      reads += 1;
      const answered = state.answer;
      if (state.hold) await state.hold;
      if (state.fail) {
        status = 502;
        answer = { ok: false, error: "EVE_GATEWAY_UNREACHABLE", message: "The game server is unreachable." };
      } else {
        answer = answered;
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
  /** The server pushes several notifications at once, as it does where one thing is told to two audiences. */
  const pushTogether = async (...notices: ReadonlyArray<readonly [string, readonly unknown[]]>) => {
    for (const [method, args] of notices) {
      sequence += 1;
      source.onmessage?.({ data: JSON.stringify({
        source: "evejs-web-gateway", apiVersion: 1, type: "event", cursor: { epoch: "epoch-1", sequence },
        event: { kind: "notification", notification: { kind: "client", service: null, method, args, kwargs: null } },
      }) });
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  };
  const shown = () => store.station.get().offices;
  return { store, flow, state, push, pushTogether, shown, reads: () => reads };
}

const OFFICE = { type: "long", value: "1054657764826" };

test("the lobby's offices are listed when the player asks, and again at each office rented or given up there", async () => {
  const { flow, state, push, shown, reads } = await docked();
  // Not asked for yet: nothing is shown, and a notice lists nothing.
  await push("OnOfficeRentalChange", [CORPORATION, OFFICE]);
  assert.deepEqual([shown(), reads()], [null, 0]);
  await flow.loadStationOffices();
  assert.deepEqual([shown(), reads()], [{ available: true, corporationIDs: [98000000, 98000003], freeOffices: 17 }, 1]);
  // Another corporation rents an office here: the lobby lists them again, whoever's the office is.
  state.answer = { ok: true, available: true, stationID: STATION, corporationIDs: [98000000, 98000003, 98000005], freeOffices: 16 };
  await push("OnOfficeRentalChange", [98000005, OFFICE]);
  assert.deepEqual([shown(), reads()], [{ available: true, corporationIDs: [98000000, 98000003, 98000005], freeOffices: 16 }, 2]);
  // And the pilot's own gives one up.
  state.answer = { ok: true, available: true, stationID: STATION, corporationIDs: [98000003, 98000005], freeOffices: 17 };
  await push("OnOfficeRentalChange", [CORPORATION, OFFICE]);
  assert.deepEqual([shown(), reads()], [{ available: true, corporationIDs: [98000003, 98000005], freeOffices: 17 }, 3]);
  // Another notice lists nothing.
  await push("OnOfficeSomethingElse", [CORPORATION, OFFICE]);
  await push("OnCharNowInStation", [[140000001, 1000044, null, null]]);
  assert.equal(reads(), 3);
});

test("what the read answers is taken for what it says and no more", async () => {
  const { flow, state, shown } = await docked();
  // A pilot whose transport does not carry the read.
  state.answer = { ok: true, available: false, stationID: STATION, corporationIDs: [], freeOffices: null };
  await flow.loadStationOffices();
  assert.deepEqual(shown(), { available: false, corporationIDs: [], freeOffices: null });
  // What is no corporation is left out, and a count that is no whole number is no count.
  state.answer = { ok: true, available: true, stationID: STATION, corporationIDs: [98000003, "x", null, 0, -2, 2.5, 98000000], freeOffices: "many" };
  await flow.loadStationOffices();
  assert.deepEqual(shown(), { available: true, corporationIDs: [98000003, 98000000], freeOffices: null });
  for (const [freeOffices, expected] of [[0, 0], [-1, null], [1.5, null], [undefined, null]] as const) {
    state.answer = { ok: true, available: true, stationID: STATION, corporationIDs: "none", freeOffices };
    await flow.loadStationOffices();
    assert.deepEqual(shown(), { available: true, corporationIDs: [], freeOffices: expected }, String(freeOffices));
  }
});

test("a read that fails leaves what was shown, and one that answers after the pilot has gone elsewhere is not shown", async () => {
  const { store, flow, state, push, shown, reads } = await docked();
  await flow.loadStationOffices();
  const first = shown();
  // The player's own asking says why it failed; a notice's asking fails quietly. Either way what was shown stays.
  state.fail = true;
  await assert.rejects(flow.loadStationOffices());
  await push("OnOfficeRentalChange", [CORPORATION, OFFICE]);
  assert.deepEqual([shown(), reads()], [first, 3]);
  // An answer on its way while the pilot docks somewhere else is the old station's.
  state.fail = false;
  let release: () => void = () => {};
  state.hold = new Promise<void>((resolve) => { release = resolve; });
  const asking = flow.loadStationOffices();
  await new Promise((resolve) => setTimeout(resolve, 5));
  store.apply({ type: "station/relocated", stationID: 60000004, structureID: null, solarSystemID: 30002780, station: null } as never);
  // Another station: its offices are not listed yet.
  assert.equal(shown(), null);
  release();
  await asking;
  assert.equal(shown(), null);
});

test("told twice of one office, of the station and of the corporation, the page lists the offices once", async () => {
  // Tranquility's recordings of an office rented and of one given up have the notice twice, and the lobby's two
  // reads once: the client's panel does not load again while it is loading (offices.py, _load).
  const { flow, state, pushTogether, push, shown, reads } = await docked();
  await flow.loadStationOffices();
  state.answer = { ok: true, available: true, stationID: STATION, corporationIDs: [98000003], freeOffices: 18 };
  await pushTogether(["OnOfficeRentalChange", [98000000, OFFICE]], ["OnOfficeRentalChange", [98000000, OFFICE]]);
  assert.deepEqual([shown(), reads()], [{ available: true, corporationIDs: [98000003], freeOffices: 18 }, 2]);
  // Once that listing is done, the next notice lists again.
  await push("OnOfficeRentalChange", [98000000, OFFICE]);
  assert.equal(reads(), 3);
  // And after a listing that failed.
  state.fail = true;
  await pushTogether(["OnOfficeRentalChange", [98000000, OFFICE]], ["OnOfficeRentalChange", [98000000, OFFICE]]);
  state.fail = false;
  await push("OnOfficeRentalChange", [98000000, OFFICE]);
  assert.equal(reads(), 5);
});
