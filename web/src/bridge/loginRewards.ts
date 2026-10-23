// The account's daily login campaign, as the retail client's login campaign service has it
// (loginrewards/client/loginCampaignService.py), and the window that shows it (eve/client/script/ui/shared/loginRewards).
//
// THE STATE. sm.RemoteSvc('loginCampaignManager').get_client_campaign_state() (111), asked with nothing, answers None
// for an account in no campaign, or a util.KeyVal of
//
//   static_data     campaign_id, campaign_duration (None for a campaign without end), is_rookie_campaign, and
//                   item_rewards_by_day: a dict of the day (from 1) to a util.KeyVal of typeID, quantity and tier;
//   item_progress   next_reward_index (the day the next claim is of), num_claimed_rewards, and
//                   next_reward_timestamp (a FILETIME: the next claim may be made after it, can_claim_now 189 to 194);
//   bucket_progress which the window does not read.
//
// The window marks a day before the next one claimed (panelControllers.py ShouldShowAsClaimed, 134 to 135). The
// campaign is the ACCOUNT's: every pilot of one account sees the same days, and one claim a day is the account's.
//
// THE CLAIM. claim_reward() (199), with nothing, answers None where nothing may be claimed, or (item_reward,
// item_progress, bucket typeID, bucket_progress): what was given (a util.KeyVal of typeID and quantity) and the
// progress after it. The reward is put in the account's redeem queue, not the hangar.

import { isListValue, readDictPairs, readKeyVal, unwrapBool, unwrapLong, type JsonValue } from "./wire.ts";
import { filetimeToUnixMs } from "./activity.ts";

/** The server's notice that the account's campaign is another (loginCampaignService.py OnCampaignEnrollmentChanged, 84 to 88). */
export const LOGIN_CAMPAIGN_NOTICE = "OnCampaignEnrollmentChanged";

export interface LoginRewardDay {
  readonly day: number;
  readonly typeID: number;
  readonly quantity: number;
  /** The reward's tier (1 to 6); the last day of the server's campaign is a 4. */
  readonly tier: number;
}

export interface LoginCampaign {
  readonly campaignID: number;
  /** How many days it runs; null for a campaign without end. */
  readonly duration: number | null;
  readonly rookie: boolean;
  /** Every day's reward, in order of the day. */
  readonly days: readonly LoginRewardDay[];
  /** The day the next claim is of, from 1. */
  readonly nextDay: number;
  readonly claimedCount: number;
  /** When the next claim may be made, in Unix ms; null where it is not said. */
  readonly nextClaimAt: number | null;
}

export interface LoginClaim {
  /** What was given; null where the answer does not say. */
  readonly reward: { readonly typeID: number; readonly quantity: number } | null;
  readonly nextDay: number | null;
  readonly claimedCount: number | null;
  readonly nextClaimAt: number | null;
}

export type LoginDayState = "claimed" | "claimable" | "next" | "upcoming";

const wholeOf = (value: JsonValue | undefined): number | null => {
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : null;
  const long = unwrapLong(value);
  return long !== null && long >= BigInt(Number.MIN_SAFE_INTEGER) && long <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(long) : null;
};

const msOf = (value: JsonValue | undefined): number | null => filetimeToUnixMs(unwrapLong(value));

/** The progress' three, read off item_progress. */
function progressOf(progress: JsonValue | undefined): { nextDay: number | null; claimedCount: number | null; nextClaimAt: number | null } {
  return {
    nextDay: wholeOf(readKeyVal(progress, "next_reward_index")),
    claimedCount: wholeOf(readKeyVal(progress, "num_claimed_rewards")),
    nextClaimAt: msOf(readKeyVal(progress, "next_reward_timestamp")),
  };
}

/** get_client_campaign_state's answer; null for none, and for an answer that is no campaign. */
export function decodeLoginCampaign(result: JsonValue): LoginCampaign | null {
  const staticData = readKeyVal(result, "static_data");
  const campaignID = wholeOf(readKeyVal(staticData, "campaign_id"));
  if (campaignID === null) return null;
  const days: LoginRewardDay[] = [];
  for (const [key, reward] of readDictPairs(readKeyVal(staticData, "item_rewards_by_day"))) {
    const day = wholeOf(key as JsonValue);
    const typeID = wholeOf(readKeyVal(reward, "typeID"));
    if (day === null || day <= 0 || typeID === null || typeID <= 0) continue;
    days.push({
      day,
      typeID,
      quantity: Math.max(1, wholeOf(readKeyVal(reward, "quantity")) ?? 1),
      tier: Math.max(1, wholeOf(readKeyVal(reward, "tier")) ?? 1),
    });
  }
  days.sort((one, other) => one.day - other.day);
  const progress = progressOf(readKeyVal(result, "item_progress"));
  const duration = wholeOf(readKeyVal(staticData, "campaign_duration"));
  return {
    campaignID,
    duration: duration !== null && duration > 0 ? duration : null,
    rookie: unwrapBool(readKeyVal(staticData, "is_rookie_campaign")) === true,
    days,
    // get_campaign_reward_idx (183 to 187): the first day where the progress says none.
    nextDay: progress.nextDay !== null && progress.nextDay > 0 ? progress.nextDay : 1,
    claimedCount: Math.max(0, progress.claimedCount ?? 0),
    nextClaimAt: progress.nextClaimAt,
  };
}

/** claim_reward's answer; null where nothing was claimed. */
export function decodeLoginClaim(result: JsonValue): LoginClaim | null {
  const items = Array.isArray(result) ? (result as readonly JsonValue[]) : isListValue(result) ? result.items : null;
  if (items === null || items.length < 2) return null;
  const typeID = wholeOf(readKeyVal(items[0], "typeID"));
  const quantity = wholeOf(readKeyVal(items[0], "quantity"));
  return {
    reward: typeID !== null && typeID > 0 ? { typeID, quantity: Math.max(1, quantity ?? 1) } : null,
    ...progressOf(items[1]),
  };
}

/** The campaign after a claim: the progress the claim answered, where it said it. */
export function campaignAfterClaim(campaign: LoginCampaign, claim: LoginClaim): LoginCampaign {
  return {
    ...campaign,
    nextDay: claim.nextDay !== null && claim.nextDay > 0 ? claim.nextDay : campaign.nextDay,
    claimedCount: claim.claimedCount ?? campaign.claimedCount,
    nextClaimAt: claim.nextClaimAt ?? campaign.nextClaimAt,
  };
}

/** can_claim_now (189 to 194): the next claim's time is past. */
export function canClaimNow(campaign: LoginCampaign, nowMs: number): boolean {
  return campaign.nextClaimAt !== null && campaign.nextClaimAt < nowMs;
}

/** A day as the window shows it: claimed before the next one, the next one claimable or waiting, the rest to come. */
export function loginDayState(campaign: LoginCampaign, day: number, nowMs: number): LoginDayState {
  if (day < campaign.nextDay) return "claimed";
  if (day === campaign.nextDay) return canClaimNow(campaign, nowMs) ? "claimable" : "next";
  return "upcoming";
}
