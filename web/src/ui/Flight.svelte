<script lang="ts">
  // Flight page (goal R5a): manually-stepped space movement — undock, warp to a
  // chosen gate/celestial, jump, and dock — plus a live status readout (current
  // system, in-space vs docked, ship state, last action, failure reason). A
  // pure reader of the store's flight slice; all ship.Undock / beyonce.Cmd*
  // logic runs on the BFF (which holds the beyonce bound park handle) and in
  // app/flow.ts. Manual buttons only — the autopilot decide-loop is R5b.
  import { onMount } from "svelte";
  import { BridgeCallError } from "../bridge/callMethod.ts";
  import { isSessionLost } from "../app/flow.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import { nameKey } from "../store/names.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // svelte-ignore state_referenced_locally
  const flight = store.flight;
  // svelte-ignore state_referenced_locally
  const inventory = store.inventory;
  // svelte-ignore state_referenced_locally
  const names = store.names;

  // R7c — the flight status carries the active ship's ITEM id but no typeID, so
  // resolve the ship TYPE name by cross-referencing the inventory slice (the
  // active ship sits in the docked hangar/cargo rows, which carry the typeID).
  // Best-effort: in space, or before the inventory tab has loaded, we fall back
  // to the raw ship item ID.
  const activeShipTypeID = $derived.by<number | null>(() => {
    const shipID = $flight.status?.shipID ?? null;
    if (shipID === null || $inventory.activeShipID !== shipID) {
      return null;
    }
    const row =
      $inventory.hangar.rows.find((r) => r.itemID === shipID) ??
      $inventory.cargo.rows.find((r) => r.itemID === shipID);
    return row ? row.typeID : null;
  });

  $effect(() => {
    if (activeShipTypeID !== null) {
      flow.requestNames([{ kind: "type", id: activeShipTypeID }]);
    }
  });

  function activeShipText(): string {
    if (($flight.status?.shipID ?? null) === null) {
      return "—";
    }
    // Ship TYPE name only (e.g. "Algos"); the raw ship item ID is never rendered.
    const typeName = activeShipTypeID !== null ? $names.resolved[nameKey("type", activeShipTypeID)] : null;
    return typeName ?? "active ship";
  }

  let busy = $state(false);
  let error = $state("");

  // Operator-chosen movement targets (game IDs). The route/pathfinding solver
  // that would fill these automatically is R5b; here the operator picks them.
  let warpTargetID = $state("");
  let fromGateID = $state("");
  let toGateID = $state("");
  let dockStationID = $state("");

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
          cause instanceof BridgeCallError ? `${cause.code}: ${cause.message}` : String(cause);
      }
    } finally {
      busy = false;
    }
  }

  onMount(() => {
    void run(() => flow.loadFlightStatus());
  });

  function parseID(value: string): number {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : 0;
  }

  // Show the resolved system/station/structure NAME (goal R7a), falling back to
  // the raw ID only until the flow resolves it (or when it has no static name).
  function locationText(): string {
    const status = $flight.status;
    if (!status) {
      return "—";
    }
    if (status.inSpace) {
      return `In space · ${$flight.solarSystemName ?? "unknown system"}`;
    }
    if (status.stationID) {
      return `Docked · ${$flight.stationName ?? "the station"}`;
    }
    if (status.structureID) {
      return `Docked · ${$flight.structureName ?? "a structure"}`;
    }
    return "—";
  }

  // The "Solar system" row: the resolved system NAME only (never the raw ID).
  function solarSystemText(): string {
    if (($flight.status?.solarSystemID ?? null) === null) {
      return "—";
    }
    return $flight.solarSystemName ?? "unknown system";
  }

  function shipStateText(): string {
    const status = $flight.status;
    if (!status) {
      return "—";
    }
    if (!status.inSpace) {
      return "Docked";
    }
    const mode = status.shipMode ?? "unknown";
    const fraction =
      status.shipSpeedFraction !== null
        ? ` · speed ${Math.round(status.shipSpeedFraction * 100)}%`
        : "";
    return `${mode}${fraction}`;
  }
