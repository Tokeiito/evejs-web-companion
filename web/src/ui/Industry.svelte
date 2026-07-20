<script lang="ts">
  // Industry page (goal R15): the player's blueprints with their efficiencies
  // and runs, the jobs they have running or waiting to collect, and the
  // facilities their region offers — everything BY NAME.
  //
  // A pure reader of the store's industry slice. Every call lives on the BFF
  // and in app/flow.ts; every identifier is translated to a name in
  // bridge/industry.ts before it reaches this file. Nothing here shows an
  // activityID, a status code, a blueprint typeID or a facilityID (R7d), and
  // nothing here computes a job outcome — the status a job shows, including
  // whether it is ready, is the one the SERVER returned.
  import { onMount } from "svelte";
  import {
    ACTIVITY_LABELS,
    ACTIVITY_ORDER,
    STATUS_LABELS,
    formatDuration,
    isActiveJob,
    secondsUntil,
  } from "../bridge/industry.ts";
  import { BridgeCallError } from "../bridge/callMethod.ts";
  import { isSessionLost } from "../app/flow.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type {
    IndustryActivity,
    IndustryBlueprintRow,
    IndustryJobRow,
  } from "../store/types.ts";
  import { resolvedName } from "../store/names.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // svelte-ignore state_referenced_locally
  const industry = store.industry;
  // svelte-ignore state_referenced_locally
  const names = store.names;

  let busy = $state(false);
  let error = $state("");
  /** Ticks once a second so job countdowns stay live without a server poll. */
  let nowMs = $state(Date.now());

  function typeName(typeID: number): string {
    return resolvedName($names.resolved, "type", typeID);
  }

  /** A facility's name. An NPC facility's id IS its station id, so the shared
   * station name cache answers it; a structure the cache does not know reads
   * as "an unnamed facility" rather than falling back to its number —
   * `resolvedName` is the R7d helper that never returns a raw ID. */
  function facilityName(facilityID: number): string {
    return resolvedName($names.resolved, "station", facilityID, "An unnamed facility");
  }

  function systemName(solarSystemID: number): string {
    return resolvedName($names.resolved, "system", solarSystemID, "an unknown system");
  }

  /** What a blueprint makes, from its static recipe. */
  function productName(blueprintTypeID: number): string | null {
    const definition = $industry.definitions[blueprintTypeID];
    if (!definition) {
      return null;
    }
    if (definition.productName) {
      return definition.productName;
    }
    return definition.productTypeID ? typeName(definition.productTypeID) : null;
  }

  /** Which activities a blueprint supports, as names the player can read. */
  function blueprintActivities(blueprintTypeID: number): readonly IndustryActivity[] {
    const definition = $industry.definitions[blueprintTypeID];
    return definition ? definition.recipes.map((recipe) => recipe.activity) : [];
  }

  /**
   * A blueprint's runs, in words. An ORIGINAL never runs out, so showing it a
   * run count would be actively misleading — the server's `runs` field is only
   * meaningful for a copy.
   */
  function runsText(blueprint: IndustryBlueprintRow): string {
    return blueprint.original ? "Unlimited (original)" : `${blueprint.runs} left`;
  }

  /** How long a running job has to go, or why it has no countdown. */
  function jobTimeText(job: IndustryJobRow): string {
    if (job.status === "ready") {
      return "Finished — collect it";
    }
    if (!isActiveJob(job.status)) {
      return "—";
    }
    const remaining = secondsUntil(job.endDate, nowMs);
    if (remaining === null) {
      return "Unknown";
    }
    // A job past its end date that the server still calls "running" is simply
    // waiting to be re-read; say so rather than showing a negative countdown.
    return remaining <= 0 ? "Any moment now" : formatDuration(remaining);
  }

  const activeJobs = $derived.by(() => $industry.jobs.filter((job) => isActiveJob(job.status)));
  const finishedJobs = $derived.by(() =>
    $industry.jobs.filter((job) => !isActiveJob(job.status)),
  );

  /** Job slots in use, by activity name — only the activities actually used. */
  const slotRows = $derived.by(() =>
    ACTIVITY_ORDER.map((activity) => ({
      activity,
      used: $industry.slotsUsed[activity] ?? 0,
    })).filter((row) => row.used > 0),
  );

  /** Facilities that are online and will host at least one activity. */
  const usableFacilities = $derived.by(() =>
    $industry.facilities.filter((facility) => facility.activities.length > 0),
  );

  function taxText(tax: number | null): string {
    if (tax === null) {
      return "Unknown";
    }
    // The server speaks in fractions; players read percentages.
    const percent = tax * 100;
    return `${Number.isInteger(percent) ? percent : percent.toFixed(2)}%`;
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
          cause instanceof BridgeCallError ? `${cause.code}: ${cause.message}` : String(cause);
      }
    } finally {
      busy = false;
    }
  }

  onMount(() => {
    void run(() => flow.loadIndustry());
    const timer = setInterval(() => {
      nowMs = Date.now();
    }, 1000);
    return () => clearInterval(timer);
  });
</script>

