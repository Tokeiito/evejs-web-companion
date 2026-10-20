<script lang="ts">
  import type { Session } from "../app/sessions.ts";
  import DuelInvitationWindow from "./DuelInvitationWindow.svelte";
  let { session, inFront }: { session: Session; inFront: boolean } = $props();
  // svelte-ignore state_referenced_locally
  const invitation = session.flow.duelInvitation, station = session.store.station;
</script>
{#if $station.online && $invitation}{#key $invitation.n}<DuelInvitationWindow {session} invitation={$invitation} {inFront} />{/key}{/if}
