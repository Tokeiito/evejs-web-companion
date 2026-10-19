// What the server tells the player unasked, on the page (gameui.py OnRemoteMessage): said on the notice board, in the
// client's words where the page has them.

import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";

const PILOT = 90000001;

interface PushSource {
  onmessage: ((event: { data: string }) => void) | null;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  close(): void;
}

/** A pilot online with its live channel open; `dialogs` is what the BFF has of the client's dialogs (none: no client). */
async function online(dialogs: Record<string, { title: string | null; body: string | null; suppressable: string | null }> | null) {
  const store = createClientStore();
  const fetchImpl = (async (input: unknown, init?: { method?: string; body?: unknown }) => {
    const path = String(input);
    const body = init && typeof init.body === "string" ? JSON.parse(init.body) : {};
    let answer: unknown = { ok: true };
    if (path === "/api/bridge/select") {
      answer = { ok: true, character: { characterID: body.characterID, characterName: "Test Pilot", stationID: 60003760, structureID: null, solarSystemID: 30000142, corporationID: 1000044 }, droneRecoveryCheckID: "check-1" };
    } else if (path === "/api/words") {
      answer = dialogs === null
        ? { ok: true, available: false, words: {}, messages: {}, dialogs: {} }
        : { ok: true, available: true, words: {}, messages: {}, dialogs: Object.fromEntries((body.dialogs ?? []).map((name: string) => [name, dialogs[name] ?? null])) };
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
  await new Promise((resolve) => setTimeout(resolve, 25));
  const source = sources[0];
  assert.ok(source, "coming online opens the live channel");
  source.onopen?.();
  let sequence = 0;
  const push = async (method: string, args: readonly unknown[]) => {
    sequence += 1;
    source.onmessage?.({ data: JSON.stringify({
      source: "evejs-web-gateway", apiVersion: 1, type: "event", cursor: { epoch: "epoch-1", sequence },
      event: { kind: "notification", notification: { kind: "client", service: null, method, args, kwargs: null } },
    }) });
    await new Promise((resolve) => setTimeout(resolve, 60));
  };
  return { store, push };
}

test("a CustomNotify is said as the server wrote it, and a CustomError as an error", async () => {
  const pilot = await online(null);
  await pilot.push("OnRemoteMessage", ["CustomNotify", { type: "dict", entries: [["notify", "Crimson Harvest is active."]] }]);
  assert.equal(pilot.store.serverMessages.get().notice, "Crimson Harvest is active.");
  await pilot.push("OnRemoteMessage", ["CustomError", { type: "dict", entries: [["error", "That cannot be done."]] }]);
  assert.deepEqual(pilot.store.serverMessages.get(), { notice: "Crimson Harvest is active.", error: "That cannot be done." });
  // Gone offline: nothing is held for nobody.
  pilot.store.apply({ type: "character/offline" } as never);
  assert.deepEqual(pilot.store.serverMessages.get(), { notice: null, error: null });
});

test("a dialog of the client's is worded from the client's own text where the BFF has it", async () => {
  const pilot = await online({ FleetWarp: { title: null, body: "Following {leader} in warp", suppressable: null } });
  await pilot.push("OnRemoteMessage", ["FleetWarp", { type: "dict", entries: [["leader", "Test Two"]] }]);
  assert.equal(pilot.store.serverMessages.get().notice, "Following Test Two in warp");
});