</script>

<section>
  <h2>Flight</h2>
  <p class="note">
    Manually-stepped space movement (R5a): the atomic moves the retail client's
    client-side autopilot issues, one button per step. ship.Undock enters space;
    the beyonce remote park (Moniker('beyonce', solarSystemID)) is bound on the
    BFF, and CmdWarpToStuffAutopilot / CmdStargateJump / CmdDock dispatch on it.
    The autopilot decide-loop and route solver are R5b — here you pick each gate
    and destination. The browser never sees a bound handle.
  </p>
  <p>
    <button type="button" disabled={busy} onclick={() => run(() => flow.loadFlightStatus())}>
      Refresh flight status
    </button>
  </p>
  {#if error}
    <p class="error">{error}</p>
  {/if}
</section>

<section>
  <h2>Status</h2>
  {#if !$flight.loaded}
    <p class="note">Loading flight status…</p>
  {:else}
    <table class="guests">
      <tbody>
        <tr><th>Location</th><td>{locationText()}</td></tr>
        <tr><th>Solar system</th><td>{solarSystemText()}</td></tr>
        <tr><th>Active ship</th><td>{activeShipText()}</td></tr>
        <tr><th>Ship state</th><td>{shipStateText()}</td></tr>
        <tr><th>Last action</th><td>{$flight.lastAction ?? "—"}</td></tr>
        <tr>
          <th>Last failure</th>
          <td>{#if $flight.actionError}<span class="error">{$flight.actionError}</span>{:else}—{/if}</td>
        </tr>
      </tbody>
    </table>
  {/if}
</section>

{#if $flight.loaded && $flight.status && !$flight.status.inSpace}
  <section>
    <h2>Undock</h2>
    <p class="note">Leave the station and enter space to warp, jump, and dock.</p>
    <p>
      <button type="button" disabled={busy} onclick={() => run(() => flow.undock())}>
        Undock
      </button>
    </p>
  </section>
{/if}

{#if $flight.loaded && $flight.status && $flight.status.inSpace}
  <section>
    <h2>Warp to a gate / celestial</h2>
    <p class="controls">
      <label>
        Target ID
        <input type="number" min="1" bind:value={warpTargetID} placeholder="stargate / celestial ID" />
      </label>
      <button
        type="button"
        disabled={busy || parseID(warpTargetID) === 0}
        onclick={() => run(() => flow.warpTo(parseID(warpTargetID)))}
      >
        Warp to target
      </button>
    </p>
  </section>

  <section>
    <h2>Jump through a stargate</h2>
    <p class="controls">
      <label>
        From gate ID
        <input type="number" min="1" bind:value={fromGateID} placeholder="source stargate ID" />
      </label>
      <label>
        To gate ID
        <input type="number" min="1" bind:value={toGateID} placeholder="destination stargate ID" />
      </label>
      <button
        type="button"
        disabled={busy || parseID(fromGateID) === 0 || parseID(toGateID) === 0}
        onclick={() => run(() => flow.jump(parseID(fromGateID), parseID(toGateID)))}
      >
        Jump
      </button>
    </p>
    <p class="note">
      The system transition completes after a short handoff; refresh flight
      status to see the new system.
    </p>
  </section>

  <section>
    <h2>Dock at a station</h2>
    <p class="controls">
      <label>
        Station ID
        <input type="number" min="1" bind:value={dockStationID} placeholder="destination station ID" />
      </label>
      <button
        type="button"
        disabled={busy || parseID(dockStationID) === 0}
        onclick={() => run(() => flow.dock(parseID(dockStationID)))}
      >
        Dock
      </button>
    </p>
    <p class="note">
      Docking requires being in range; if the ship is too far the handler
      refuses with a docking-approach reason. Refresh flight status to confirm.
    </p>
  </section>
{/if}
