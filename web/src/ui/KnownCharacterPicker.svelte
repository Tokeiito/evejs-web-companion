<script lang="ts">
  // R107 — the "pilots you've flown before" quick-pick shown above the login
  // form in the onboarding flow. One click brings a remembered pilot online
  // (sign in to its account, select it) instead of retyping the account name
  // and re-picking. A pilot already live in this window is shown disabled; the
  // × forgets a stale one from the local roster.
  import type { KnownCharacter } from "../app/knownCharacters.ts";

  let { known, onlineIDs, busyID, onPick, onForget }: {
    known: KnownCharacter[];
    onlineIDs: Set<number>;
    busyID: number | null;
    onPick: (character: KnownCharacter) => void;
    onForget: (characterID: number) => void;
  } = $props();
</script>

{#if known.length > 0}
  <section class="panel known-chars">
    <header class="panel-head">
      <h2>Your pilots</h2>
    </header>
    <p class="note">Bring a pilot you've flown before online in one click — or sign in below.</p>
    <ul class="known-list">
      {#each known as character (character.characterID)}
        {@const online = onlineIDs.has(character.characterID)}
        <li class="known-row">
          <button
            type="button"
            class="known"
            disabled={online || busyID !== null}
            onclick={() => onPick(character)}
          >
            <span class="name">{character.characterName}</span>
            <span class="detail">
              {character.accountName}{#if character.shipName} · {character.shipName}{/if}{#if character.skillPoints != null} · {character.skillPoints} SP{/if}
            </span>
            {#if online}
              <span class="detail known-state">Already in this window</span>
            {:else if busyID === character.characterID}
              <span class="detail known-state">Bringing online…</span>
            {/if}
          </button>
          <button
            type="button"
            class="known-forget"
            title="Forget {character.characterName}"
            aria-label="Forget {character.characterName}"
            disabled={busyID !== null}
            onclick={() => onForget(character.characterID)}
          >×</button>
        </li>
      {/each}
    </ul>
  </section>
{/if}
