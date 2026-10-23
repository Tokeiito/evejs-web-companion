// What the server tells the player unasked, put up as the client puts it up (gameui.py OnRemoteMessage:
// prompt_player_fsd_dialog(msgID, dict)): the dialog it names, with its dict, among the flow's dialogs said.

import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { render } from "svelte/server";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";
import type { Session } from "./sessions.ts";

register("../ui/svelteSsrHook.ts", import.meta.url);

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
  return { store, flow, push, said };
}

test("the server's message is put up as the dialog it names, with its dict and the page's words beside it", async () => {
  const pilot = await online();
  try {
    const notify = { type: "dict", entries: [["notify", "Test server notice."]] };
    await pilot.push("OnRemoteMessage", ["CustomNotify", notify]);
    await pilot.push("OnRemoteMessage", ["ShipInWarp", null]);
    assert.deepEqual(pilot.said(), [
      { dialog: "CustomNotify", values: notify, fallback: "Test server notice." },
      { dialog: "ShipInWarp", values: null, fallback: "You cannot do that while warping." },
    ]);
    // What names no dialog, and a Custom* with nothing to say, put nothing up.
    await pilot.push("OnRemoteMessage", ["has spaces", null]);
    await pilot.push("OnRemoteMessage", ["CustomNotify", { type: "dict", entries: [["notify", ""]] }]);
    assert.equal(pilot.said().length, 2);
  } finally { await pilot.flow.logout(); }
});

async function renderRemote(dialog: string, values: unknown, localType: string | null | undefined, available = false): Promise<string> {
  const pilot = await online();
  try {
    await pilot.push("OnRemoteMessage", [dialog, values]);
    pilot.store.apply({ type: "words/loaded", available, templates: localType === undefined ? {} : {
      [`dialog:${dialog}/type`]: localType,
      [`dialog:${dialog}/title`]: null,
      [`dialog:${dialog}/body`]: null,
    } });
    const ClientDialogs = (await import("../ui/ClientDialogs.svelte")).default;
    return render(ClientDialogs, { props: {
      session: { id: "remote-dialog-test", store: pilot.store, flow: pilot.flow } satisfies Session,
      inFront: true,
    } }).body;
  } finally { await pilot.flow.logout(); }
}

test("a known remote notification is visible as a strip even when the dialog-type read never answered", async () => {
  const body = await renderRemote("CustomNotify", { type: "dict", entries: [["notify", "Test unread notification."]] }, undefined);
  assert.match(body, /class="client-strip/);
  assert.ok(body.includes("Test unread notification."));
  assert.doesNotMatch(body, /role="alertdialog"/);
});

for (const [dialog, values, text] of [
  ["CustomNotify", { type: "dict", entries: [["notify", "Test notification."]] }, "Test notification."],
  ["FleetWarp", null, "Following your fleet in warp."],
  ["ShipInWarp", null, "You cannot do that while warping."],
] as const) {
  test(`${dialog} without local dialog data renders a transient status strip rather than an OK modal`, async () => {
    const body = await renderRemote(dialog, values, null);
    assert.match(body, /class="client-strip/);
    assert.match(body, /role="status"/);
    assert.ok(body.includes(text));
    assert.doesNotMatch(body, /role="alertdialog"/);
  });
}

for (const [dialog, key] of [["CustomInfo", "info"], ["CustomError", "error"], ["CustomWarning", "warning"]] as const) {
  test(`${dialog} without local dialog data remains an acknowledged message box`, async () => {
    const body = await renderRemote(dialog, { type: "dict", entries: [[key, "Test message box."]] }, null);
    assert.match(body, /role="alertdialog"/);
    assert.ok(body.includes("Test message box."));
    assert.doesNotMatch(body, /class="client-strip/);
  });
}

test("an installed dialog's box type overrides a remote notification's fallback", async () => {
  const body = await renderRemote("CustomNotify", { type: "dict", entries: [["notify", "Test installed box."]] }, "info", true);
  assert.match(body, /role="alertdialog"/);
  assert.doesNotMatch(body, /class="client-strip/);
});

test("an installed dialog's strip type overrides a remote information box fallback", async () => {
  const body = await renderRemote("CustomInfo", { type: "dict", entries: [["info", "Test installed strip."]] }, "notify", true);
  assert.match(body, /class="client-strip/);
  assert.doesNotMatch(body, /role="alertdialog"/);
});

for (const type of ["audio", "", "UnknownTestType"]) {
  test(`an installed type ${JSON.stringify(type)} suppresses a notification's visual fallback`, async () => {
    const body = await renderRemote("CustomNotify", { type: "dict", entries: [["notify", "Test suppressed message."]] }, type, true);
    assert.doesNotMatch(body, /class="client-strip|role="alertdialog"|Test suppressed message/);
  });
}

test("an unknown remote dialog without local data conservatively remains a box", async () => {
  const body = await renderRemote("UnknownTestDialog", null, null);
  assert.match(body, /role="alertdialog"/);
  assert.ok(body.includes("UnknownTestDialog"));
  assert.doesNotMatch(body, /class="client-strip/);
});
