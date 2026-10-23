<script lang="ts">
  // Daily Login Rewards: the retail client's login rewards window (eve/client/script/ui/shared/loginRewards), its tabs
  // the account's campaigns as the server has them on (loginRewardsWnd.py RewardsContainer, 97 to 170):
  //
  //   the daily campaign (loginCampaignService.py; rookieRewardPanel.py and evergreenRewardPanel.py, one track): its
  //   days in a row, each with its reward: the days before the next one claimed, the next one claimable once its time
  //   is past (can_claim_now) and the rest to come; the next day's reward large, with Claim, or the time left.
  //
  //   a seasonal campaign (seasonalLoginCampaignService.py; twoTrackRewardPanel.py, two tracks), named as the client's
  //   data names it: each day a tile with its alpha reward above its omega one, in the states the client gives them
  //   (bridge/seasonalCampaigns.ts); the day's rewards with Claim, or the time left; and what is left of the campaign.
  //
  // The seasonal tab is chosen first where it may be claimed, as the client chooses it (164 to 170). A pure reader of
  // the store; the reads and the claims live in app/flow.ts (loadLoginRewards, claimLoginReward, claimSeasonalReward).
  //
  // The campaigns are the ACCOUNT's: one claim a day for every pilot of it. The rewards go to the account's redeem
  // queue, not the hangar. The client opens this window by itself at login when a reward may be claimed; the page
  // does not (with several pilots that is one window each), and the rail shows a mark instead.
  import { onMount } from "svelte";
  import { isSessionLost } from "../app/flow.ts";
  import TypeIcon from "./TypeIcon.svelte";
  import { resolvedName } from "../store/names.ts";
  import { panelErrorWords } from "../bridge/refusals.ts";
  import { canClaimNow, loginDayState, type LoginRewardDay } from "../bridge/loginRewards.ts";
  import { seasonalClaimable, seasonalView, type SeasonalEntryState, type SeasonalReward } from "../bridge/seasonalCampaigns.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // svelte-ignore state_referenced_locally
  const rewards = store.loginRewards;
  // svelte-ignore state_referenced_locally
  const names = store.names;
  // svelte-ignore state_referenced_locally
  const station = store.station;

  let busy = $state(false);
  let error = $state("");
  let report = $state("");
  let nowMs = $state(Date.now());
  /** The tab on show; null until the reads say which there are. */
  let chosen = $state<"daily" | "seasonal" | null>(null);

  const campaign = $derived($rewards.campaign);
  const nextReward = $derived(campaign?.days.find((day) => day.day === campaign.nextDay) ?? null);
  const claimable = $derived(campaign !== null && canClaimNow(campaign, nowMs));
  const seasonal = $derived($rewards.seasonal);
  // The clone grade where the transport carries it; where it does not, what goes by it is as for an omega clone
  // (bridge/cloneGrade.ts).
  const isOmega = $derived($station.cloneGrade !== 0);
  const view = $derived(seasonal !== null && seasonal.definition !== null
    ? seasonalView(seasonal.definition, seasonal.active, seasonal.history, isOmega, nowMs)
    : null);
  const seasonalCanClaim = $derived(view !== null ? view.canClaim : seasonal !== null && seasonalClaimable(seasonal.active, seasonal.history, nowMs));
  const tabs = $derived([...(campaign !== null ? ["daily" as const] : []), ...(seasonal !== null ? ["seasonal" as const] : [])]);
  const tab = $derived(chosen !== null && tabs.includes(chosen) ? chosen : seasonalCanClaim ? "seasonal" : tabs[0] ?? null);
  const seasonalName = $derived(seasonal?.definition?.name || "Seasonal rewards");
  const today = $derived(view?.days[view.claimedCount] ?? null);
  const catchUpOnly = $derived(view !== null && view.retroClaimable && !view.newDayClaimable);

  async function run(action: () => Promise<unknown>): Promise<void> {
    busy = true;
    error = "";
    try {
      await action();
    } catch (cause) {
      if (isSessionLost(cause)) return;
      error = panelErrorWords(cause);
    } finally {
      busy = false;
    }
  }

  onMount(() => {
    void run(() => flow.loadLoginRewards());
    // The time left, and the moment the next reward may be claimed, as the clock goes on.
    const handle = setInterval(() => { nowMs = Date.now(); }, 15_000);
    return () => clearInterval(handle);
  });

  function typeName(typeID: number): string {
    return resolvedName($names.resolved, "type", typeID, "an unnamed item");
  }

  function rewardText(day: LoginRewardDay): string {
    return `${typeName(day.typeID)} x${day.quantity.toLocaleString()}`;
  }

  function seasonalText(reward: SeasonalReward | null): string {
    return reward === null ? "nothing" : `${typeName(reward[1])} x${reward[2].toLocaleString()}`;
  }

  /** The time until `at`, in hours and minutes. */
  function leftText(at: number): string {
    const minutes = Math.max(1, Math.ceil((at - nowMs) / 60_000));
    return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} m` : `${minutes} m`;
  }

  /** The time until the next claim, and the EVE time it comes at. */
  function waitText(at: number | null): string {
    if (at === null) return "The next reward's time is not known.";
    return `Next reward in ${leftText(at)} (${new Date(at).toISOString().slice(11, 16)} EVE).`;
  }

  const STATE_WORDS: Readonly<Record<SeasonalEntryState, string>> = {
    claimed: "claimed", claimable: "ready to claim", next: "next", retro: "given at your next claim",
    locked: "omega clones only", upcoming: "to come", missed: "missed",
  };

  function claimDaily(): void {
    report = "";
    void run(async () => {
      await flow.claimLoginReward();
      nowMs = Date.now();
    });
  }

  function claimSeasonal(): void {
    report = "";
    const day = view?.newDayClaimable ? view.claimedCount + 1 : null;
    const retroCount = view?.retroCount ?? 0;
    void run(async () => {
      await flow.claimSeasonalReward();
      nowMs = Date.now();
      const earlier = `${retroCount} earlier Omega reward${retroCount === 1 ? "" : "s"}`;
      const granted = day !== null ? `day ${day}'s rewards${retroCount > 0 ? ` and ${earlier}` : ""}`
        : retroCount > 0 ? earlier : "the available seasonal rewards";
      report = `Claimed ${granted}. They are in your redeem queue.`;
    });
  }
