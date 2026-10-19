// The account's seasonal login campaign, as the retail client's seasonal login campaign service has it
// (loginrewards/client/seasonalLoginCampaignService.py), and the two-track window that shows it
// (eve/client/script/ui/shared/loginRewards/twoTrackRewardPanel.py).
//
// FROM THE SERVER, three calls of seasonalLoginCampaignManager, each with nothing:
//
//   get_active_campaign()   (campaign_id, end_date_ordinal, turnover_time_str, num_remaining_rewards): the campaign
//                           on, None where none is; its last day as a date's ordinal (Python's, day 1 the year 1's
//                           first); the day's turnover "HH:MM:SS" in UTC; and how many rewards are left (39 to 51).
//   get_claim_history()     {date ordinal: clone grade}: each day the account claimed, as the grade it claimed as
//                           (0 alpha, 1 omega) (90 to 97).
//   claim_reward()          True or False (80 to 88).
//
// FROM THE CLIENT'S OWN DATA, by the campaign's ID: its name, retroClaim, and each day's alpha and omega reward
// (seasonalCampaignTable.ts, generated from the client's static data). The server says nothing of them.
//
// THE RULES, the client's: a reward day is the UTC date less the turnover (timekeeper.py). The days claimed are the
// history in order of date, the first claim the first reward day whatever its date (get_clone_track_by_day_claimed,
// 220 to 224): every one is claimed on the alpha track, and those claimed as an omega on the omega track. The next day
// may be claimed where the account has not claimed today and has rewards left (can_claim_now, 255 to 262); an omega
// clone of a campaign with retroClaim is given the omega rewards of the days it took as an alpha at its next claim
// (66 to 78). Days past what the campaign's end leaves room for are missed (twoTrackRewardPanel.py 259 to 265).

import { isListValue, readDictPairs, unwrapLong, type JsonValue } from "./wire.ts";

/** One day's reward: [day from 0, typeID, quantity, tier]. */
export type SeasonalReward = readonly [number, number, number, number];

export interface SeasonalCampaignDefinition {
  readonly name: string;
  readonly retroClaim: boolean;
  readonly alpha: readonly SeasonalReward[];
  readonly omega: readonly SeasonalReward[];
}

/** get_active_campaign's answer. */
export interface ActiveSeasonalCampaign {
  readonly campaignID: number;
  /** The campaign's last reward day, as a date's ordinal. */
  readonly endOrdinal: number;
  /** The day's turnover, in minutes after midnight UTC. */
  readonly turnoverMinutes: number;
  /** How many rewards the server says are left. */
  readonly remaining: number;
}

/** A day claimed: its date's ordinal and the clone grade it was claimed as (0 alpha, 1 omega). */
export interface SeasonalClaim {
  readonly ordinal: number;
  readonly grade: number;
}

/** A track's day as the window shows it. `locked` is an omega reward an alpha clone may not take; `retro` one an
 * omega clone is given at its next claim. */
export type SeasonalEntryState = "claimed" | "claimable" | "next" | "retro" | "locked" | "upcoming" | "missed";

export interface SeasonalDay {
  /** The reward day, from 1. */
  readonly day: number;
  readonly alpha: SeasonalReward | null;
  readonly omega: SeasonalReward | null;
  readonly alphaState: SeasonalEntryState;
  readonly omegaState: SeasonalEntryState;
}

export interface SeasonalView {
  readonly campaignID: number;
  readonly name: string;
  readonly days: readonly SeasonalDay[];
  readonly claimedCount: number;
  readonly claimedToday: boolean;
  readonly canClaim: boolean;
  /** Reward days left before the campaign ends, today's included (get_days_remaining, 142 to 143). */
  readonly daysLeft: number;
  /** When the next claim may be made, in Unix ms (now, where it may be made now). */
  readonly nextClaimAt: number;
  /** When the campaign ends (its end date's turnover: get_end_date_with_time, 180 to 181), in Unix ms. */
  readonly endsAt: number;
  readonly status: "ongoing" | "ending" | "completed";
}

/** The Python ordinal of 1970-01-01: day 0 of Unix time. */
const UNIX_EPOCH_ORDINAL = 719163;
const DAY_MS = 86_400_000;

const wholeOf = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : null;
  const long = unwrapLong(value);
  return long !== null && long >= BigInt(Number.MIN_SAFE_INTEGER) && long <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(long) : null;
};

const textOf = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && typeof (value as { value?: unknown }).value === "string") return (value as { value: string }).value;
  return "";
};

