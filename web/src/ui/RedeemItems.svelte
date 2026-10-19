<script lang="ts">
  // Redeem Items: the retail client's redeem window (eve/client/script/ui/shared/redeem/redeemItemsContainer.py) for
  // the pilot. The account's tokens listed with what each gives, selected one by one or all (Select All, 713), and
  // two ways to redeem the selection (StationSection, 600 to 685): Redeem to Current Station, where the pilot is
  // docked (and only docked: is_enabled, 613 to 614), and Redeem to Home Station. A pure reader of the store; the
  // read and the claim live in app/flow.ts (loadRedeemTokens, redeemTokens).
  //
  // The tokens are the ACCOUNT's: every pilot of one account has the same list, and redeems it for itself.
  //
  // The client asks "are you sure" before a claim (redeem.confirm_redeem). The page does not: each button says
  // where the items go, and pressing it is the choice.
  import { onMount } from "svelte";
  import { isSessionLost } from "../app/flow.ts";
  import { deriveDocked } from "./tabs.ts";
  import TypeIcon from "./TypeIcon.svelte";
  import { resolvedName } from "../store/names.ts";
  import { panelErrorWords } from "../bridge/refusals.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type { RedeemOutcome, RedeemToken } from "../bridge/redeem.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // svelte-ignore state_referenced_locally
  const redeem = store.redeem;
  // svelte-ignore state_referenced_locally
  const station = store.station;
  // svelte-ignore state_referenced_locally
  const flight = store.flight;
  // svelte-ignore state_referenced_locally
  const names = store.names;

  let busy = $state(false);
  let error = $state("");
  let report = $state("");
  let homeStationID = $state<number | null>(null);
  /** The selected tokens, by tokenID. A token gone from the list is no longer selected. */
  let selected = $state<ReadonlySet<number>>(new Set());

  const tokens = $derived($redeem.tokens ?? []);
  const chosen = $derived(tokens.filter((token) => selected.has(token.tokenID)));
  const isDocked = $derived(deriveDocked($flight.status, $station.online));
  const dockedAt = $derived(isDocked
    ? ($flight.status?.structureID ?? $flight.status?.stationID ?? $station.online?.structureID ?? $station.online?.stationID ?? null)
    : null);

  $effect(() => {
    const here = new Set(tokens.map((token) => token.tokenID));
    if ([...selected].some((id) => !here.has(id))) selected = new Set([...selected].filter((id) => here.has(id)));
  });

  async function run(action: () => Promise<void>): Promise<void> {
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
    void run(async () => {
      const [, home] = await Promise.all([flow.loadRedeemTokens(), flow.redeemHomeStation()]);
      homeStationID = home;
    });
  });

  function toggle(token: RedeemToken): void {
    const next = new Set(selected);
    if (next.has(token.tokenID)) next.delete(token.tokenID);
    else next.add(token.tokenID);
    selected = next;
  }

  function selectAll(): void {
    selected = selected.size === tokens.length ? new Set() : new Set(tokens.map((token) => token.tokenID));
  }

  function stationName(id: number | null): string {
    if (id === null) return "Unknown station";
    if ($station.station?.stationID === id) return $station.station.stationName;
    return resolvedName($names.resolved, "station", id, "Unknown station");
  }

  function typeName(token: RedeemToken): string {
    return resolvedName($names.resolved, "type", token.typeID, "an unnamed item");
  }

  /** What a claim did, in a line: what was redeemed, and each token that was not, by its item. */
  function reportOf(outcome: RedeemOutcome, sent: readonly RedeemToken[]): string {
    const refused = outcome.errors.map((failure) => {
      const token = sent.find((candidate) => candidate.tokenID === failure.tokenID);
      return `${token ? typeName(token) : "an item"} (${failure.message || "refused"})`;
    });
    const done = sent.length - refused.length;
    const where = outcome.itemsCreated > 0 && outcome.stationID !== null ? ` to ${stationName(outcome.stationID)}` : "";
    const lines = [done > 0 ? `Redeemed ${done} of ${sent.length}${where}.` : "Nothing was redeemed."];
    if (refused.length > 0) lines.push(`Not redeemed: ${refused.join(", ")}.`);
    return lines.join(" ");
  }

  function claim(useHomeStation: boolean): void {
    const sent = chosen;
    if (sent.length === 0) {
      error = "Select something to redeem first.";
      return;
    }
    report = "";
    void run(async () => {
      const outcome = await flow.redeemTokens(sent, useHomeStation);
      report = reportOf(outcome, sent);
    });
  }

  function expiresText(token: RedeemToken): string {
    if (token.expiresAt === null) return "No expiry";
    const days = Math.floor((token.expiresAt - Date.now()) / 86_400_000);
    if (days < 1) return "Expires today";
    return `Expires in ${days} d`;
  }
