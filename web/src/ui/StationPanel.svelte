<script lang="ts">
  // Docked station panel (goal R2): station identity from client-local static
  // data (as retail resolves names from its static DB), the services row from
  // stationSvc.GetStationItemBits, guests from station.GetGuests, and the
  // faithful map.GetStationInfo call whose rowset rides the retail object
  // cache. All state is read from the store; refresh re-runs the docked reads
  // on the persistent live session.
  import { BridgeCallError } from "../bridge/callMethod.ts";
  import { isSessionLost } from "../app/flow.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import { resolvedName, type NameKind, type NameRef } from "../store/names.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // Stable store identity; slice signals are Svelte-store-contract objects.
  // svelte-ignore state_referenced_locally
  const station = store.station;
  // svelte-ignore state_referenced_locally
  const names = store.names;

  let busy = $state(false);
  let error = $state("");

  // R7c — resolve the station owner (corp/faction) + services-row station type,
  // and each guest's character / corporation / alliance. Batched + cached by the
  // flow; fire-and-forget so the raw tuple renders immediately and gains names.
  $effect(() => {
    const refs: NameRef[] = [];
    const bits = $station.bits;
    if (bits) {
      if (bits.ownerID) {
        refs.push({ kind: "owner", id: bits.ownerID });
      }
      if (bits.stationTypeID) {
        refs.push({ kind: "type", id: bits.stationTypeID });
      }
    }
    for (const guest of $station.guests) {
      refs.push({ kind: "character", id: guest.characterID });
      if (guest.corporationID) {
        refs.push({ kind: "corporation", id: guest.corporationID });
      }
      if (guest.allianceID) {
        refs.push({ kind: "alliance", id: guest.allianceID });
      }
    }
    if (refs.length > 0) {
      flow.requestNames(refs);
    }
  });

  // A name-only cell (R7d): the resolved name, or "—" while it resolves / when
  // it has no static name. The raw ID is never rendered.
  function nameOnly(id: number | null, kind: NameKind): string {
    return resolvedName($names.resolved, kind, id, "—");
  }

  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) {
      return;
    }
    busy = true;
    error = "";
    try {
      await action();
    } catch (cause) {
      if (isSessionLost(cause)) {
        error = "The live session ended (idle timeout or another client took over).";
      } else {
        error =
          cause instanceof BridgeCallError
            ? `${cause.code}: ${cause.message}`
            : String(cause);
      }
    } finally {
      busy = false;
    }
  }
</script>

{#if $station.online}
  <section class="panel">
    <header class="panel-head">
      <h2>Docked — {$station.station?.stationName ?? "the station"}</h2>
    </header>
    <p class="note">
      <strong>{$station.online.characterName}</strong> is online and docked
      {#if $station.station}
        in {$station.station.solarSystemName} ({$station.station.regionName})
      {/if}
    </p>
    <dl class="kv">
      <dt>Station type</dt>
      <dd>{$station.station?.stationTypeName ?? "unknown"}</dd>
      <dt>Solar system</dt>
      <dd>{$station.station?.solarSystemName ?? "?"}</dd>
      <dt>Security</dt>
      <dd>{$station.station?.security?.toFixed(2) ?? "—"}</dd>
    </dl>
  </section>

  <section>
    <h2>Station services</h2>
    {#if $station.bits}
      <dl class="kv">
        <dt>Owner</dt>
        <dd>{nameOnly($station.bits.ownerID, "owner")}</dd>
        <dt>Station type</dt>
        <dd>{nameOnly($station.bits.stationTypeID, "type")}</dd>
      </dl>
    {:else}
      <p class="note">Loading station services…</p>
    {/if}
    {#if $station.readError}
      <p class="error">Some station details could not be loaded: {$station.readError}</p>
    {/if}
  </section>

  <section>
    <h2>Guests</h2>
    {#if $station.guests.length === 0}
      <p class="empty">No guests reported yet.</p>
    {:else}
      <div class="table-wrap overflow-x-auto">
        <table class="guests reflow">
          <thead>
            <tr><th>Character</th><th>Corporation</th><th>Alliance</th></tr>
          </thead>
          <tbody>
            {#each $station.guests as guest (guest.characterID)}
              <tr class={guest.characterID === $station.online.characterID ? "self" : ""}>
                <td data-label="Character">
                  {guest.characterID === $station.online.characterID
                    ? `${$station.online.characterName} (you)`
                    : nameOnly(guest.characterID, "character")}
                </td>
                <td data-label="Corporation">{nameOnly(guest.corporationID, "corporation")}</td>
                <td data-label="Alliance">{nameOnly(guest.allianceID, "alliance")}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  <section>
    <p class="controls">
      <button type="button" class="primary" disabled={busy} onclick={() => run(() => flow.refreshStationPanel())}>
        Refresh panel
      </button>
      <button type="button" class="minor" disabled={busy} onclick={() => run(() => flow.releaseSession())}>
        Go offline
      </button>
      <button type="button" class="minor" disabled={busy} onclick={() => run(() => flow.logout())}>
        Log out
      </button>
    </p>
    {#if error}
      <p class="error">{error}</p>
    {/if}
  </section>
{/if}
