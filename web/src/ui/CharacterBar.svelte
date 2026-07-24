<script lang="ts">
  // R107 — the character bar across the top of the tab: every online pilot as a
  // chip, the active one highlighted, plus "Add character". One cockpit shows at
  // a time (the active pilot's Workspace, below); clicking a chip switches which.
  // All the pilots stay live on the BFF while backgrounded — this bar just picks
  // which one the workspace is driving.
  import CharacterChip from "./CharacterChip.svelte";
  import type { Session } from "../app/sessions.ts";

  let { sessions, activeId, onSwitch, onAdd }: {
    sessions: Session[];
    activeId: string | null;
    onSwitch: (id: string) => void;
    onAdd: () => void;
  } = $props();
</script>

<div class="char-bar">
  <span class="char-bar-brand">EVEJS</span>
  <div class="char-bar-list">
    {#each sessions as session (session.id)}
      <CharacterChip
        {session}
        active={session.id === activeId}
        onSelect={() => onSwitch(session.id)}
      />
    {/each}
  </div>
  <button type="button" class="char-bar-add" onclick={onAdd}>+ Add character</button>
</div>
