<script lang="ts">
  // R107 — the character bar across the top of the tab: every online pilot as a
  // chip, the active one highlighted, a server-connection indicator, plus "Add
  // character". One cockpit shows at a time (the active pilot's Workspace, below);
  // clicking a chip switches which. All the pilots stay live on the BFF while
  // backgrounded — this bar just picks which one the workspace is driving.
  import CharacterChip from "./CharacterChip.svelte";
  import type { Session } from "../app/sessions.ts";

  let { sessions, activeId, serverStatus, onSwitch, onAdd }: {
    sessions: Session[];
    activeId: string | null;
    serverStatus: "checking" | "online" | "offline";
    onSwitch: (id: string) => void;
    onAdd: () => void;
  } = $props();

  const statusLabel = $derived(
    serverStatus === "online"
      ? "Connected"
      : serverStatus === "offline"
        ? "Server offline"
        : "Connecting…",
  );
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
  <span class="char-bar-status char-bar-status-{serverStatus}" title={`Server: ${statusLabel}`}>
    <span class="char-bar-status-dot"></span>
    <span class="char-bar-status-text">{statusLabel}</span>
  </span>
  <button type="button" class="char-bar-add" onclick={onAdd}>+ Add character</button>
</div>
