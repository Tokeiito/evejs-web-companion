<script lang="ts">
  // One panel's blast radius.
  //
  // WHY: an error thrown while Svelte renders (a duplicate `{#each}` key, a
  // null dereference in a $derived) aborts the whole render flush. Without a
  // boundary that takes down the ENTIRE tab — every other panel, the character
  // bar, the HUD — and because the polls keep running it throws again on every
  // refresh, so the page sits there frozen while the console fills with the
  // same anonymous error. That is the "page may have stopped updating" report.
  //
  // With a boundary the failure is contained to the panel that caused it: the
  // rest of the workspace keeps rendering, and the panel says which one it was.
  // `name` is the whole point — a production Svelte error carries no component
  // information, so the name here is the only thing that tells us WHERE.
  import type { Snippet } from "svelte";
  import { reportUiError } from "../app/errorOverlay.ts";

  let { name, children }: { name: string; children: Snippet } = $props();

  function describe(error: unknown): string {
    return error !== null && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message)
      : String(error);
  }
</script>

<svelte:boundary onerror={(error: unknown) => reportUiError(name, error)}>
  {@render children()}

  {#snippet failed(error: unknown, reset: () => void)}
    <div class="panel-failed" role="alert">
      <p class="panel-failed-head">{name} stopped working.</p>
      <p class="panel-failed-why">{describe(error)}</p>
      <button type="button" onclick={reset}>Try again</button>
    </div>
  {/snippet}
</svelte:boundary>

<style>
  .panel-failed {
    border: 1px solid var(--color-danger);
    background: var(--color-panel-3);
    color: var(--color-text);
    padding: 0.6rem 0.7rem;
    margin: 0.4rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    align-items: flex-start;
  }
  .panel-failed-head {
    margin: 0;
    color: var(--color-danger);
  }
  .panel-failed-why {
    margin: 0;
    color: var(--color-muted);
    font-size: 0.85em;
    word-break: break-word;
  }
</style>
