<script lang="ts">
  // The safety selector as it stands: its three buttons, and the two that
  // confirm a lower level or let it go (shipSafetyButton.SafetyLevelSelector).
  //
  // What a press does is the chooser's (SafetyChooser.svelte). This says what
  // there is to press: a button that would do nothing cannot be pressed, the
  // level now is marked, and each level has beside it what it lets the ship
  // do, or the two buttons while it waits to be confirmed.
  import { safetyPress, type SafetyChoice, type SafetyLevel, type SafetyLocks } from "../space/crimewatch.ts";

  let { choices, confirming, setting, locks, error, onpress, onconfirm, oncancel }: {
    choices: readonly SafetyChoice[];
    confirming: SafetyLevel | null;
    setting: boolean;
    locks: SafetyLocks;
    error: string;
    onpress: (choice: SafetyChoice) => void;
    onconfirm: (level: SafetyLevel) => void;
    oncancel: () => void;
  } = $props();
</script>

<div class="safety-menu" role="group" aria-label="Safety level">
  {#if locks.full}
    <p class="safety-note">The security of this system holds the safety at Full.</p>
  {:else if locks.alpha}
    <p class="safety-note">An alpha clone cannot set the safety to None in high security.</p>
  {/if}
  {#each choices as choice (choice.level)}
    <div class="safety-row">
      <button
        type="button"
        class="safety-choice safety-{choice.tone}"
        aria-pressed={choice.selected}
        disabled={setting || safetyPress(choice, confirming) === "nothing"}
        onclick={() => onpress(choice)}
      >{choice.word}</button>
      {#if confirming === choice.level}
        <button type="button" class="safety-confirm" disabled={setting} onclick={() => onconfirm(choice.level)}>
          {setting ? "Setting…" : `Confirm ${choice.word}`}
        </button>
        <button type="button" class="safety-cancel" disabled={setting} onclick={oncancel}>Cancel</button>
      {:else}
        <span class="safety-says">{choice.says}</span>
      {/if}
    </div>
  {/each}
  {#if error}<p class="safety-error" role="alert">{error}</p>{/if}
</div>
