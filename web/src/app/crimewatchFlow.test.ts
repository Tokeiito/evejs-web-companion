// The pilot's combat timers and its ship's safety level on the page.
//
// The retail client's crimewatch service has them from the choosing of the character on, changes them at the
// server's notices of each (crimewatchSvc.py 222 to 288), and asks crimewatch again at a change of place, and in
// space at a change of system or ship (95, 119). The page reads them of the BFF at the same moments. On the game
// port the BFF answers from what the transport keeps as the client's service does.

import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";

const PILOT = 140000001;
const aSet = () => ({ type: "objectex1", header: [{ type: "token", value: "__builtin__.set" }, [{ type: "list", items: [] }]], list: [], dict: [] });
/** This server's answer for a pilot with nothing running, with the safety level given. */
const statesWith = (safetyLevel: number) => [[[100, null], [200, null], [400, null], [300, null], [500, null]], { type: "dict", entries: [] }, [aSet(), aSet()], safetyLevel];

interface PushSource {
  onmessage: ((event: { data: string }) => void) | null;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  close(): void;
}

/** A pilot online with its live channel open. `answer` is what the crimewatch read answers now. */
async function online() {
  const store = createClientStore();
  const state: { answer: unknown; fail: boolean; hold: Promise<void> | null } = { answer: { ok: true, serverNowMs: Date.now() + 5000, clientStates: statesWith(2) }, fail: false, hold: null };
  let reads = 0;
  const fetchImpl = (async (input: unknown, init?: { method?: string; body?: unknown }) => {
    const path = String(input);
    const body = init && typeof init.body === "string" ? JSON.parse(init.body) : {};
    let status = 200;
    let answer: unknown = { ok: true };
    if (path === "/api/bridge/select") {
      answer = { ok: true, character: { characterID: PILOT, characterName: "Test Pilot", stationID: 60003760, structureID: null, solarSystemID: 30000142, corporationID: 1000044 }, droneRecoveryCheckID: "check-1" };
    } else if (path === "/api/bridge/crimewatch") {
      reads += 1;
      if (state.hold) await state.hold;
      if (state.fail) {
        status = 502;
        answer = { ok: false, error: "EVE_GATEWAY_UNREACHABLE", message: "The game server is unreachable." };
      } else {
        answer = state.answer;
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
  await new Promise((resolve) => setTimeout(resolve, 25));
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
  const shown = () => store.flight.get().crimewatch;
  return { store, state, push, shown, reads: () => reads };
}

test("a pilot that comes online has crimewatch's states read, with the server's clock beside them", async () => {
  const { shown, reads } = await online();
  assert.equal(reads(), 1);
  const reading = shown();
  assert.ok(reading !== null);
  assert.deepEqual([reading.states.safetyLevel, reading.states.timers.map((timer) => timer.state)], [2, [100, 200, 400, 300, 500]]);
  // The server's clock was five seconds ahead of the browser's at the read.
  assert.ok(reading.clockOffsetMs > 4900 && reading.clockOffsetMs <= 5000, String(reading.clockOffsetMs));
});

test("the states are read again at each of the server's notices of a timer, a flag or an engagement", async () => {
  const { state, push, shown, reads } = await online();
  let expected = 1;
  for (const notice of ["OnWeaponsTimerUpdate", "OnPvpTimerUpdate", "OnNpcTimerUpdate", "OnCriminalTimerUpdate", "OnDisapprovalTimerUpdate", "OnSystemCriminalFlagUpdates",
    "OnSystemDisapprovalFlagUpdates", "OnCrimewatchEngagementCreated", "OnCrimewatchEngagementEnded", "OnCrimewatchEngagementStartTimeout", "OnCrimewatchEngagementStopTimeout"]) {
    await push(notice, [102, { type: "long", value: "134360746443100000" }]);
    expected += 1;
    assert.equal(reads(), expected, notice);
  }
  // What the read answers then is what is shown.
  state.answer = { ok: true, serverNowMs: Date.now(), clientStates: statesWith(1) };
  await push("OnWeaponsTimerUpdate", [100, null]);
  assert.equal(shown()?.states.safetyLevel, 1);
  // Another notice reads nothing.
  await push("OnSecurityStatusUpdate", [1.5]);
  await push("OnItemsChanged", [1, 2]);
  await push("OnCharNowInStation", [[140000003, 98000000, null, null]]);
  assert.equal(reads(), expected + 1);
});

test("the states are read again at a change of place, of system or of ship, and at no other change of the session", async () => {
  const { push, reads } = await online();
  await push("OnSessionChanged", [{ stationid: [60003760, null], locationid: [60003760, 30000142], solarsystemid: [null, 30000142] }]);
  assert.equal(reads(), 2);
  await push("OnSessionChanged", [{ shipid: [1, 2] }]);
  assert.equal(reads(), 3);
  await push("OnSessionChanged", [{ solarsystemid: [30000142, 30000144] }]);
  assert.equal(reads(), 4);
  // A dict as the wire spells one.
  await push("OnSessionChanged", [{ type: "dict", entries: [["locationid", [30000144, 60003760]]] }]);
  assert.equal(reads(), 5);
  await push("OnSessionChanged", [{ corpid: [1000044, 98000000], corprole: [0, 1] }]);
  await push("OnSessionChanged", [{}]);
  assert.equal(reads(), 5);
});

test("a read that fails, or that says no states, leaves what was shown", async () => {
  const { state, push, shown, reads } = await online();
  const first = shown();
  state.fail = true;
  await push("OnWeaponsTimerUpdate", [100, null]);
  assert.deepEqual([shown(), reads()], [first, 2]);
  state.fail = false;
  for (const answer of [{ ok: true }, { ok: true, serverNowMs: Date.now(), clientStates: null }, { ok: true, serverNowMs: "now", clientStates: statesWith(0) }, { ok: true, clientStates: statesWith(0) }]) {
    state.answer = answer;
    await push("OnWeaponsTimerUpdate", [100, null]);
    assert.deepEqual(shown(), first, JSON.stringify(answer).slice(0, 60));
  }
});

test("a read that answers after the pilot has gone offline is not shown", async () => {
  const { store, state, push, shown, reads } = await online();
  let release: () => void = () => {};
  state.hold = new Promise<void>((resolve) => { release = resolve; });
  state.answer = { ok: true, serverNowMs: Date.now(), clientStates: statesWith(0) };
  await push("OnWeaponsTimerUpdate", [100, null]);
  assert.equal(reads(), 2);
  store.apply({ type: "character/offline" } as never);
  assert.equal(shown(), null);
  release();
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(shown(), null);
});
