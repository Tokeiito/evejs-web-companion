// The account's daily login campaign, on the page (loginCampaignService.py).
//
// The retail client's login campaign service asks for the campaign as its neocom button is set up and keeps it, takes
// a claim's answer as the progress after it, and asks again at OnCampaignEnrollmentChanged (84 to 88). The page does
// the same.

import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";

const PILOT = 90000001;
const RESET = Date.UTC(2026, 9, 19, 11);

interface PushSource {
  onmessage: ((event: { data: string }) => void) | null;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  close(): void;
}

const keyVal = (entries: readonly (readonly [string, unknown])[]) => ({ type: "object", name: "util.KeyVal", args: { type: "dict", entries } });
const filetime = (ms: number) => ({ type: "long", value: String(BigInt(ms) * 10000n + 116444736000000000n) });
const progress = (next: number, claimed: number, at: number) => keyVal([["next_reward_index", next], ["num_claimed_rewards", claimed], ["next_reward_timestamp", filetime(at)]]);
const campaignAnswer = (next: number, claimed: number, at: number) => keyVal([
  ["static_data", keyVal([["campaign_id", 700001], ["campaign_duration", 15], ["is_rookie_campaign", true],
    ["item_rewards_by_day", { type: "dict", entries: Array.from({ length: 15 }, (_, at) => [at + 1, keyVal([["typeID", 34], ["quantity", 100 + at], ["tier", 1]])]) }]])],
  ["item_progress", progress(next, claimed, at)],
]);

/** A pilot online with its live channel open; `state` is what the server holds of the campaign. */
const TODAY = Math.floor((Date.now() - 11 * 3_600_000) / 86_400_000) + 719163;

