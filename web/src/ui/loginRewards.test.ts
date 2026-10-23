import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { createClientStore } from "../store/clientStore.ts";
import { decodeRedeemTokens } from "../bridge/redeem.ts";
import { rewardOrdinal, type SeasonalCampaignDefinition } from "../bridge/seasonalCampaigns.ts";

register("./svelteSsrHook.ts", import.meta.url);
const { render } = await import("svelte/server");
const LoginRewards = (await import("./LoginRewards.svelte")).default;
const Neocom = (await import("./Neocom.svelte")).default;

const NOW = Date.UTC(2026, 9, 23, 12);
const TODAY = rewardOrdinal(NOW, 660);
const definition: SeasonalCampaignDefinition = {
  name: "Synthetic two-day campaign", retroClaim: true,
  alpha: [[0, 100, 1, 1], [1, 101, 1, 1]],
  omega: [[0, 200, 1, 1], [1, 201, 1, 1]],
};

function rewardsStore(history: readonly { ordinal: number; grade: number }[], remaining: number, known = true, retro = true) {
  const store = createClientStore();
  store.apply({ type: "character/clone-grade", cloneGrade: 1 });
  store.apply({ type: "login-rewards/state", campaign: null, error: null });
  store.apply({ type: "login-rewards/seasonal", seasonal: {
    active: { campaignID: 9, endOrdinal: TODAY + 1, turnoverMinutes: 660, remaining }, history,
    definition: known ? { ...definition, retroClaim: retro } : null,
  } });
  return store;
}

function atFixedTime<T>(operation: () => T): T {
  const original = Date.now;
  Date.now = () => NOW;
  try { return operation(); } finally { Date.now = original; }
}

function page(store: ReturnType<typeof rewardsStore>) {
  const body = atFixedTime(() => render(LoginRewards, { props: { store, flow: {} as never } }).body);
  const text = body.replace(/<!--[\s\S]*?-->|<[^>]+>/g, " ").replace(/\s+/g, " ");
  const buttons = [...body.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attributes, content]) => ({
    disabled: /\bdisabled\b/.test(attributes!),
    label: content!.replace(/<!--[\s\S]*?-->|<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
  }));
  return { text, buttons };
}

test("same-day omega upgrade offers catch-up without offering the next day's reward", () => {
  const { text, buttons } = page(rewardsStore([{ ordinal: TODAY, grade: 0 }], 1));
  assert.ok(buttons.some((button) => /Claim.*Omega/.test(button.label) && !button.disabled));
  assert.match(text, /1 earlier Omega reward/);
  assert.doesNotMatch(text, /Day 2:|campaign ends before the next reward/i);
});

test("omega catch-up remains available after all alpha days were claimed before today", () => {
  const { text, buttons } = page(rewardsStore([{ ordinal: TODAY - 2, grade: 0 }, { ordinal: TODAY - 1, grade: 0 }], 0));
  assert.ok(buttons.some((button) => /Claim.*Omega/.test(button.label) && !button.disabled));
  assert.match(text, /2 earlier Omega rewards/);
  assert.doesNotMatch(text, /Day 3:/);
});

test("completed omega, disabled retro, and unknown definitions do not invent catch-up", () => {
  const history = [{ ordinal: TODAY - 2, grade: 0 }, { ordinal: TODAY - 1, grade: 0 }];
  for (const store of [rewardsStore(history.map((row) => ({ ...row, grade: 1 })), 0), rewardsStore(history, 0, true, false), rewardsStore(history, 0, false)]) {
    const { buttons } = page(store);
    assert.ok(!buttons.some((button) => button.label.startsWith("Claim") && !button.disabled));
  }
});

test("an unknown definition still permits a new day's server-advertised reward", () => {
  const { text, buttons } = page(rewardsStore([], 1, false));
  assert.ok(buttons.some((button) => button.label === "Claim" && !button.disabled));
  assert.doesNotMatch(text, /earlier Omega reward|Day 1:/);
});

test("the rail marks available omega catch-up and retains the redeem count and labels", () => {
  const store = rewardsStore([{ ordinal: TODAY - 2, grade: 0 }, { ordinal: TODAY - 1, grade: 0 }], 0);
  store.apply({ type: "redeem/tokens", tokens: decodeRedeemTokens({ type: "objectex2", list: [1, 2].map((tokenID) => ({
    type: "packedrow", fields: { tokenID, typeID: 100, quantity: 1 },
  })) }), error: null });
  const body = atFixedTime(() => render(Neocom, { props: { store, isDocked: true, openIds: new Set(), focusedId: null, onSelect: () => {} } }).body);
  assert.match(body, /aria-label="Daily Login Rewards, a reward is ready"/);
  assert.match(body, /title="Redeem Items \(2\)"/);
  assert.match(body, /aria-label="Redeem Items, 2 to redeem"/);
  assert.match(body, /neocom-badge[^>]*>2</);
  assert.match(body, /neocom-dot/);
});