</script>

<section class="panel login-rewards">
  <header class="panel-head">
    <h2 class="panel-title">Daily Login Rewards</h2>
    <span class="controls">
      <button type="button" disabled={busy} onclick={() => void run(() => flow.loadLoginRewards())}>Refresh</button>
    </span>
  </header>

  {#if error}
    <p class="error">{error}</p>
  {/if}
  {#if $rewards.error}
    <p class="error">{$rewards.error}</p>
  {/if}

  {#if tabs.length > 1}
    <div class="tabs" role="tablist">
      <button type="button" role="tab" aria-selected={tab === "daily"} class:on={tab === "daily"} onclick={() => { chosen = "daily"; }}>
        Daily Login Rewards{#if claimable}<span class="dot" aria-label="a reward is ready"></span>{/if}
      </button>
      <button type="button" role="tab" aria-selected={tab === "seasonal"} class:on={tab === "seasonal"} onclick={() => { chosen = "seasonal"; }}>
        {seasonalName}{#if seasonalCanClaim}<span class="dot" aria-label="a reward is ready"></span>{/if}
      </button>
    </div>
  {/if}

  {#if !$rewards.loaded}
    <p class="empty">Reading your daily login rewards...</p>
  {:else if tab === null}
    <p class="empty">This account has no login rewards on.</p>
  {:else if tab === "daily" && campaign !== null}
    <p class="sub">Day {campaign.nextDay} of {campaign.days.length}. One reward a day for the whole account; it goes to your redeem queue.</p>
    <ol class="track">
      {#each campaign.days as day (day.day)}
        {@const state = loginDayState(campaign, day.day, nowMs)}
        <li class="day is-{state}" class:top-tier={day.tier >= 4} title={`Day ${day.day}: ${rewardText(day)}`} aria-label={`Day ${day.day}, ${state}: ${rewardText(day)}`}>
          <span class="num">{day.day}</span>
          <TypeIcon typeID={day.typeID} name={typeName(day.typeID)} size="sm" />
          {#if state === "claimed"}
            <svg class="tick" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" /></svg>
          {/if}
        </li>
      {/each}
    </ol>

    {#if nextReward}
      <div class="next-reward">
        <TypeIcon typeID={nextReward.typeID} name={typeName(nextReward.typeID)} size="md" />
        <span class="what">
          <span class="name">{rewardText(nextReward)}</span>
          <span class="when">{claimable ? `Day ${nextReward.day}'s reward is ready.` : waitText(campaign.nextClaimAt)}</span>
        </span>
        <button type="button" class="primary" disabled={busy || !claimable} onclick={claimDaily}>Claim</button>
      </div>
    {/if}
    {#if $rewards.lastClaim}
      <p class="report">Claimed {typeName($rewards.lastClaim.typeID)} x{$rewards.lastClaim.quantity.toLocaleString()}. It is in your redeem queue.</p>
    {/if}
  {:else if tab === "seasonal" && seasonal !== null}
    {#if view === null}
      <!-- A campaign this client build's data has not: what it gives cannot be shown, but it can be claimed. -->
      <p class="sub">The server has campaign {seasonal.active.campaignID} on, which this companion's copy of the client's data does not describe. Claimed {seasonal.history.length} so far.</p>
      <div class="next-reward">
        <span class="what"><span class="when">{seasonalCanClaim ? "Today's reward is ready." : "Today's reward has been claimed."}</span></span>
        <button type="button" class="primary" disabled={busy || !seasonalCanClaim} onclick={claimSeasonal}>Claim</button>
      </div>
    {:else}
      <p class="sub">
        {#if view.status === "completed"}
          Every reward of this campaign has been claimed.
        {:else if view.status === "ending"}
          The campaign ends before the next reward.
        {:else if view.daysLeft > 1}
          {view.daysLeft} days left. Claimed {view.claimedCount} of {view.days.length}.
        {:else}
          {leftText(view.endsAt)} left. Claimed {view.claimedCount} of {view.days.length}.
        {/if}
        {isOmega ? "" : "Omega clones also get the lower row."}
      </p>
      <ol class="track seasonal">
        {#each view.days as day (day.day)}
          <li class="day" class:current={day.day === view.claimedCount + 1} title={`Day ${day.day}: alpha ${seasonalText(day.alpha)} (${STATE_WORDS[day.alphaState]}); omega ${seasonalText(day.omega)} (${STATE_WORDS[day.omegaState]})`}>
            <span class="num">{day.day}</span>
            <span class="entry is-{day.alphaState}" class:top-tier={(day.alpha?.[3] ?? 0) >= 4}>
              {#if day.alpha}<TypeIcon typeID={day.alpha[1]} name={typeName(day.alpha[1])} size="sm" />{/if}
              {#if day.alphaState === "claimed"}<svg class="tick" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" /></svg>{/if}
            </span>
            <span class="entry is-{day.omegaState}" class:top-tier={(day.omega?.[3] ?? 0) >= 4}>
              {#if day.omega}<TypeIcon typeID={day.omega[1]} name={typeName(day.omega[1])} size="sm" />{/if}
              {#if day.omegaState === "claimed"}<svg class="tick" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" /></svg>{/if}
              {#if day.omegaState === "locked"}<svg class="lock" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 7h8v7H4zM6 7V5a2 2 0 0 1 4 0v2" /></svg>{/if}
            </span>
          </li>
        {/each}
      </ol>
      {#if catchUpOnly}
        <div class="next-reward">
          <span class="what">
            <span class="name">{view.retroCount} earlier Omega reward{view.retroCount === 1 ? "" : "s"} ready to claim.</span>
            <span class="when">These complete the Omega rewards of days already claimed as Alpha.</span>
          </span>
          <button type="button" class="primary" disabled={busy || !view.canClaim} onclick={claimSeasonal}>Claim Omega rewards</button>
        </div>
      {:else if today && view.status !== "completed"}
        <div class="next-reward">
          <span class="what">
            <span class="name">Day {today.day}: {seasonalText(today.alpha)}</span>
            <span class="when">Omega: {seasonalText(today.omega)}{isOmega ? "" : " (omega clones only)"}</span>
            {#if view.retroCount > 0}<span class="when">Also includes {view.retroCount} earlier Omega reward{view.retroCount === 1 ? "" : "s"}.</span>{/if}
            <span class="when">{view.canClaim ? "Ready to claim." : view.status === "ending" ? "The campaign ends before it." : waitText(view.nextClaimAt)}</span>
          </span>
          <button type="button" class="primary" disabled={busy || !view.canClaim} onclick={claimSeasonal}>Claim</button>
        </div>
      {/if}
    {/if}
    {#if report}
      <p class="report">{report}</p>
    {/if}
  {/if}
</section>

<style>
  .sub {
    color: var(--color-muted);
    margin: 0 0 0.5rem 0;
  }
  .tabs {
    display: flex;
    border-bottom: 1px solid var(--color-line);
    margin: 0 0 0.5rem 0;
  }
  .tabs button {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    background: none;
    border: 0;
    border-right: 1px solid var(--color-line);
    color: var(--color-muted);
    padding: 0.35rem 0.75rem;
  }
  .tabs button.on {
    color: var(--color-text-bright);
    background: rgba(128, 128, 128, 0.12);
  }
  .dot {
    width: 0.45rem;
    height: 0.45rem;
    background: var(--color-accent);
  }
  ol.track {
    list-style: none;
    margin: 0 0 0.75rem 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(3rem, 1fr));
    gap: 0.3rem;
  }
  .day {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
    padding: 0.25rem 0;
    border: 1px solid var(--color-line);
    color: var(--color-muted);
  }
  .day.is-claimed {
    opacity: 0.6;
  }
  .day.is-claimable,
  .day.is-next,
  .seasonal .day.current {
    border: 2px solid var(--color-accent);
    color: var(--color-text-bright);
  }
  .day.top-tier {
    border-color: var(--color-warn);
  }
  .entry {
    position: relative;
    display: inline-flex;
    border: 1px solid transparent;
  }
  /* A day's state goes by "is-" so that it is never one of this window's own classes: a day that was "next" took
     the next reward's box as its own. */
  .entry.is-claimed,
  .entry.is-locked {
    opacity: 0.55;
  }
  .entry.is-missed {
    opacity: 0.3;
    filter: grayscale(1);
  }
  .entry.is-retro {
    border-color: var(--color-good);
  }
  .entry.top-tier {
    border-color: var(--color-warn);
  }
  .num {
    font-size: 0.75rem;
  }
  .tick,
  .lock {
    position: absolute;
    right: -3px;
    bottom: -3px;
    width: 0.8rem;
    height: 0.8rem;
    fill: none;
    stroke-width: 2.2;
  }
  .tick {
    stroke: var(--color-good);
  }
  .lock {
    stroke: var(--color-warn);
  }
  .day > .tick {
    right: 2px;
    bottom: 2px;
  }
  .next-reward {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem;
    border: 1px solid var(--color-line-strong);
  }
  .next-reward > .what:first-child {
    grid-column: 1 / 3;
  }
  .what {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .name {
    color: var(--color-text-bright);
  }
  .when {
    color: var(--color-muted);
    font-size: 0.85em;
  }
  button.primary:not(:disabled) {
    background: var(--color-accent);
    color: var(--color-on-accent);
  }
  .report {
    color: var(--color-good);
  }
</style>
