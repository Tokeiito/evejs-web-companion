// R107 — the character bar's server-connection indicator. Rendered with Svelte's
// server generator (no DOM), like characterChip.test.ts. Empty roster so no chip
// mounts; we only assert the status indicator reflects the passed serverStatus.

import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./svelteSsrHook.ts", import.meta.url);

const { render } = await import("svelte/server");
const CharacterBar = (await import("./CharacterBar.svelte")).default;

function renderBar(serverStatus: "checking" | "online" | "offline"): string {
  return render(CharacterBar as never, {
    props: { sessions: [], activeId: null, serverStatus, onSwitch: () => {}, onAdd: () => {} },
  } as never).body;
}

test("the bar shows a Connected status when the server is online", () => {
  const body = renderBar("online");
  assert.match(body, /char-bar-status-online/);
  assert.match(body, /Connected/);
});

test("the bar shows Server offline when the health poll fails", () => {
  const body = renderBar("offline");
  assert.match(body, /char-bar-status-offline/);
  assert.match(body, /Server offline/);
});

test("the bar shows Connecting… while the first health ping is in flight", () => {
  const body = renderBar("checking");
  assert.match(body, /char-bar-status-checking/);
  assert.match(body, /Connecting/);
});