<section>
  <h2>Industry</h2>
  <p class="controls">
    <button type="button" disabled={busy} onclick={() => run(() => flow.loadIndustry())}>
      Refresh
    </button>
  </p>
  {#if error}
    <p class="error">{error}</p>
  {/if}
  {#if $industry.actionError}
    <p class="error">Last change failed: {$industry.actionError}</p>
  {/if}
  {#if !$industry.loaded}
    <p class="note">Loading your industry…</p>
  {/if}
</section>

{#if $industry.loaded}
  <section>
    <h2>Jobs you have running</h2>
    {#if $industry.jobsError}
      <p class="error">Your jobs could not be loaded: {$industry.jobsError}</p>
    {/if}
    {#if slotRows.length > 0}
      <p class="note">
        Job slots in use:
        {#each slotRows as row, index (row.activity)}{index > 0
            ? ", "
            : ""}{ACTIVITY_LABELS[row.activity]} {row.used}{/each}.
      </p>
    {/if}
    {#if activeJobs.length === 0}
      <p class="note">Nothing in progress right now.</p>
    {:else}
      <div class="table-wrap overflow-x-auto">
        <table class="guests reflow">
          <thead>
            <tr>
              <th>Making</th>
              <th>Work</th>
              <th>Runs</th>
              <th>Where</th>
              <th>Status</th>
              <th>Time left</th>
            </tr>
          </thead>
          <tbody>
            {#each activeJobs as job (job.jobID)}
              <tr>
                <td data-label="Making">{typeName(job.productTypeID)}</td>
                <td data-label="Work">
                  {job.activity ? ACTIVITY_LABELS[job.activity] : "Unknown work"}
                </td>
                <td data-label="Runs">{job.runs}</td>
                <td data-label="Where">{facilityName(job.facilityID)}</td>
                <td data-label="Status">{STATUS_LABELS[job.status]}</td>
                <td data-label="Time left">{jobTimeText(job)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  {#if finishedJobs.length > 0}
    <section>
      <h2>Jobs you have finished</h2>
      <div class="table-wrap overflow-x-auto">
        <table class="guests reflow">
          <thead>
            <tr>
              <th>Made</th>
              <th>Work</th>
              <th>Runs</th>
              <th>Where</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {#each finishedJobs as job (job.jobID)}
              <tr>
                <td data-label="Made">{typeName(job.productTypeID)}</td>
                <td data-label="Work">
                  {job.activity ? ACTIVITY_LABELS[job.activity] : "Unknown work"}
                </td>
                <td data-label="Runs">
                  {job.status === "cancelled" ? "—" : job.successfulRuns || job.runs}
                </td>
                <td data-label="Where">{facilityName(job.facilityID)}</td>
                <td data-label="Outcome">{STATUS_LABELS[job.status]}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}

  <section>
    <h2>Your blueprints</h2>
    {#if $industry.blueprintsError}
      <p class="error">Your blueprints could not be loaded: {$industry.blueprintsError}</p>
    {/if}
    {#if $industry.blueprints.length === 0}
      <p class="note">You do not own any blueprints.</p>
    {:else}
      <div class="table-wrap overflow-x-auto">
        <table class="guests reflow">
          <thead>
            <tr>
              <th>Blueprint</th>
              <th>Makes</th>
              <th>Runs</th>
              <th>Material efficiency</th>
              <th>Time efficiency</th>
              <th>Can be used for</th>
            </tr>
          </thead>
          <tbody>
            {#each $industry.blueprints as blueprint (blueprint.itemID)}
              <tr>
                <td data-label="Blueprint">
                  {typeName(blueprint.typeID)}
                  {#if blueprint.jobID !== null}
                    <small class="note">in use by a job</small>
                  {/if}
                </td>
                <td data-label="Makes">{productName(blueprint.typeID) ?? "—"}</td>
                <td data-label="Runs">{runsText(blueprint)}</td>
                <!-- Spelled out, never "ME"/"TE" (R9a). -->
                <td data-label="Material efficiency">
                  {blueprint.materialEfficiency}% saved
                </td>
                <td data-label="Time efficiency">{blueprint.timeEfficiency}% faster</td>
                <td data-label="Can be used for">
                  {#if blueprintActivities(blueprint.typeID).length === 0}
                    <span class="note">—</span>
                  {:else}
                    {blueprintActivities(blueprint.typeID)
                      .map((activity) => ACTIVITY_LABELS[activity])
                      .join(", ")}
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  <section>
    <h2>Places you can work</h2>
    {#if $industry.facilitiesError}
      <p class="error">Nearby facilities could not be loaded: {$industry.facilitiesError}</p>
    {/if}
    {#if usableFacilities.length === 0}
      <p class="note">No industry facilities are available where you are.</p>
    {:else}
      <div class="table-wrap overflow-x-auto">
        <table class="guests reflow">
          <thead>
            <tr>
              <th>Facility</th>
              <th>System</th>
              <th>Work it takes</th>
              <th>Fee</th>
            </tr>
          </thead>
          <tbody>
            {#each usableFacilities as facility (facility.facilityID)}
              <tr>
                <td data-label="Facility">
                  {facilityName(facility.facilityID)}
                  {#if !facility.online}
                    <small class="note">offline</small>
                  {/if}
                </td>
                <td data-label="System">{systemName(facility.solarSystemID)}</td>
                <td data-label="Work it takes">
                  {facility.activities.map((activity) => ACTIVITY_LABELS[activity]).join(", ")}
                </td>
                <td data-label="Fee">{taxText(facility.tax)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
{/if}