</script>

<section class="panel redeem">
  <header class="panel-head">
    <h2 class="panel-title">Redeem Items</h2>
    <span class="controls">
      <button type="button" disabled={busy} onclick={() => void run(() => flow.loadRedeemTokens())}>Refresh</button>
    </span>
  </header>

  {#if error}
    <p class="error">{error}</p>
  {/if}
  {#if $redeem.error}
    <p class="error">{$redeem.error}</p>
  {/if}
  {#if report}
    <p class="report">{report}</p>
  {/if}

  {#if $redeem.tokens === null}
    <p class="empty">{$redeem.error ? "" : busy ? "Reading what you may redeem…" : "Redeeming is not available for this pilot."}</p>
  {:else if tokens.length === 0}
    <p class="empty">Nothing to redeem. Rewards and gifts for this account show up here.</p>
  {:else}
    <div class="bar">
      <span>{chosen.length} of {tokens.length} selected</span>
      <button type="button" disabled={busy} onclick={selectAll}>{selected.size === tokens.length ? "Select none" : "Select all"}</button>
    </div>
    <ul class="tokens">
      {#each tokens as token (token.tokenID)}
        <li>
          <label class="token" class:on={selected.has(token.tokenID)}>
            <input type="checkbox" checked={selected.has(token.tokenID)} disabled={busy} onchange={() => toggle(token)} />
            <TypeIcon typeID={token.typeID} name={typeName(token)} size="md" />
            <span class="what">
              <span class="name">{typeName(token)} x{token.quantity.toLocaleString()}{token.blueprintRuns > 0 ? ` (${token.blueprintRuns} runs)` : ""}</span>
              {#if token.label || token.description}
                <span class="label">{token.label || token.description}</span>
              {/if}
            </span>
            <span class="expires">{expiresText(token)}</span>
          </label>
        </li>
      {/each}
    </ul>
    <div class="destinations">
      <button type="button" class="primary" disabled={busy || chosen.length === 0 || dockedAt === null} onclick={() => claim(false)}>
        <span class="head">Redeem to current station</span>
        <span class="where" class:warn={dockedAt === null}>{dockedAt === null ? "Not docked" : stationName(dockedAt)}</span>
      </button>
      <button type="button" disabled={busy || chosen.length === 0} onclick={() => claim(true)}>
        <span class="head">Redeem to home station</span>
        <span class="where">{homeStationID === null ? "Your home station" : stationName(homeStationID)}</span>
      </button>
    </div>
  {/if}
</section>

<style>
  .bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0;
    color: var(--color-muted);
  }
  ul.tokens {
    list-style: none;
    margin: 0 0 0.75rem 0;
    padding: 0;
  }
  .token {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.5rem;
    min-height: 40px;
    padding: 0.35rem 0.5rem;
    border-bottom: 1px solid var(--color-row-line);
    cursor: pointer;
  }
  .token:hover,
  .token.on {
    background: rgba(128, 128, 128, 0.12);
  }
  .what {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .name,
  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .label,
  .expires {
    color: var(--color-muted);
    font-size: 0.85em;
  }
  /* The two ways to redeem stay in sight at the window's foot however long the list is: the window's body is what
     scrolls, and the list scrolls under them. */
  .destinations {
    position: sticky;
    bottom: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: 0.5rem;
    padding: 0.4rem 0;
    background: var(--color-panel);
  }
  .destinations button {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    text-align: left;
    padding: 0.4rem 0.6rem;
  }
  .destinations button.primary:not(:disabled) {
    background: var(--color-accent);
    color: var(--color-on-accent);
  }
  .where {
    font-size: 0.85em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
  .where.warn {
    color: var(--color-warn);
  }
  .report {
    color: var(--color-good);
  }
</style>
