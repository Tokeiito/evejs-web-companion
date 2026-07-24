<script lang="ts">
  // R107 multibox — the whole tab. Several pilots are online at once, each a
  // fully isolated session (its own store + its own per-session-token flow, see
  // app/sessions.ts). This component owns the roster:
  //   • `sessions`  — the ONLINE pilots, one chip each in the character bar,
  //   • `activeId`  — which pilot's cockpit (Workspace) is showing right now,
  //   • `onboarding`— the pilot currently logging in / selecting a character,
  //                   shown full-screen at boot or over the workspace for "Add".
  // Exactly one Workspace is mounted (the active pilot); every other pilot's
  // store+flow stay live in memory and keep refreshing themselves on the BFF, so
  // switching is instant and safe. Login/select and all fetch/decode live
  // elsewhere; this file is pure orchestration.
  import CharacterBar from "./CharacterBar.svelte";
  import Onboarding from "./Onboarding.svelte";
  import Workspace from "./Workspace.svelte";
  import { createSession, type Session } from "../app/sessions.ts";

  // The online roster, the active pilot, and the one being added. The first
  // pilot starts onboarding immediately (createSession warms its health ping).
  let sessions = $state<Session[]>([]);
  let activeId = $state<string | null>(null);
  let onboarding = $state<Session | null>(createSession());

  const active = $derived(sessions.find((s) => s.id === activeId) ?? null);

  // A pilot finished login+select: promote it from onboarding into the online
  // roster and make it the active cockpit (matches "Add character makes it
  // active", and is the natural landing for the first pilot too).
  function completeOnboarding(): void {
    const s = onboarding;
    if (!s) return;
    sessions = [...sessions, s];
    activeId = s.id;
    onboarding = null;
  }

  // Log another pilot in WITHOUT disturbing the current ones: a fresh isolated
  // session in an overlay. One add at a time.
  function addCharacter(): void {
    if (onboarding) return;
    onboarding = createSession();
  }

  // Abandon an in-progress add: tear the pending session down (best-effort, so a
  // partial BFF login does not linger past its TTL) and drop the overlay.
  function cancelOnboarding(): void {
    const s = onboarding;
    onboarding = null;
    if (s) void s.flow.logout().catch(() => {});
  }

  function switchTo(id: string): void {
    activeId = id;
  }

  // The characters already live in this tab, so the "Add character" picker can
  // disable a quick-add that would just be refused as "already in use". Kept in
  // sync by the same station subscriptions that drive pruning, below.
  let onlineIDs = $state<Set<number>>(new Set());
  function recomputeOnline(): void {
    const ids = new Set<number>();
    for (const s of sessions) {
      const on = s.store.station.get().online;
      if (on) ids.add(on.characterID);
    }
    onlineIDs = ids;
  }

  // Remove a pilot the instant its store reports offline — release, logout, or a
  // lost session from inside its own workspace. Re-fix the active cockpit, and if
  // the tab is now empty, drop back to a fresh full-screen login.
  function removeSession(id: string): void {
    const remaining = sessions.filter((s) => s.id !== id);
    if (remaining.length === sessions.length) return;
    sessions = remaining;
    if (activeId === id) {
      activeId = remaining.length > 0 ? remaining[remaining.length - 1].id : null;
    }
    if (remaining.length === 0 && onboarding === null) {
      onboarding = createSession();
    }
  }

  // Watch every online pilot's station slice; when one goes offline, prune it.
  // Re-subscribes when the roster changes. The signal fires synchronously with
  // the current value on subscribe, which for an online pilot is a no-op, so
  // this never prunes a pilot that is still live.
  $effect(() => {
    const unsubs = sessions.map((s) =>
      s.store.station.subscribe((slice) => {
        if (slice.online === null) removeSession(s.id);
        recomputeOnline();
      }),
    );
    recomputeOnline();
    return () => {
      for (const unsub of unsubs) unsub();
    };
  });
</script>

{#if active}
  <CharacterBar {sessions} {activeId} onSwitch={switchTo} onAdd={addCharacter} />
  <!-- Remount on switch: each Workspace binds one stable store/flow for its
       whole life, and the in-memory store makes the remount instant. -->
  {#key active.id}
    <Workspace store={active.store} flow={active.flow} />
  {/key}
{/if}

{#if onboarding}
  {#if active}
    <!-- Add character: an overlay over the live workspace, which keeps running. -->
    <div class="onboarding-overlay">
      <div class="onboarding-frame">
        <div class="onboarding-frame-head">
          <span class="onboarding-frame-title">Add character</span>
          <button type="button" class="minor" onclick={cancelOnboarding}>Cancel</button>
        </div>
        <Onboarding store={onboarding.store} flow={onboarding.flow} {onlineIDs} onOnline={completeOnboarding} />
      </div>
    </div>
  {:else}
    <!-- First pilot: full-screen login, nothing behind it. -->
    <h1>EveJS Web</h1>
    <Onboarding store={onboarding.store} flow={onboarding.flow} {onlineIDs} onOnline={completeOnboarding} />
  {/if}
{/if}
