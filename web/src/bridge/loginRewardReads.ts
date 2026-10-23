// The account's daily login campaign, read by the page itself (bridge/loginRewards.ts decodes it).
//
// THE CALL, as the client makes it:
//
//   loginCampaignManager.get_client_campaign_state()   loginCampaignService.py 111: by the service's name, with
//                                                      nothing. None where the account is in no campaign.
//
// The client asks it once and keeps it, until a claim answers the progress after it or the server says the account's
// campaign is another (OnCampaignEnrollmentChanged, 84 to 88). The page reads it as the pilot comes online and at
// that notice (app/flow.ts).
//
// THROUGH THE WEB GATEWAY the call is not carried: its list has nothing of the login campaign manager's. Then there is
// no campaign to be had, and this says none.

import { failureCode, type Ask } from "./ask.ts";
import type { JsonValue } from "./wire.ts";
import { decodeActiveSeasonal, decodeClaimHistory, type ActiveSeasonalCampaign, type SeasonalClaim } from "./seasonalCampaigns.ts";

/** The account's campaign as the server answers it, or null where there is none or the transport does not carry the call. */
export async function readLoginCampaign(ask: Ask): Promise<JsonValue> {
  try {
    return await ask("loginCampaignManager", "get_client_campaign_state", []);
  } catch (error) {
    if (failureCode(error) === "CALL_NOT_ALLOWED") return null;
    throw error;
  }
}

/**
 * The account's seasonal campaign, as the client's seasonal campaign service reads it (seasonalLoginCampaignService.py
 * 39 to 51, 90 to 97): seasonalLoginCampaignManager.get_active_campaign(), and where a campaign is on, its
 * get_claim_history(), each with nothing. null where none is on or the transport does not carry the calls.
 */
export async function readSeasonalCampaign(ask: Ask): Promise<{ readonly active: ActiveSeasonalCampaign; readonly history: readonly SeasonalClaim[] } | null> {
  try {
    const active = decodeActiveSeasonal(await ask("seasonalLoginCampaignManager", "get_active_campaign", []));
    if (active === null) return null;
    return { active, history: decodeClaimHistory(await ask("seasonalLoginCampaignManager", "get_claim_history", [])) };
  } catch (error) {
    if (failureCode(error) === "CALL_NOT_ALLOWED") return null;
    throw error;
  }
}
