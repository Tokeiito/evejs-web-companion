<script lang="ts">
  // The workspace context bar across the top of the work area: state badge, where
  // you are (station + system docked / system + ship mode in space), the pilot,
  // and the one primary movement action for the current state — Undock when
  // docked, Dock (at the nearest station on grid) in space. Owns its own busy /
  // error guard: one action at a time, and the server's own refusal on failure.
  import { nearestDockable } from "./dockTarget.ts";
  import { resolvedName } from "../store/names.ts";
  import { BridgeCallError } from "../bridge/callMethod.ts";
  import { isSessionLost } from "../app/flow.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import { panelErrorWords } from "../bridge/refusals.ts";
  import { INDICATION_WORD_LABELS, indicationHeader, shipIndication } from "../space/actionIndication.ts";
  import { TIDI_WORD_LABELS, tidiHint, tidiPercent } from "../space/timeDilation.ts";
  import { SPEED_WORD_LABELS, shipSpeedText } from "../space/shipSpeed.ts";

  let { store, flow, isDocked }: { store: ClientStore; flow: AppFlow; isDocked: boolean } = $props();

  // svelte-ignore state_referenced_locally
  const station = store.station;
  // svelte-ignore state_referenced_locally
  const flight = store.flight;
  // svelte-ignore state_referenced_locally
  const space = store.space;
  // svelte-ignore state_referenced_locally
  const names = store.names;
  // svelte-ignore state_referenced_locally
  const words = store.words;

  let busy = $state(false);
  let error = $state("");
  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    error = "";
    try {
      await action();
    } catch (cause) {
      if (isSessionLost(cause)) {
        error = "The live session ended (idle timeout or another client took over).";
      } else {
        error = panelErrorWords(cause);
      }
    } finally {
      busy = false;
    }
  }

  const stationName = $derived($station.station?.stationName ?? $flight.stationName ?? "this station");
  const systemName = $derived($station.station?.solarSystemName ?? $flight.solarSystemName ?? null);
  const regionName = $derived($station.station?.regionName ?? null);
  const spaceSystem = $derived($flight.solarSystemName ?? null);
  // What the ship is doing. When the snapshot says enough for the client's own rule (its mode, whom it
  // follows, the range in its order) it is the client's word for it: "approaching", not the ball's FOLLOW.
  // Otherwise the ship's mode as it comes: from the snapshot, which is read every second in space, and only
  // failing that from the flight status, which is read when something is ordered and can be minutes old.
  const doing = $derived(shipIndication($space.snapshot));
  const shipMode = $derived(
    doing !== null ? indicationHeader(doing.kind, $words.templates) : ($space.snapshot?.ship?.mode ?? $flight.status?.shipMode ?? null),
  );
  $effect(() => {
    flow.requestWords(INDICATION_WORD_LABELS);
    flow.requestWords(SPEED_WORD_LABELS);
  });
  // The ship's speed as the client's gauge says it, from how fast the snapshot has the ship going. Only a
  // pilot whose snapshot is read from its own park is shown one that way; otherwise the throttle's setting.
  const speedText = $derived(shipSpeedText($space.snapshot?.ship, $words.templates));
  // Time dilation, shown as the client's indicator shows it: only while the pilot's clock runs slow.
  const tidi = $derived(isDocked ? null : tidiPercent($space.snapshot?.timeDilation));
  $effect(() => {
    if (tidi !== null) {
      flow.requestWords(TIDI_WORD_LABELS);
    }
  });
  const speedPct = $derived(
    $flight.status?.shipSpeedFraction != null ? Math.round($flight.status.shipSpeedFraction * 100) : null,
  );

  const dockTarget = $derived(
    nearestDockable($space.snapshot?.entities, $space.snapshot?.ship?.position ?? null),
  );
  const dockName = $derived(
    dockTarget ? (dockTarget.name ?? resolvedName($names.resolved, "type", dockTarget.typeID)) : null,
  );
</script>

<header class="ws-head">
  <span class="state-badge {isDocked ? 'docked' : 'in-space'}">{isDocked ? "Docked" : "In Space"}</span>
  {#if tidi !== null}
    <span class="state-badge tidi" title={tidiHint(tidi, $words.templates)}>TiDi {tidi}%</span>
  {/if}
  <div class="ws-head-where">
    {#if isDocked}
      <strong>{stationName}</strong>
      {#if systemName}
        <span class="muted">{systemName}{#if regionName} · {regionName}{/if}</span>
      {/if}
    {:else}
      <strong>{spaceSystem ?? "In space"}</strong>
      {#if shipMode}<span class="muted">{shipMode}{#if speedText !== null} · <span class="ws-head-speed">{speedText}</span>{:else if speedPct !== null} · {speedPct}%{/if}</span>{/if}
    {/if}
  </div>

  <!-- No pilot name here: the character bar's chip is the one authoritative
       "who am I flying" indicator (it stays right in multibox, where this
       single-slot copy could not). -->
  <div class="ws-head-actions">
    {#if error}<span class="ws-head-error" role="alert">{error}</span>{/if}
    {#if isDocked}
      <button type="button" class="undock-btn" disabled={busy} onclick={() => run(() => flow.undock())}>
        {busy ? "Undocking…" : "Undock"}
      </button>
    {:else if dockTarget}
      <button
        type="button"
        class="dock-btn"
        disabled={busy}
        title={`Dock at ${dockName}`}
        onclick={() => run(() => flow.dockAt(dockTarget.itemID))}
      >
        {busy ? "Docking…" : "Dock"}
      </button>
    {:else}
      <button type="button" class="dock-btn" disabled title="No station on this grid to dock at">Dock</button>
    {/if}
  </div>
</header>
