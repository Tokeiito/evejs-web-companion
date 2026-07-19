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

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // Stable store identity; slice signals are Svelte-store-contract objects.
  // svelte-ignore state_referenced_locally
  const station = store.station;

  let busy = $state(false);
  let error = $state("");

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
  <section>
    <h2>Docked — {$station.station?.stationName ?? `Station ${$station.online.stationID ?? "?"}`}</h2>
    <p class="note">
      <strong>{$station.online.characterName}</strong> is online and docked
      {#if $station.station}
        in {$station.station.solarSystemName} ({$station.station.regionName})
      {/if}
      — live EveJS session.
    </p>
    <dl class="kv">
      <dt>Station ID</dt>
      <dd>{$station.online.stationID ?? "—"}</dd>
      <dt>Station type</dt>
      <dd>
        {$station.station?.stationTypeName ?? "unknown"}
        {#if $station.station?.stationTypeID}
          (typeID {$station.station.stationTypeID})
        {/if}
      </dd>
      <dt>Solar system</dt>
      <dd>
        {$station.station?.solarSystemName ?? "?"}
        (ID {$station.online.solarSystemID ?? "?"})
      </dd>
      <dt>Security</dt>
      <dd>{$station.station?.security?.toFixed(2) ?? "—"}</dd>
    </dl>
  </section>

  <section>
    <h2>Station services — stationSvc.GetStationItemBits</h2>
    {#if $station.bits}
      <dl class="kv">
        <dt>Owner ID</dt>
        <dd>{$station.bits.ownerID ?? "—"}</dd>
        <dt>Station item ID</dt>
        <dd>{$station.bits.stationID ?? "—"}</dd>
        <dt>Operation ID</dt>
        <dd>{$station.bits.operationID ?? "—"}</dd>
        <dt>Station type ID</dt>
        <dd>{$station.bits.stationTypeID ?? "—"}</dd>
      </dl>
    {:else}
      <p class="note">Loading services row…</p>
    {/if}
    <p class="note">
      map.GetStationInfo:
      {#if $station.stationInfoCached === null}
        not queried yet
      {:else if $station.stationInfoCached}
        answered with the retail cached-object envelope (rowset rides the
        object cache)
      {:else}
        answered with an unexpected shape
      {/if}
    </p>
  </section>

  <section>
    <h2>Guests — station.GetGuests</h2>
    {#if $station.guests.length === 0}
      <p class="note">No guests reported yet.</p>
    {:else}
      <table class="guests">
        <thead>
          <tr><th>Character</th><th>Corporation</th><th>Alliance</th></tr>
        </thead>
        <tbody>
          {#each $station.guests as guest (guest.characterID)}
            <tr class={guest.characterID === $station.online.characterID ? "self" : ""}>
              <td>
                {guest.characterID === $station.online.characterID
                  ? `${$station.online.characterName} (you)`
                  : guest.characterID}
              </td>
              <td>{guest.corporationID ?? "—"}</td>
              <td>{guest.allianceID ?? "—"}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>

  <section>
    <p>
      <button type="button" disabled={busy} onclick={() => run(() => flow.refreshStationPanel())}>
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
