<script lang="ts">
  // The dock / undock fade (goal R75). Watches the docked flag and, when it
  // genuinely CHANGES, lays a short fade-through-black over the whole workspace
  // with the word for what just happened.
  //
  // Self-contained so both workspaces (the desktop one and the mobile one) get
  // the same transition from the same code — the state change is identical in
  // both, and two copies would drift.
  //
  // ⚠ IT NEVER BLOCKS INPUT. `pointer-events: none` in the stylesheet: a fade is
  // atmosphere, and an overlay that swallowed a click during those 620 ms would
  // occasionally eat a real action for no reason a player could see.
  import { DOCK_WIPE_MS, dockWipeLabel, shouldPlayDockWipe, type DockedReading } from "./dockTransition.ts";

  let { isDocked }: { isDocked: boolean } = $props();

  /**
   * The last docked state we OBSERVED — deliberately a plain `let`, not `$state`.
   * It is a record of what this component has already seen, not something the UI
   * derives from; making it reactive would re-run the effect that writes it.
   *
   * It starts `null` because the first reading is not a change (see
   * `dockTransition.ts`), and that is what stops a login or a page refresh from
   * blacking the screen.
   */
  let observed: DockedReading = null;

  /** The transition in flight, or null. Keyed by `token` so a fast dock→undock
   *  restarts the animation instead of the second one being swallowed because
   *  the element never left the DOM. */
  let wipe = $state<{ readonly label: string; readonly token: number } | null>(null);
  let token = 0;

  $effect(() => {
    const next = isDocked;
    if (!shouldPlayDockWipe(observed, next)) {
      observed = next;
      return;
    }
    observed = next;
    token += 1;
    wipe = { label: dockWipeLabel(next), token };
    const handle = setTimeout(() => {
      wipe = null;
    }, DOCK_WIPE_MS);
    return () => clearTimeout(handle);
  });
</script>

{#if wipe}
  {#key wipe.token}
    <!-- role=status + aria-live so the change is ANNOUNCED, not merely shown: a
         transition that only exists as a visual effect is a state change a
         screen-reader user is never told about. -->
    <div class="dock-wipe" role="status" aria-live="polite">
      <span class="dock-wipe-label">{wipe.label}</span>
    </div>
  {/key}
{/if}