/** get_active_campaign's answer; null where no campaign is on, or the answer is none. */
export function decodeActiveSeasonal(result: JsonValue): ActiveSeasonalCampaign | null {
  const items = Array.isArray(result) ? (result as readonly JsonValue[]) : isListValue(result) ? result.items : null;
  if (items === null || items.length < 4) return null;
  const campaignID = wholeOf(items[0]);
  const endOrdinal = wholeOf(items[1]);
  const turnover = /^(\d{1,2}):(\d{2})/.exec(textOf(items[2]));
  if (campaignID === null || campaignID <= 0 || endOrdinal === null || turnover === null) return null;
  return {
    campaignID,
    endOrdinal,
    turnoverMinutes: Number(turnover[1]) * 60 + Number(turnover[2]),
    remaining: Math.max(0, wholeOf(items[3]) ?? 0),
  };
}

/** get_claim_history's answer, in order of date. */
export function decodeClaimHistory(result: JsonValue): readonly SeasonalClaim[] {
  return readDictPairs(result)
    .map(([key, grade]) => ({ ordinal: wholeOf(key), grade: wholeOf(grade) ?? 0 }))
    .filter((claim): claim is SeasonalClaim => claim.ordinal !== null)
    .sort((one, other) => one.ordinal - other.ordinal);
}

/** timekeeper.get_current_reward_date: the UTC date less the turnover, as an ordinal. */
export function rewardOrdinal(nowMs: number, turnoverMinutes: number): number {
  return Math.floor((nowMs - turnoverMinutes * 60_000) / DAY_MS) + UNIX_EPOCH_ORDINAL;
}

/** When a reward day begins, in Unix ms. */
const dayStartMs = (ordinal: number, turnoverMinutes: number): number => (ordinal - UNIX_EPOCH_ORDINAL) * DAY_MS + turnoverMinutes * 60_000;

/** canClaimNow for the rail, which does not need the campaign's rewards: on, not claimed today, rewards left. */
export function seasonalClaimable(active: ActiveSeasonalCampaign, history: readonly SeasonalClaim[], nowMs: number): boolean {
  const today = rewardOrdinal(nowMs, active.turnoverMinutes);
  return active.remaining > 0 && !history.some((claim) => claim.ordinal === today);
}

/** The campaign as the window shows it: each day's two rewards and their states, and where the campaign stands. */
export function seasonalView(
  definition: SeasonalCampaignDefinition,
  active: ActiveSeasonalCampaign,
  history: readonly SeasonalClaim[],
  isOmega: boolean,
  nowMs: number,
): SeasonalView {
  const today = rewardOrdinal(nowMs, active.turnoverMinutes);
  const claimedCount = history.length;
  const claimedToday = history.some((claim) => claim.ordinal === today);
  const omegaClaimed = new Set(history.flatMap((claim, index) => (claim.grade >= 1 ? [index] : [])));
  const total = Math.min(definition.alpha.length, definition.omega.length);
  const alphaOf = new Map(definition.alpha.map((reward) => [reward[0], reward]));
  const omegaOf = new Map(definition.omega.map((reward) => [reward[0], reward]));
  // get_number_of_rewards_days_remaining_and_available (148 to 153).
  const available = Math.max(0, Math.min(active.remaining, active.endOrdinal - (claimedToday ? today + 1 : today)));
  // can_claim_now (255 to 262): not claimed today, and rewards left (user_has_unclaimed_rewards, 201 to 206).
  const canClaim = !claimedToday && (active.remaining > 0 || alphaOf.has(claimedCount) || (isOmega && omegaOf.has(claimedCount)));
  const retroOwed = isOmega && definition.retroClaim && omegaClaimed.size < claimedCount;
  const stateOf = (index: number, claimed: boolean, omegaTrack: boolean): SeasonalEntryState => {
    if (claimed) return "claimed";
    if (omegaTrack && !isOmega && index <= claimedCount) return "locked";
    if (omegaTrack && index < claimedCount) return retroOwed ? "retro" : "missed";
    if (index === claimedCount) return canClaim ? "claimable" : available > 0 ? "next" : "missed";
    return index < claimedCount + available ? "upcoming" : "missed";
  };
  const days: SeasonalDay[] = [];
  for (let index = 0; index < total; index += 1) {
    days.push({
      day: index + 1,
      alpha: alphaOf.get(index) ?? null,
      omega: omegaOf.get(index) ?? null,
      alphaState: stateOf(index, index < claimedCount, false),
      omegaState: stateOf(index, omegaClaimed.has(index), true),
    });
  }
  const endsAt = dayStartMs(active.endOrdinal, active.turnoverMinutes);
  // get_date_when_reward_can_be_claimed (167 to 173): the next turnover once today is claimed.
  const nextClaimAt = claimedToday ? dayStartMs(today + 1, active.turnoverMinutes) : nowMs;
  // get_campaign_status (302 to 309).
  const status = claimedCount >= total && !retroOwed ? "completed" : nextClaimAt >= endsAt ? "ending" : "ongoing";
  return {
    campaignID: active.campaignID,
    name: definition.name,
    days,
    claimedCount,
    claimedToday,
    canClaim,
    daysLeft: Math.max(0, active.endOrdinal - today),
    nextClaimAt,
    endsAt,
    status,
  };
}
