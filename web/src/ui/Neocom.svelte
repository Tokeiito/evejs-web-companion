<script lang="ts">
  // The Neocom (goal R74) — the persistent launcher rail down the left, present
  // in BOTH states, now as EVE's narrow ICON strip rather than a column of text
  // buttons.
  //
  // It lists the panels openable in the current state; clicking one opens it as a
  // window on the desktop, or brings it to the front if it is already open. Open
  // panels stay highlighted so the rail doubles as a "what is on my desktop" map,
  // and the front-most window is marked current. The two fixed-chrome panels
  // (Station / Overview) are not launched here — they live in the top-right dock.
  //
  // ⚠ THE GLYPH IS NEVER THE ONLY LABEL. Every button carries the panel's real
  // name as its accessible name AND its tooltip, so a screen reader and a hover
  // both get words. The rail is an accelerator for someone who has learnt it, not
  // a puzzle for someone who has not.
  //
  // WHAT IT GAINED BESIDES ICONS: the pilot's portrait plate at the top, and the
  // two readouts every EVE player keeps one eye on — the wallet balance and EVE
  // time — pinned at the bottom. Both are GLANCES that link to the real thing:
  // the balance opens the Wallet panel, where the exact, bigint-safe figure
  // lives.
  import { launchableTabsFor, type TabID } from "./tabs.ts";
  import { isWindowTab } from "./desktop.ts";
  import { NEOCOM_GLYPHS, eveClock, portraitInitials, shortIsk } from "./neocomIcons.ts";
  import { formatIsk } from "./isk.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let {
    store,
    flow = null,
    isDocked,
    openIds,
    focusedId,
    onSelect,
  }: {
    /** Required: the rail reads the pilot and the wallet from it. */
    store: ClientStore;
    /**
     * Null renders the rail without its own reads (tests, embeddings). Every
     * real mount passes the session's flow — without it the wallet readout can
     * only ever show a dash, because nothing else pulls the balance until the
     * player happens to open the Wallet panel.
     */
    flow?: AppFlow | null;
    isDocked: boolean;
    openIds: Set<TabID>;
    focusedId: TabID | null;
    onSelect: (id: TabID) => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  const station = store.station;
  // svelte-ignore state_referenced_locally
  const wallet = store.wallet;

  // Contextual panels (Show Info) are deliberately absent: they open on the thing
  // you clicked, so a rail entry could only ever open one onto nothing.
  const tabs = $derived(launchableTabsFor(isDocked).filter((tab) => isWindowTab(tab.id)));

  const pilotName = $derived($station.online?.characterName ?? null);
  const initials = $derived(portraitInitials(pilotName));
  const balance = $derived($wallet.cashBalance ?? null);

  /**
   * EVE time, re-read on a timer.
   *
   * ⚠ THE STATE IS THE FORMATTED STRING, NOT THE DATE. The rail shows HH:MM, so a
   * per-second `Date` in `$state` would re-render the whole Neocom sixty times
   * for every one time the display could possibly change. Assigning the string
   * instead means the signal only actually changes on the minute, and Svelte's
   * equality check drops the other fifty-nine.
   */
  let clock = $state(eveClock(new Date()));
  $effect(() => {
    const tick = (): void => {
      clock = eveClock(new Date());
    };
    tick();
    const handle = setInterval(tick, 1000);
    return () => clearInterval(handle);
  });

  /**
   * Pull the wallet once so the rail has a balance to show.
   *
   * The rail is mounted for the whole session, and before this nothing read the
   * wallet until the player opened the Wallet panel — so the readout would have
   * sat at a dash for anyone who never opened it, which is worse than not having
   * it. Fire-and-forget: a failed read leaves the dash, which is the honest
   * answer, and never disturbs the rail.
   */
  let walletAsked = false;
  $effect(() => {
    if (!flow || walletAsked || $station.online == null) {
      return;
    }
    walletAsked = true;
    void flow.loadWallet().catch(() => {});
  });
</script>

<nav class="neocom" aria-label="Panels">
  <!-- The pilot plate. There is no portrait IMAGE to show — nothing in this
       client, the BFF or the gateway serves one — so the initials plate is the
       only state rather than a fallback, and is styled as a deliberate plate for
       exactly that reason (the same call R27's icon tile makes). -->
  <div class="neocom-pilot" title={pilotName ?? "No pilot online"}>
    <span class="neocom-portrait" aria-hidden="true">{initials}</span>
    <span class="neocom-pilot-name">{pilotName ?? "—"}</span>
  </div>

  <ul class="neocom-list">
    {#each tabs as tab (tab.id)}
      <li>
        <button
          type="button"
          class="neocom-item"
          class:open={openIds.has(tab.id)}
          class:active={focusedId === tab.id}
          aria-pressed={openIds.has(tab.id)}
          title={tab.label}
          aria-label={tab.label}
          onclick={() => onSelect(tab.id)}
        >
          <svg class="neocom-glyph" viewBox="0 0 24 24" aria-hidden="true">
            {#each NEOCOM_GLYPHS[tab.id] as d (d)}
              <path {d} />
            {/each}
          </svg>
          <!-- The name, shown when the rail is wide enough for it (and always to
               a screen reader via aria-label above). Below the desktop
               breakpoint the rail becomes a horizontal strip and these are what
               keep it usable on a phone. -->
          <span class="neocom-item-label">{tab.label}</span>
        </button>
      </li>
    {/each}
  </ul>

  <!-- The two readouts every EVE player keeps half an eye on. -->
  <div class="neocom-readouts">
    <button
      type="button"
      class="neocom-readout neocom-wallet"
      title={`Wallet — ${formatIsk(balance)}`}
      aria-label={`Wallet, ${formatIsk(balance)}. Open the wallet.`}
      onclick={() => onSelect("wallet")}
    >
      <span class="neocom-readout-value">{shortIsk(balance)}</span>
      <span class="neocom-readout-label">ISK</span>
    </button>
    <div class="neocom-readout neocom-clock" title={`EVE time (UTC) — ${clock}`}>
      <span class="neocom-readout-value">{clock}</span>
      <span class="neocom-readout-label">EVE</span>
    </div>
  </div>
</nav>
