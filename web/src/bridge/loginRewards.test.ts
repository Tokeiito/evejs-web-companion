// The account's daily login campaign and the day's claim of it (loginCampaignService.py; panelControllers.py).

import test from "node:test";
import assert from "node:assert/strict";

import { LOGIN_CAMPAIGN_NOTICE, campaignAfterClaim, canClaimNow, decodeLoginCampaign, decodeLoginClaim, loginDayState } from "./loginRewards.ts";
import { readLoginCampaign } from "./loginRewardReads.ts";
import { claimLoginReward } from "./loginRewardWrites.ts";
import type { JsonValue } from "./wire.ts";

const keyVal = (entries: readonly (readonly [string, JsonValue])[]): JsonValue => ({ type: "object", name: "util.KeyVal", args: { type: "dict", entries: entries as JsonValue } });
const FILETIME = (ms: number): JsonValue => ({ type: "long", value: String(BigInt(ms) * 10000n + 116444736000000000n) });
const RESET = Date.UTC(2026, 9, 19, 11);

const reward = (typeID: number, quantity: number, tier: number) => keyVal([["typeID", typeID], ["quantity", quantity], ["tier", tier], ["labelMessageID", 598041], ["icon", null]]);
/** This server's answer: fifteen days, the last a tier 4, three claimed. */
const STATE = keyVal([
  ["static_data", keyVal([
    ["campaign_duration", 15], ["campaign_id", 9], ["is_rookie_campaign", true],
    ["item_rewards_by_day", { type: "dict", entries: Array.from({ length: 15 }, (_, at) => [at + 1, reward(34, 1000 + at, at === 14 ? 4 : 1)]) }],
  ])],
  ["bucket_progress", keyVal([["bucketID", 4]])],
  ["item_progress", keyVal([["next_reward_index", 4], ["num_claimed_rewards", 3], ["next_reward_timestamp", FILETIME(RESET)]])],
]);

test("the campaign is its fifteen days in order, the next day, and when it may be claimed", () => {
  const campaign = decodeLoginCampaign(STATE)!;
  assert.deepEqual([campaign.campaignID, campaign.duration, campaign.rookie, campaign.nextDay, campaign.claimedCount, campaign.nextClaimAt], [9, 15, true, 4, 3, RESET]);
  assert.deepEqual(campaign.days.map((day) => day.day), Array.from({ length: 15 }, (_, at) => at + 1));
  assert.deepEqual([campaign.days[0], campaign.days[14]], [{ day: 1, typeID: 34, quantity: 1000, tier: 1 }, { day: 15, typeID: 34, quantity: 1014, tier: 4 }]);
  // None, or what is no campaign, is none.
  assert.equal(decodeLoginCampaign(null), null);
  assert.equal(decodeLoginCampaign(keyVal([["item_progress", keyVal([])]])), null);
  assert.equal(LOGIN_CAMPAIGN_NOTICE, "OnCampaignEnrollmentChanged");
});

test("a day before the next is claimed; the next is claimable once its time is past, and waits before; the rest are to come", () => {
  const campaign = decodeLoginCampaign(STATE)!;
  const after = RESET + 1, before = RESET - 1;
  assert.deepEqual([1, 3, 4, 5, 15].map((day) => loginDayState(campaign, day, after)), ["claimed", "claimed", "claimable", "upcoming", "upcoming"]);
  assert.equal(loginDayState(campaign, 4, before), "next");
  assert.deepEqual([canClaimNow(campaign, after), canClaimNow(campaign, before), canClaimNow(campaign, RESET)], [true, false, false]);
});

test("a claim's answer is what was given and the progress after it; None is nothing claimed", () => {
  const answer: JsonValue = [reward(34, 1003, 1), keyVal([["next_reward_index", 5], ["num_claimed_rewards", 4], ["next_reward_timestamp", FILETIME(RESET + 86400000)]]), null, keyVal([])];
  const claim = decodeLoginClaim(answer)!;
  assert.deepEqual(claim, { reward: { typeID: 34, quantity: 1003 }, nextDay: 5, claimedCount: 4, nextClaimAt: RESET + 86400000 });
  const after = campaignAfterClaim(decodeLoginCampaign(STATE)!, claim);
  assert.deepEqual([after.nextDay, after.claimedCount, loginDayState(after, 4, RESET + 2), loginDayState(after, 5, RESET + 2)], [5, 4, "claimed", "next"]);
  assert.equal(decodeLoginClaim(null), null);
});

test("the read and the claim are the client's calls with nothing; a transport that does not carry the read has no campaign", async () => {
  const made: unknown[] = [];
  const ask = async (...call: unknown[]): Promise<JsonValue> => { made.push(call); return null; };
  assert.equal(await readLoginCampaign(ask), null);
  assert.equal(await claimLoginReward(ask), null);
  assert.deepEqual(made, [["loginCampaignManager", "get_client_campaign_state", []], ["loginCampaignManager", "claim_reward", []]]);
  const refused = Object.assign(new Error("not allowed"), { code: "CALL_NOT_ALLOWED" });
  assert.equal(await readLoginCampaign(async () => { throw refused; }), null);
});
