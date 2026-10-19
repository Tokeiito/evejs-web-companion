// The day's claim of the account's daily login campaign, as the client makes it (loginCampaignService.py claim_reward,
// 196 to 212, from the window's Claim):
//
//   sm.RemoteSvc('loginCampaignManager').claim_reward()
//
// with nothing. Answered None where nothing may be claimed (already claimed today), or what was given and the progress
// after it. The reward is put in the account's redeem queue, and the server says so (OnRedeemingQueueUpdated).

import type { Ask } from "./ask.ts";
import { decodeLoginClaim, type LoginClaim } from "./loginRewards.ts";

/** Claims the day's reward; null where the server gave nothing. Fails as the call fails. */
export async function claimLoginReward(act: Ask): Promise<LoginClaim | null> {
  return decodeLoginClaim(await act("loginCampaignManager", "claim_reward", []));
}

/**
 * The day's claim of the account's seasonal campaign (seasonalLoginCampaignService.py claim_reward, 80 to 88):
 * seasonalLoginCampaignManager.claim_reward(), with nothing. Whether the server gave the day's rewards (the alpha one,
 * and for an omega clone the omega one and any it is owed), into the account's redeem queue.
 */
export async function claimSeasonalReward(act: Ask): Promise<boolean> {
  return (await act("seasonalLoginCampaignManager", "claim_reward", [])) === true;
}
