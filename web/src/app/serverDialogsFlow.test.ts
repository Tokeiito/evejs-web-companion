// What the server tells the player unasked, put up as the client puts it up (gameui.py OnRemoteMessage:
// prompt_player_fsd_dialog(msgID, dict)): the dialog it names, with its dict, among the flow's dialogs said.

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

async function online() {
  const store = createClientStore();
  const fetchImpl = (async (input: unknown, init?: { method?: string; body?: unknown }) => {
    const path = String(input);
    const body = init && typeof init.body === "string" ? JSON.parse(init.body) : {};
    let answer: unknown = { ok: true };
    if (path === "/api/bridge/select") {
      answer = { ok: true, character: { characterID: body.characterID, characterName: "Test Pilot", stationID: 60003760, structureID: null, solarSystemID: 30000142, corporationID: 1000044 }, droneRecoveryCheckID: "check-1" };
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
    await new Promise((resolve) => setTimeout(resolve, 25));
  };
  const said = () => flow.dialogsSaid.get().map(({ dialog, values, fallback }) => ({ dialog, values, fallback }));
  return { flow, push, said };
}

test("the server's message is put up as the dialog it names, with its dict and the page's words beside it", async () => {
  const pilot = await online();
  const notify = { type: "dict", entries: [["notify", "Crimson Harvest is active."]] };
  await pilot.push("OnRemoteMessage", ["CustomNotify", notify]);
  await pilot.push("OnRemoteMessage", ["ShipInWarp", null]);
  assert.deepEqual(pilot.said(), [
    { dialog: "CustomNotify", values: notify, fallback: "Crimson Harvest is active." },
    { dialog: "ShipInWarp", values: null, fallback: "You cannot do that while warping." },
  ]);
  // What names no dialog, and a Custom* with nothing to say, put nothing up.
  await pilot.push("OnRemoteMessage", ["has spaces", null]);
  await pilot.push("OnRemoteMessage", ["CustomNotify", { type: "dict", entries: [["notify", ""]] }]);
  assert.equal(pilot.said().length, 2);
});
