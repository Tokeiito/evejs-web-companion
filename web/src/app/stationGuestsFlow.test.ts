// Who is docked in the station, kept up to date on the page.
//
// The retail client's station service changes its own list of guests at each of the server's two notices
// (station/base.py: OnCharNowInStation, OnCharNoLongerInStation). The page takes each as word that the list
// changed and reads it again; on the game port the BFF answers that read from the list it keeps as the client
// does, so nothing more is asked of the server.

import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";

const PILOT = 140000001;

interface PushSource {
  onmessage: ((event: { data: string }) => void) | null;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  close(): void;
}

/** A docked pilot online with its live channel open. `guests` is what the station's guests read answers now. */
async function docked() {
  const store = createClientStore();
  const state = { guests: [[PILOT, 1000044, 0, 0]] as number[][], fail: false };
  const asked: string[] = [];
  const fetchImpl = (async (input: unknown, init?: { method?: string; body?: unknown }) => {
    const path = String(input);
    const body = init && typeof init.body === "string" ? JSON.parse(init.body) : {};
    let status = 200;
    let answer: unknown = { ok: true };
    if (path === "/api/bridge/select") {
      answer = { ok: true, character: { characterID: PILOT, characterName: "Test Pilot", stationID: 60003760, structureID: null, solarSystemID: 30000142, corporationID: 1000044 }, station: null, notifications: [] };
    } else if (path === "/api/bridge/call") {
      asked.push(`${body.service}.${body.method}`);
      if (body.service === "station" && body.method === "GetGuests" && state.fail) {
        status = 502;
        answer = { ok: false, error: "EVE_GATEWAY_UNREACHABLE", message: "The game server is unreachable." };
      } else {
        const result = body.service === "station" && body.method === "GetGuests" ? { type: "list", items: state.guests } : null;
        answer = { ok: true, service: body.service, method: body.method, result, notifications: [] };
      }
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
  const guestIDs = () => store.station.get().guests.map((guest) => guest.characterID);
  const guestReads = () => asked.filter((call) => call === "station.GetGuests").length;
  return { store, state, push, guestIDs, guestReads };
}

test("told that a pilot has docked or left, the page reads the station's guests again and shows who is there", async () => {
  const { state, push, guestIDs, guestReads } = await docked();
  assert.deepEqual([guestIDs(), guestReads()], [[PILOT], 1]);
  state.guests = [[PILOT, 1000044, 0, 0], [140000003, 98000000, 99000000, 0]];
  await push("OnCharNowInStation", [[140000003, 98000000, 99000000, 0]]);
  assert.deepEqual([guestIDs(), guestReads()], [[PILOT, 140000003], 2]);
  state.guests = [[PILOT, 1000044, 0, 0]];
  await push("OnCharNoLongerInStation", [[140000003, 98000000, 99000000, 0]]);
  assert.deepEqual([guestIDs(), guestReads()], [[PILOT], 3]);
});

test("another notice reads nothing of the station, and a read that fails leaves the guests as they were shown", async () => {
  const { state, push, guestIDs, guestReads } = await docked();
  await push("OnCharNowInSpace", [[140000003, 98000000, 99000000, 0]]);
  await push("OnItemsChanged", [1, 2]);
  assert.equal(guestReads(), 1);
  state.fail = true;
  await push("OnCharNowInStation", [[140000003, 98000000, 99000000, 0]]);
  assert.deepEqual([guestIDs(), guestReads()], [[PILOT], 2]);
});
