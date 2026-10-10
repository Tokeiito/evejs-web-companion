// The corporation's hangar on the page, kept up with the corporation's offices.
//
// The retail client's office manager lets its list of the corporation's offices go when the server says the
// session's corporation rented an office or gave one up (officeManager.py: OnOfficeRentalChange), and its
// inventory window then draws its tree again (invWindow.py: OnOfficeRentalChanged, where the corporation is the
// session's). The page takes the notice the same way: where it has the corporation's hangar open, it reads it
// again. On the game port the BFF's read of the offices behind it was let go by the same notice.

import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";

const PILOT = 140000003;
const CORPORATION = 98000001;

interface PushSource {
  onmessage: ((event: { data: string }) => void) | null;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  close(): void;
}

/** A docked pilot of a player's corporation, online with its live channel open. `office` is whether the corporation has an office here now. */
async function docked() {
  const store = createClientStore();
  const state = { office: false };
  const asked: string[] = [];
  const fetchImpl = (async (input: unknown, init?: { method?: string; body?: unknown }) => {
    const path = String(input);
    const body = init && typeof init.body === "string" ? JSON.parse(init.body) : {};
    let answer: unknown = { ok: true };
    if (path === "/api/bridge/select") {
      answer = { ok: true, character: { characterID: PILOT, characterName: "Test Three", stationID: 60003760, structureID: null, solarSystemID: 30000142, corporationID: CORPORATION }, droneRecoveryCheckID: "check-1" };
    } else if (path === "/api/bridge/inventory/corp") {
      asked.push(path);
      answer = state.office
        ? { ok: true, available: true, stationID: 60003760, divisions: [{ division: 1, name: "Division 1", list: { type: "list", items: [] }, volumes: {}, error: null }] }
        : { ok: true, available: false, stationID: 60003760, reason: "NO_CORP_OFFICE", divisions: [] };
    } else if (path === "/api/bridge/call") {
      answer = { ok: true, service: body.service, method: body.method, result: null, notifications: [] };
    }
    return { ok: true, status: 200, async json() { return answer; } };
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
  const hangar = () => {
    const corp = store.get().inventory.corp;
    return [corp.loaded, corp.available, corp.divisions.length];
  };
  return { flow, state, push, hangar, reads: () => asked.length };
}

/** An office's ID as the BFF hands a big number on. */
const OFFICE = { type: "long", value: "1054657764826" };

test("told that its corporation rented an office or gave one up, the page reads the corporation's hangar again where it has it open", async () => {
  const { flow, state, push, hangar, reads } = await docked();
  await flow.loadCorpHangar();
  assert.deepEqual([hangar(), reads()], [[true, false, 0], 1]);
  // The corporation rents an office here. The server says so twice, of the station and of the corporation.
  state.office = true;
  await push("OnOfficeRentalChange", [CORPORATION, OFFICE]);
  assert.deepEqual([hangar(), reads()], [[true, true, 1], 2]);
  await push("OnOfficeRentalChange", [CORPORATION, OFFICE]);
  assert.deepEqual([hangar(), reads()], [[true, true, 1], 3]);
  // And gives it up.
  state.office = false;
  await push("OnOfficeRentalChange", [CORPORATION, OFFICE]);
  assert.deepEqual([hangar(), reads()], [[true, false, 0], 4]);
});

test("another corporation's office, another notice, and a hangar never opened read nothing", async () => {
  const { flow, state, push, hangar, reads } = await docked();
  // The hangar was never opened: there is nothing on the page to draw again.
  state.office = true;
  await push("OnOfficeRentalChange", [CORPORATION, OFFICE]);
  assert.deepEqual([hangar(), reads()], [[false, false, 0], 0]);
  await flow.loadCorpHangar();
  assert.equal(reads(), 1);
  // invWindow.py: only where the corporation is the session's.
  await push("OnOfficeRentalChange", [CORPORATION + 1, OFFICE]);
  await push("OnOfficeRentalChange", []);
  await push("OnOfficeRentalChange", [null, OFFICE]);
  await push("OnOfficeSomethingElse", [CORPORATION, OFFICE]);
  await push("OnItemsChanged", [CORPORATION, OFFICE]);
  assert.equal(reads(), 1);
});
