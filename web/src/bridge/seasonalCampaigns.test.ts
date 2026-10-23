// The account's seasonal login campaign: the server's three answers and the client's rules for its two tracks
// (seasonalLoginCampaignService.py; twoTrackRewardPanel.py).

import test from "node:test";
import assert from "node:assert/strict";

import { decodeActiveSeasonal, decodeClaimHistory, rewardOrdinal, seasonalClaimable, seasonalView, type SeasonalCampaignDefinition } from "./seasonalCampaigns.ts";

/** 2026-10-19 12:00 UTC: after the 11:00 turnover, so its reward day is the 19th. */
const NOON = Date.UTC(2026, 9, 19, 12);
const TODAY = rewardOrdinal(NOON, 11 * 60);
const reward = (day: number, typeID: number) => [day, typeID, 1, 1] as const;
/** Five days on each track, retroClaim on. */
const FIVE: SeasonalCampaignDefinition = {
  name: "Five Days", retroClaim: true,
  alpha: [0, 1, 2, 3, 4].map((day) => reward(day, 100 + day)),
  omega: [0, 1, 2, 3, 4].map((day) => reward(day, 200 + day)),
};
const active = (endOrdinal: number, remaining: number) => ({ campaignID: 9, endOrdinal, turnoverMinutes: 660, remaining });

test("the server's answers: the campaign on, or none; and the days claimed in order of date", () => {
  assert.deepEqual(decodeActiveSeasonal([9, 740000, "11:00:00", 4]), { campaignID: 9, endOrdinal: 740000, turnoverMinutes: 660, remaining: 4 });
  assert.deepEqual(decodeActiveSeasonal({ type: "list", items: [9, 740000, { type: "wstring", value: "09:30:00" }, 3] })?.turnoverMinutes, 570);
  assert.equal(decodeActiveSeasonal([null, null, null, null]), null);
  assert.equal(decodeActiveSeasonal(null), null);
  assert.deepEqual(decodeClaimHistory({ type: "dict", entries: [[TODAY, 1], [TODAY - 2, 0]] }), [{ ordinal: TODAY - 2, grade: 0 }, { ordinal: TODAY, grade: 1 }]);
  // The reward day turns at the turnover, not at midnight.
  assert.equal(rewardOrdinal(Date.UTC(2026, 9, 19, 10, 59), 660), TODAY - 1);
});

test("an alpha clone: the days claimed in order, the next claimable, the omega track locked, the rest to come", () => {
  const history = [{ ordinal: TODAY - 5, grade: 0 }, { ordinal: TODAY - 1, grade: 0 }];
  const view = seasonalView(FIVE, active(TODAY + 10, 3), history, false, NOON);
  assert.deepEqual(view.days.map((day) => [day.alphaState, day.omegaState]), [
    ["claimed", "locked"], ["claimed", "locked"], ["claimable", "locked"], ["upcoming", "upcoming"], ["upcoming", "upcoming"],
  ]);
  assert.deepEqual([view.claimedCount, view.claimedToday, view.canClaim, view.daysLeft, view.nextClaimAt, view.status], [2, false, true, 10, NOON, "ongoing"]);
  assert.equal(seasonalClaimable(active(TODAY + 10, 3), history, NOON), true);
});

test("claimed today: the next reward waits when the omega track is already claimed", () => {
  const history = [{ ordinal: TODAY - 1, grade: 1 }, { ordinal: TODAY, grade: 1 }];
  const view = seasonalView(FIVE, active(TODAY + 10, 3), history, true, NOON);
  assert.deepEqual(view.days.slice(0, 3).map((day) => [day.alphaState, day.omegaState]), [["claimed", "claimed"], ["claimed", "claimed"], ["next", "next"]]);
  assert.deepEqual([view.canClaim, view.nextClaimAt], [false, Date.UTC(2026, 9, 20, 11)]);
  assert.equal(seasonalClaimable(active(TODAY + 10, 3), history, NOON), false);
});

test("an alpha that upgrades today can claim only its missing omega rewards before the campaign ends", () => {
  const history = [{ ordinal: TODAY - 1, grade: 0 }, { ordinal: TODAY, grade: 0 }];
  const view = seasonalView(FIVE, active(TODAY + 1, 3), history, true, NOON);
  assert.equal(view.canClaim, true);
  assert.equal(view.newDayClaimable, false);
  assert.deepEqual([view.retroClaimable, view.retroCount, view.nextClaimAt, view.status], [true, 2, NOON, "ongoing"]);
  assert.deepEqual(view.days.slice(0, 3).map((day) => [day.alphaState, day.omegaState]), [["claimed", "retro"], ["claimed", "retro"], ["missed", "missed"]]);
  const ineligible = seasonalView({ ...FIVE, retroClaim: false }, active(TODAY + 1, 3), history, true, NOON);
  assert.deepEqual([ineligible.canClaim, ineligible.retroClaimable, ineligible.days[0]!.omegaState], [false, false, "missed"]);
});

test("finishing the alpha track still allows omega catch-up today or on a later day", () => {
  for (const lastDay of [TODAY, TODAY - 1]) {
    const history = [0, 1, 2, 3, 4].map((at) => ({ ordinal: lastDay - 4 + at, grade: 0 }));
    const view = seasonalView(FIVE, active(TODAY + 2, 0), history, true, NOON);
    assert.deepEqual([view.canClaim, view.newDayClaimable, view.retroClaimable, view.retroCount, view.status], [true, false, true, 5, "ongoing"]);
    assert.equal(view.nextClaimAt, NOON);
    const alpha = seasonalView(FIVE, active(TODAY + 2, 0), history, false, NOON);
    assert.equal(alpha.canClaim, false);
    const claimed = seasonalView(FIVE, active(TODAY + 2, 0), history.map((row) => ({ ...row, grade: 1 })), true, NOON);
    assert.deepEqual([claimed.canClaim, claimed.retroCount, claimed.status], [false, 0, "completed"]);
    assert.equal(seasonalClaimable(active(TODAY + 2, 0), history, NOON), false, "unknown definitions do not establish retro eligibility");
  }
});

test("a new day can grant its rewards together with older omega rewards", () => {
  const view = seasonalView(FIVE, active(TODAY + 5, 3), [{ ordinal: TODAY - 2, grade: 1 }, { ordinal: TODAY - 1, grade: 0 }], true, NOON);
  assert.deepEqual([view.canClaim, view.newDayClaimable, view.retroClaimable, view.retroCount], [true, true, true, 1]);
  assert.equal(view.days[2]!.alphaState, "claimable");
});

test("days the campaign's end leaves no room for are missed; at the end it is ending, and every day claimed is completed", () => {
  // Two reward days left (today and tomorrow): days 1 and 2 can still be had, 3 to 5 cannot.
  const ending = seasonalView(FIVE, active(TODAY + 2, 5), [], false, NOON);
  assert.deepEqual(ending.days.map((day) => day.alphaState), ["claimable", "upcoming", "missed", "missed", "missed"]);
  // Claimed today with the last day tomorrow: the next claim is the campaign's end.
  const last = seasonalView(FIVE, active(TODAY + 1, 4), [{ ordinal: TODAY, grade: 0 }], false, NOON);
  assert.deepEqual([last.status, last.days[1]!.alphaState, last.endsAt], ["ending", "missed", Date.UTC(2026, 9, 20, 11)]);
  const all = [0, 1, 2, 3, 4].map((at) => ({ ordinal: TODAY - 5 + at, grade: 1 }));
  assert.equal(seasonalView(FIVE, active(TODAY + 10, 0), all, true, NOON).status, "completed");
});
