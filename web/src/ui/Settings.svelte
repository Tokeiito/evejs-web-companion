<script lang="ts">
  // The Settings panel (a normal window / mobile tab). Today it manages the local
  // item-icon cache: how many icons are cached, an opt-in "auto-fill" that has the
  // BFF fetch a missing icon the first time it's shown, and one-shot bulk pulls
  // (the common gamestore set, or every published type). Why this exists: icons
  // are LOCAL-ONLY (see ui/typeIcons.ts), so an item whose icon was never cached
  // shows a lettered tile — this is where you fill the cache so pictures appear.
  import {
    fetchIconStatus,
    setIconAutoDownload,
    startIconPull,
    type IconCacheStatus,
  } from "../app/iconCache.ts";
  import { flyingDistances, WARP_RANGES, HOLD_RANGES, setDistance } from "./flyingDistances.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  // store/flow are accepted for the uniform panel signature (PanelHost passes them).
  let {}: { store?: ClientStore; flow?: AppFlow } = $props();

  let status = $state<IconCacheStatus | null>(null);
  let error = $state("");
  let busy = $state(false);

  async function refresh(): Promise<void> {
    try {
      status = await fetchIconStatus();
      error = "";
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  // One read on open; keep polling only while a bulk pull is running.
  $effect(() => {
    void refresh();
    const handle = setInterval(() => {
      if (status?.running) void refresh();
    }, 1500);
    return () => clearInterval(handle);
  });

  async function toggleAuto(): Promise<void> {
    if (!status || busy) return;
    busy = true;
    try {
      const value = await setIconAutoDownload(!status.autoDownload);
      status = { ...status, autoDownload: value };
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      busy = false;
    }
  }

  async function pull(source: "gamestore" | "all-types"): Promise<void> {
    if (busy) return;
    busy = true;
    error = "";
    try {
      await startIconPull(source);
      await refresh();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      busy = false;
    }
  }
</script>

<section class="settings-panel">
  <div class="panel-head"><h2>Settings</h2></div>

  <section class="settings-group">
    <h3>Item icons</h3>
    <p class="muted">
      Icons are served from a local cache. An item whose icon isn't cached shows a lettered tile
      instead of a picture — fill the cache below to make pictures appear.
    </p>

    {#if status === null && error === ""}
      <p class="muted">Loading…</p>
    {:else if status !== null}
      <p class="settings-stat">
        <strong>{status.cachedCount.toLocaleString()}</strong> icons cached locally.
      </p>

      <label class="settings-toggle">
        <input type="checkbox" checked={status.autoDownload} disabled={busy} onchange={toggleAuto} />
        <span class="settings-toggle-text">
          <strong>Auto-fill missing icons</strong>
          <span class="muted">
            Fetch an icon the first time it's shown, then keep it. Icons fill in as you browse — the
            best option unless you need to work fully offline.
          </span>
        </span>
      </label>

      <div class="settings-actions">
        <button type="button" disabled={busy || status.running} onclick={() => pull("all-types")}>
          Pull all icons
        </button>
        <button type="button" class="minor" disabled={busy || status.running} onclick={() => pull("gamestore")}>
          Pull common icons
        </button>
      </div>

      {#if status.running}
        <p class="settings-progress" aria-live="polite">
          <span class="spin" aria-hidden="true"></span>
          Pulling {status.source} icons… <span class="muted">{status.progress}</span>
        </p>
      {:else if status.lastResult}
        <p class="muted" aria-live="polite">Last pull ({status.source}): {status.lastResult}</p>
      {/if}

      {#if error}<p class="error">{error}</p>{/if}
    {:else}
      <p class="error">{error}</p>
    {/if}
  </section>

  <section class="settings-group">
    <h3>Flying distances</h3>
    <p class="muted">
      The ranges Warp to, Orbit and Keep at range use on whatever you have selected
      in the overview.
    </p>
    <div class="settings-field">
      <label for="fd-warp">Warp to within</label>
      <select id="fd-warp" value={$flyingDistances.warp} onchange={(e) => setDistance("warp", e.currentTarget.value)}>
        {#each WARP_RANGES as choice (choice.metres)}
          <option value={String(choice.metres)}>{choice.label}</option>
        {/each}
      </select>
    </div>
    <div class="settings-field">
      <label for="fd-orbit">Orbit at</label>
      <select id="fd-orbit" value={$flyingDistances.orbit} onchange={(e) => setDistance("orbit", e.currentTarget.value)}>
        {#each HOLD_RANGES as choice (choice.metres)}
          <option value={String(choice.metres)}>{choice.label}</option>
        {/each}
      </select>
    </div>
    <div class="settings-field">
      <label for="fd-hold">Keep at range</label>
      <select id="fd-hold" value={$flyingDistances.hold} onchange={(e) => setDistance("hold", e.currentTarget.value)}>
        {#each HOLD_RANGES as choice (choice.metres)}
          <option value={String(choice.metres)}>{choice.label}</option>
        {/each}
      </select>
    </div>
  </section>
</section>
