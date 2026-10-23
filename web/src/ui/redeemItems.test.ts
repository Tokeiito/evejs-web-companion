import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { createClientStore } from "../store/clientStore.ts";
import { decodeRedeemTokens } from "../bridge/redeem.ts";

register("./svelteSsrHook.ts", import.meta.url);
const { render } = await import("svelte/server");
const RedeemItems = (await import("./RedeemItems.svelte")).default;

function renderTokens(types: readonly number[]) {
  const store = createClientStore();
  const tokens = decodeRedeemTokens({ type: "objectex2", list: types.map((typeID, index) => ({
    type: "packedrow", fields: { tokenID: index + 1, typeID, quantity: 1, soulbound: typeID === 63188 ? 1 : 0 },
  })) })!;
  store.apply({ type: "redeem/tokens", tokens, error: null });
  const body = render(RedeemItems, { props: { store, flow: {} as never } }).body;
  const text = body.replace(/<!--[\s\S]*?-->|<[^>]+>/g, " ").replace(/\s+/g, " ");
  const inputs = [...body.matchAll(/<input\b[^>]*type="checkbox"[^>]*>/g)].map(([tag]) => tag);
  const buttons = [...body.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attrs, contents]) => ({
    disabled: /\bdisabled\b/.test(attrs!),
    text: contents!.replace(/<!--[\s\S]*?-->|<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
  }));
  return { text, inputs, buttons };
}

test("training certificates remain visible with a client activation explanation and no selection", () => {
  const { text, inputs, buttons } = renderTokens([63188]);
  assert.match(text, /Activate this training certificate in the EVE client/);
  assert.match(text, /0 of 0 selected/);
  assert.equal(inputs.length, 1);
  assert.match(inputs[0]!, /\bdisabled\b/);
  assert.equal(buttons.find((button) => button.text === "Select all")?.disabled, true);
  const claims = buttons.filter((button) => button.text.startsWith("Redeem to "));
  assert.equal(claims.length, 2);
  assert.equal(claims.every((button) => button.disabled), true);
});

test("ordinary tokens stay selectable beside a training certificate and own the selection count", () => {
  const { text, inputs, buttons } = renderTokens([63188, 34]);
  assert.match(text, /0 of 1 selected/);
  assert.equal(inputs.length, 2);
  assert.match(inputs[0]!, /\bdisabled\b/);
  assert.doesNotMatch(inputs[1]!, /\bdisabled\b/);
  assert.equal(buttons.find((button) => button.text === "Select all")?.disabled, false);
});
