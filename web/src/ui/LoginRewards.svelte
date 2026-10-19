<script lang="ts">
  // Daily Login Rewards: the retail client's login rewards window for the account's campaign
  // (eve/client/script/ui/shared/loginRewards: rookieRewardPanel.py and evergreenRewardPanel.py, one track). The
  // campaign's days in a row, each with its reward: the days before the next one claimed, the next one claimable once
  // its time is past (can_claim_now) and the rest to come; the next day's reward large, with Claim, or the time left
  // until it may be claimed. A pure reader of the store; the read and the claim live in app/flow.ts
  // (loadLoginRewards, claimLoginReward).
  //
  // The campaign is the ACCOUNT's: one claim a day for every pilot of it. The reward goes to the account's redeem
  // queue, not the hangar. The client opens this window by itself at login when a reward may be claimed; the page
  // does not (with several pilots that is one window each), and the rail shows a mark instead.
  import { onMount } from "svelte";
  import { isSessionLost } from "../app/flow.ts";
  import TypeIcon from "./TypeIcon.svelte";
  import { resolvedName } from "../store/names.ts";
  import { panelErrorWords } from "../bridge/refusals.ts";
  import { canClaimNow, loginDayState, type LoginRewardDay } from "../bridge/loginRewards.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // svelte-ignore state_referenced_locally
  const rewards = store.loginRewards;
  // svelte-ignore state_referenced_locally
  const names = store.names;

  let busy = $state(false);
  let error = $state("");
  let nowMs = $state(Date.now());

  const campaign = $derived($rewards.campaign);
  const nextReward = $derived(campaign?.days.find((day) => day.day === campaign.nextDay) ?? null);
  const claimable = $derived(campaign !== null && canClaimNow(campaign, nowMs));

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

  /** The time until the next claim, in hours and minutes; and the EVE time it comes at. */
  function waitText(at: number | null): string {
    if (at === null) return "The next reward's time is not known.";
    const minutes = Math.max(1, Math.ceil((at - nowMs) / 60_000));
    const clock = new Date(at).toISOString().slice(11, 16);
    const left = minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} m` : `${minutes} m`;
    return `Next reward in ${left} (${clock} EVE).`;
  }

  function claim(): void {
    void run(async () => {
      await flow.claimLoginReward();
      nowMs = Date.now();
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

  {#if !$rewards.loaded}
    <p class="empty">Reading your daily login rewards...</p>
  {:else if campaign === null}
    <p class="empty">This account has no daily login rewards.</p>
  {:else}
    <p class="sub">Day {campaign.nextDay} of {campaign.days.length}. One reward a day for the whole account; it goes to your redeem queue.</p>
    <ol class="track">
      {#each campaign.days as day (day.day)}
        {@const state = loginDayState(campaign, day.day, nowMs)}
        <li class="day {state}" class:top-tier={day.tier >= 4} title={`Day ${day.day}: ${rewardText(day)}`} aria-label={`Day ${day.day}, ${state}: ${rewardText(day)}`}>
          <span class="num">{day.day}</span>
          <TypeIcon typeID={day.typeID} name={typeName(day.typeID)} size="sm" />
          {#if state === "claimed"}
            <svg class="tick" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" /></svg>
          {/if}
        </li>
      {/each}
    </ol>

    {#if nextReward}
      <div class="next">
        <TypeIcon typeID={nextReward.typeID} name={typeName(nextReward.typeID)} size="md" />
        <span class="what">
          <span class="name">{rewardText(nextReward)}</span>
          <span class="when">{claimable ? `Day ${nextReward.day}'s reward is ready.` : waitText(campaign.nextClaimAt)}</span>
        </span>
        <button type="button" class="primary" disabled={busy || !claimable} onclick={claim}>Claim</button>
      </div>
    {/if}
    {#if $rewards.lastClaim}
      <p class="report">Claimed {typeName($rewards.lastClaim.typeID)} x{$rewards.lastClaim.quantity.toLocaleString()}. It is in your redeem queue.</p>
    {/if}
  {/if}
</section>

<style>
  .sub {
    color: var(--color-muted);
    margin: 0 0 0.5rem 0;
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
  .day.claimed {
    opacity: 0.6;
  }
  .day.claimable,
  .day.next {
    border: 2px solid var(--color-accent);
    color: var(--color-text-bright);
  }
  .day.top-tier {
    border-color: var(--color-warn);
  }
  .num {
    font-size: 0.75rem;
  }
  .tick {
    position: absolute;
    right: 2px;
    bottom: 2px;
    width: 0.8rem;
    height: 0.8rem;
    fill: none;
    stroke: var(--color-good);
    stroke-width: 2.2;
  }
  .next {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem;
    border: 1px solid var(--color-line-strong);
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
