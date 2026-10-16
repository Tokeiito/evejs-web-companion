<script lang="ts">
  // A trace's jump window (eve/client/script/ui/shared/abyss/AbyssJumpWindow.py AbyssActivationWindow), opened by
  // Activate Gate on an Abyssal trace once within 2,500 m (movementFunctions.RealActivateEntranceToAbyssalGate):
  // KeyActivationWindow.svelte in its trace's form, for the pilot in front. One at a time (Open closes another trace's).
  import KeyActivationWindow from "./KeyActivationWindow.svelte";
  import type { Session } from "../app/sessions.ts";

  let { session, inFront }: { session: Session; inFront: boolean } = $props();
  // svelte-ignore state_referenced_locally
  const flow = session.flow;
  // svelte-ignore state_referenced_locally
  const open = flow.abyssJump;
</script>

{#if $open !== null && inFront}
  <div class="abyss-jump-host">
    {#key $open.itemID}
      <KeyActivationWindow
        store={session.store}
        {flow}
        item={{ itemID: $open.itemID, typeID: $open.filamentTypeID, groupID: null, quantity: 0, ownedByPilot: false }}
        trace={{ gameModeID: $open.gameModeID }}
        onClose={() => flow.closeAbyssJump()}
      />
    {/key}
  </div>
{/if}

<style>
  .abyss-jump-host {
    position: fixed;
    inset: 72px 0 auto 0;
    height: 0;
    z-index: 60;
  }
</style>