interface ReadHooks { daily?: () => Promise<void>; definition?: () => Promise<void>; definitionFails?: boolean; seasonalClaim?: () => Promise<void> }
async function online(carried = true, seasonalOn = false, hooks: ReadHooks = {}) {
  const store = createClientStore();
  const seasonal = { on: seasonalOn, endOrdinal: TODAY + 20, today: TODAY, history: [TODAY - 2, TODAY - 1] as number[] };
  const seasonalCalls: string[] = [];
  const state = { next: 4, claimed: 3, at: RESET - 1000, claimedToday: false };
  const reads: unknown[] = [];
  const claims: Record<string, unknown>[] = [];
  const fetchImpl = (async (input: unknown, init?: { method?: string; body?: unknown }) => {
    const path = String(input);
    const body = init && typeof init.body === "string" ? JSON.parse(init.body) : {};
    let status = 200;
    let answer: unknown = { ok: true };
    if (path === "/api/bridge/select") {
      answer = { ok: true, character: { characterID: body.characterID, characterName: "Test Pilot", stationID: 60003760, structureID: null, solarSystemID: 30000142, corporationID: 1000044 }, droneRecoveryCheckID: "check-1" };
    } else if (path === "/api/bridge/call" && body.service === "loginCampaignManager" && body.method === "get_client_campaign_state") {
      reads.push(body);
      if (!carried) {
        status = 403;
        answer = { ok: false, error: "CALL_NOT_ALLOWED", message: "loginCampaignManager.get_client_campaign_state is not on the web-call allowlist." };
      } else {
        answer = { ok: true, service: body.service, method: body.method, result: campaignAnswer(state.next, state.claimed, state.at), notifications: [] };
        await hooks.daily?.();
      }
    } else if (path === "/api/bridge/call" && body.service === "loginCampaignManager" && body.method === "claim_reward") {
      claims.push(body);
      let result: unknown = null;
      if (!state.claimedToday) {
        result = [keyVal([["typeID", 34], ["quantity", 100 + state.next - 1]]), progress(state.next + 1, state.claimed + 1, RESET + 86_400_000), null, keyVal([])];
        Object.assign(state, { next: state.next + 1, claimed: state.claimed + 1, at: RESET + 86_400_000, claimedToday: true });
      }
      answer = { ok: true, service: body.service, method: body.method, result, notifications: [] };
    } else if (path === "/api/login-rewards/campaigns/700002") {
      answer = { ok: true, definition: { name: "Test Seasonal Campaign", retroClaim: false, alpha: Array.from({ length: 6 }, (_, day) => [day, 34, 1, 1]), omega: Array.from({ length: 6 }, (_, day) => [day, 35, 2, 1]) } };
      await hooks.definition?.();
      if (hooks.definitionFails) { status = 500; answer = { ok: false, error: "READ_FAILED", message: "Definition unavailable" }; }
    } else if (path === "/api/bridge/call" && body.service === "seasonalLoginCampaignManager") {
      // A synthetic campaign: its ID, end, turnover, and rewards left.
      seasonalCalls.push(body.method);
      const result = !seasonal.on ? [null, null, null, null]
        : body.method === "get_active_campaign" ? [700002, seasonal.endOrdinal, "11:00:00", 6 - seasonal.history.length]
        : body.method === "get_claim_history" ? { type: "dict", entries: seasonal.history.map((ordinal) => [ordinal, 0]) }
        : (() => { const claimed = !seasonal.history.includes(seasonal.today); if (claimed) seasonal.history.push(seasonal.today); return claimed; })();
      answer = { ok: true, service: body.service, method: body.method, result, notifications: [] };
      if (body.method === "claim_reward") await hooks.seasonalClaim?.();
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
  const push = async (method: string, args: readonly unknown[]) => {
    sequence += 1;
    source.onmessage?.({ data: JSON.stringify({
      source: "evejs-web-gateway", apiVersion: 1, type: "event", cursor: { epoch: "epoch-1", sequence },
      event: { kind: "notification", notification: { kind: "client", service: null, method, args, kwargs: null } },
    }) });
    await new Promise((resolve) => setTimeout(resolve, 25));
  };
  return { store, flow, state, push, reads, claims, seasonal, seasonalCalls };
}

test("a pilot that comes online has the account's campaign read, by the client's call, and again when the server says it is another", async () => {
  const pilot = await online();
  const held = pilot.store.loginRewards.get();
  assert.deepEqual([held.loaded, held.campaign?.nextDay, held.campaign?.claimedCount, held.campaign?.days.length, held.campaign?.nextClaimAt], [true, 4, 3, 15, RESET - 1000]);
  assert.deepEqual([(pilot.reads[0] as { args: unknown }).args, pilot.reads.length], [[], 1]);
  await pilot.push("OnCampaignEnrollmentChanged", []);
  assert.equal(pilot.reads.length, 2);
  pilot.store.apply({ type: "character/offline" } as never);
  assert.deepEqual([pilot.store.loginRewards.get().campaign, pilot.store.loginRewards.get().loaded], [null, false]);
});

test("the day's claim is the client's call with nothing, and its answer is the progress after it, with no second read", async () => {
  const pilot = await online();
  const claim = await pilot.flow.claimLoginReward();
  assert.deepEqual([pilot.claims.length, pilot.claims[0]!.args, pilot.claims[0]!.pilot, pilot.claims[0]!.confirm], [1, [], true, true]);
  assert.deepEqual(claim.reward, { typeID: 34, quantity: 103 });
  const held = pilot.store.loginRewards.get();
  assert.deepEqual([held.campaign?.nextDay, held.campaign?.claimedCount, held.campaign?.nextClaimAt, held.lastClaim], [5, 4, RESET + 86_400_000, { typeID: 34, quantity: 103 }]);
  assert.equal(pilot.reads.length, 1);
  // A second claim the same day is answered None: it fails, saying why, and what the server holds is read again.
  await assert.rejects(pilot.flow.claimLoginReward(), /nothing to claim yet/);
  assert.deepEqual([pilot.claims.length, pilot.reads.length, pilot.store.loginRewards.get().campaign?.nextDay], [2, 2, 5]);
});

test("a pilot whose transport does not carry the read has no campaign, and no error", async () => {
  const pilot = await online(false);
  const held = pilot.store.loginRewards.get();
  assert.deepEqual([held.campaign, held.error, held.loaded], [null, null, true]);
});

test("a seasonal campaign on is read with the days claimed, named and laid out from the client's data, and claimed", async () => {
  const pilot = await online(true, true);
  const held = pilot.store.loginRewards.get().seasonal;
  assert.deepEqual([held?.active.campaignID, held?.active.remaining, held?.history.length, held?.definition?.name, held?.definition?.alpha.length], [700002, 4, 2, "Test Seasonal Campaign", 6]);
  assert.deepEqual(pilot.seasonalCalls, ["get_active_campaign", "get_claim_history"]);
  await pilot.flow.claimSeasonalReward();
  assert.deepEqual(pilot.seasonalCalls.slice(2), ["claim_reward", "get_active_campaign", "get_claim_history"]);
  assert.equal(pilot.store.loginRewards.get().seasonal?.history.length, 3);
  // The same day again: the server gives nothing, and the page says so.
  await assert.rejects(pilot.flow.claimSeasonalReward(), /nothing to claim yet/);
});

test("with no seasonal campaign on, only the first of its calls is made, and there is none", async () => {
  const pilot = await online(true, false);
  assert.deepEqual([pilot.store.loginRewards.get().seasonal, pilot.seasonalCalls], [null, ["get_active_campaign"]]);
});

function gate() {
  let release!: () => void;
  let enter!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { enter = resolve; });
  return { entered, release, wait: async () => { enter(); await waiting; } };
}

test("an enrollment refresh begun before a successful daily claim cannot rewind its progress", async () => {
  const hooks: ReadHooks = {};
  const pilot = await online(true, false, hooks);
  const old = gate();
  hooks.daily = old.wait;
  const notice = pilot.push("OnCampaignEnrollmentChanged", []);
  await old.entered;
  try {
    await pilot.flow.claimLoginReward();
    assert.equal(pilot.store.loginRewards.get().campaign?.nextDay, 5);
    old.release();
    await notice;
    assert.equal(pilot.store.loginRewards.get().campaign?.nextDay, 5);
    assert.equal(pilot.store.loginRewards.get().campaign?.claimedCount, 4);
  } finally { old.release(); await pilot.flow.logout(); }
});

test("the latest daily reload wins when an older snapshot arrives last", async () => {
  const hooks: ReadHooks = {};
  const pilot = await online(true, false, hooks);
  const old = gate();
  hooks.daily = old.wait;
  const pending = pilot.flow.loadLoginRewards();
  await old.entered;
  try {
    hooks.daily = undefined;
    pilot.state.next = 7; pilot.state.claimed = 6;
    await pilot.flow.loadLoginRewards();
    old.release(); await pending;
    assert.equal(pilot.store.loginRewards.get().campaign?.nextDay, 7);
  } finally { old.release(); await pilot.flow.logout(); }
});

test("a seasonal definition fetched after logout cannot repopulate the retired pilot's store", async () => {
  const hooks: ReadHooks = {};
  const pilot = await online(true, false, hooks);
  const definition = gate();
  hooks.definition = definition.wait;
  pilot.seasonal.on = true;
  const pending = pilot.flow.loadLoginRewards();
  await definition.entered;
  await pilot.flow.logout();
  definition.release();
  await assert.rejects(pending, error => (error as { code?: string }).code === "SESSION_REQUEST_RETIRED");
  assert.equal(pilot.store.loginRewards.get().seasonal, null);
  assert.equal(pilot.store.loginRewards.get().loaded, false);
});

test("a retired seasonal claim preserves its error and never starts a replacement-session refresh", async () => {
  const hooks: ReadHooks = {};
  const pilot = await online(true, true, hooks);
  const claim = gate();
  hooks.seasonalClaim = claim.wait;
  const pending = pilot.flow.claimSeasonalReward();
  await claim.entered;
  await pilot.flow.logout();
  const reads = pilot.seasonalCalls.length;
  claim.release();
  await assert.rejects(pending, error => (error as { code?: string }).code === "SESSION_REQUEST_RETIRED");
  assert.equal(pilot.seasonalCalls.length, reads);
  assert.equal(pilot.store.loginRewards.get().seasonal, null);
});

test("optional seasonal definition HTTP failure still exposes and claims the active campaign", async () => {
  const pilot = await online(true, true, { definitionFails: true });
  try {
    assert.equal(pilot.store.loginRewards.get().seasonal?.active.campaignID, 700002);
    assert.equal(pilot.store.loginRewards.get().seasonal?.definition, null);
    await pilot.flow.claimSeasonalReward();
    assert.equal(pilot.store.loginRewards.get().seasonal?.history.length, 3);
    assert.equal(pilot.seasonalCalls.filter(method => method === "claim_reward").length, 1);
  } finally { await pilot.flow.logout(); }
});
