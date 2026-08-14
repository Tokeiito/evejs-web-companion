<script lang="ts">
  // SERVER bots — the remote control for bots the BFF flies (src/botHost.js).
  //
  // The whole point of a server bot is that THIS TAB DOES NOT MATTER: it keeps
  // running when the tab closes or a phone locks. So this component owns no
  // bot state at all — it POLLS the server's list and renders it verbatim, the
  // same words the in-tab readout would use (the host projects the same
  // customBot slice). It is mounted in two places deliberately: the Bots panel
  // (online) and the character-select screen (offline) — a player who just
  // handed their hull to a bot lands on character select and must still be
  // able to see and stop it from there.
  import { onMount } from "svelte";
  import { listServerBots, stopServerBot, type ServerBot } from "../app/api.ts";
  import { BOT_RISK_LABELS } from "../bots/runPolicy.ts";
  import { skipWhileBusy } from "../app/skipWhileBusy.ts";

  const POLL_MS = 3000;

  let bots = $state<ServerBot[]>([]);
  let error = $state<string | null>(null);
  let loaded = $state(false);
  let busyBotID = $state<string | null>(null);

  async function refresh(): Promise<void> {
    try {
      bots = await listServerBots();
      error = null;
    } catch {
      // Keep whatever was last known on screen; say the read is failing.
      error = "Could not reach the server's bot list — are you still logged in?";
    } finally {
      loaded = true;
    }
  }

  async function stop(botID: string): Promise<void> {
    if (busyBotID !== null) {
      return;
    }
    busyBotID = botID;
    try {
      await stopServerBot(botID);
      error = null;
    } catch {
      error = "Could not stop that bot — it may have already ended.";
    } finally {
      busyBotID = null;
    }
    await refresh();
  }

  onMount(() => {
    // Guarded, like every other periodic read — see app/skipWhileBusy.ts.
    const beat = skipWhileBusy(refresh);
    void beat();
    const timer = setInterval(() => void beat(), POLL_MS);
    return () => clearInterval(timer);
  });

  /** A bot the server is still flying (Stop applies). */
  function isActive(bot: ServerBot): boolean {
    return bot.status === "starting" || bot.status === "running" || bot.status === "paused";
  }

  /**
   * How long ago an alert fired, in words. Relative, because "4 minutes ago" is
   * what a player actually wants to know when they pick their phone back up — and
   * because a clock time would need a timezone the readout does not have.
   */
  function alertWhen(atMs: number): string {
    const seconds = Math.max(0, Math.round((Date.now() - atMs) / 1000));
    if (seconds < 60) {
      return "just now";
    }
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
      return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
    }
    const hours = Math.round(minutes / 60);
    return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }

  /** What the badge says. Plain language, never the raw state word (R9a). */
  function statusWords(bot: ServerBot): string {
    if (bot.status === "starting") {
      return "Starting";
    }
    if (bot.status === "running") {
      return "Running";
    }
    if (bot.status === "paused") {
      return "Paused";
    }
    if (bot.status === "error") {
      return "Stopped after a problem";
    }
    return "Finished";
  }

  function riskWords(bot: ServerBot): string {
    return bot.riskClasses.length === 0
      ? "No consequential permissions"
      : bot.riskClasses.map((risk) => BOT_RISK_LABELS[risk]).join("; ");
  }
</script>

<section>
  <h2>On the server</h2>
  <p class="note">
    These bots run on the server itself — closing this tab does not stop them,
    but each run has a time limit. After a restart, only the exact same script
    can start over, and only when every step is safe to re-check; other runs stop
    and ask you to review them again.
    A character a server bot is flying cannot be selected until the bot stops.
  </p>
  {#if error}<p class="note error">{error}</p>{/if}
  {#if loaded && bots.length === 0}
    <p class="note">No server bots.</p>
  {:else if bots.length > 0}
    <ul class="server-bots">
      {#each bots as bot (bot.botID)}
        <li class="server-bot" class:active={isActive(bot)}>
          <div class="row">
            <span class="name">{bot.scriptName}</span>
            <span class="badge">{statusWords(bot)}</span>
          </div>
          <div class="row">
            <span class="detail">
              {bot.characterName ?? `Character ${bot.characterID}`}
              {#if bot.phase}
                · {bot.phase}
              {/if}
            </span>
            {#if isActive(bot)}
              <button
                class="danger"
                disabled={busyBotID !== null}
                onclick={() => stop(bot.botID)}
              >
                {busyBotID === bot.botID ? "Stopping…" : "Stop"}
              </button>
            {/if}
          </div>
          <p class="note why">
            Revision {bot.scriptRev} · {riskWords(bot)} · limit {bot.maxRuntimeMinutes < 60 ? `${bot.maxRuntimeMinutes} min` : `${bot.maxRuntimeMinutes / 60} hr`}
          </p>
          {#if bot.resumedAt}
            <p class="note why">Restarted with the server after its saved revision and safe steps were checked.</p>
          {/if}
          {#if bot.lastAlert}
            <!-- A server bot has no browser to notify, so this line IS the alert.
                 Above `why` and marked, because it is the thing worth reading. -->
            <p class="alert">⚠ {bot.lastAlert.message} <span class="when">{alertWhen(bot.lastAlert.atMs)}</span></p>
          {/if}
          {#if bot.why}
            <p class="note why">{bot.why}</p>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .server-bots {
    list-style: none;
    margin: 0.4rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .server-bot {
    border: 1px solid var(--color-row-line);
    border-radius: 4px;
    background: var(--color-panel-3);
    padding: 0.5rem 0.6rem;
  }
  .server-bot.active {
    border-width: 2px;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
  }
  .name {
    color: var(--color-text-bright);
  }
  .badge {
    font-size: 0.85em;
    border: 1px solid currentColor;
    padding: 0.1rem 0.4rem;
    white-space: nowrap;
  }
  .why {
    margin: 0.3rem 0 0;
  }
  /* The alert is the one line here worth interrupting the eye for — accent, not
     the muted note colour the rest of the card uses. */
  .alert {
    margin: 0.3rem 0 0;
    color: var(--color-accent);
    border-left: 2px solid var(--color-accent);
    padding-left: 0.4rem;
  }
  .alert .when {
    color: var(--color-text-dim);
    white-space: nowrap;
  }
  /* R8 — a comfortable target on a phone. */
  .server-bot button {
    min-height: 40px;
  }
</style>
