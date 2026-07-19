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
  import { displayName, type NameKind, type NameRef } from "../store/names.ts";

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

  // A raw-retail-data cell: keep the ID (the section shows the real tuple) and
  // append the resolved name once it lands.
  function idWithName(id: number | null, kind: NameKind): string {
    if (id === null || id === undefined) {
      return "—";
    }
    const name = displayName($names.resolved, kind, id, "");
    return name && name !== String(id) ? `${id} · ${name}` : String(id);
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
        <dt>Owner</dt>
        <dd>{idWithName($station.bits.ownerID, "owner")}</dd>
        <dt>Station item ID</dt>
        <dd>{idWithName($station.bits.stationID, "station")}</dd>
        <dt>Operation ID</dt>
        <dd>{$station.bits.operationID ?? "—"}</dd>
        <dt>Station type</dt>
        <dd>{idWithName($station.bits.stationTypeID, "type")}</dd>
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
    {#if $station.readError}
      <p class="error">Some docked reads failed (panel shows what loaded): {$station.readError}</p>
    {/if}
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
              <td title={String(guest.characterID)}>
                {guest.characterID === $station.online.characterID
                  ? `${$station.online.characterName} (you)`
                  : displayName($names.resolved, "character", guest.characterID)}
              </td>
              <td title={guest.corporationID ? String(guest.corporationID) : ""}>{displayName($names.resolved, "corporation", guest.corporationID, "—")}</td>
              <td title={guest.allianceID ? String(guest.allianceID) : ""}>{displayName($names.resolved, "alliance", guest.allianceID, "—")}</td>
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
