<script lang="ts">
  // The ship's safety button and the selector it opens (shipSafetyButton.py).
  //
  // The client's button is on the ship's HUD and shows the level by its
  // colour. Pressed, it opens a selector of three: None, Partial and Full,
  // the level now marked. A level higher than the one now, or the same, is
  // set at once. A lower one wants a second press, on a button to confirm,
  // and nothing else in the selector answers until that is pressed or gone.
  // Where the level is held at Full the other two cannot be pressed. Once
  // the server has taken a level, the selector closes. It closes too when it
  // loses the keyboard.
  //
  // Here the selector is a popover of the browser's: drawn in its top layer,
  // over whatever window floats above the header (the page's own windows are
  // in a layer above the whole workspace, which nothing in the header can be
  // raised over), and closed by a press anywhere else or by Escape. Its place
  // is worked out from the button's as it opens. A level waiting to be
  // confirmed has a Cancel beside it. The words are this page's own.
  import { isSessionLost } from "../app/flow.ts";
  import type { AppFlow } from "../app/flow.ts";
  import { panelErrorWords } from "../bridge/refusals.ts";
  import { safetyChoices, safetyPress, type SafetyBadge, type SafetyChoice, type SafetyLevel } from "../space/crimewatch.ts";
  import SafetyMenu from "./SafetyMenu.svelte";

  const menuID = $props.id();
  let { flow, safety, lockedToFull }: { flow: AppFlow; safety: SafetyBadge; lockedToFull: boolean } = $props();

  let button = $state<HTMLButtonElement | null>(null);
  let menu = $state<HTMLElement | null>(null);
  let open = $state(false);
  let place = $state({ top: 0, left: 0 });
  let confirming = $state<SafetyLevel | null>(null);
  let setting = $state(false);
  let error = $state("");
  const choices = $derived(safetyChoices(safety.level, lockedToFull));

  /** Before the selector is shown: its place under the button, kept on the page, and nothing left of the last time. */
  function opening(event: ToggleEvent): void {
    if (event.newState !== "open" || button === null) return;
    const at = button.getBoundingClientRect();
    const widest = Math.min(26 * 16, window.innerWidth * 0.9);
    place = { top: at.bottom + 6, left: Math.max(8, Math.min(at.left, window.innerWidth - widest - 8)) };
    confirming = null;
    error = "";
    open = true;
  }

  /** Once it is hidden, by whatever hid it. */
  function closed(event: ToggleEvent): void {
    if (event.newState !== "closed") return;
    open = false;
    confirming = null;
  }

  function shut(): void {
    if (open) menu?.hidePopover();
  }

  async function set(level: SafetyLevel): Promise<void> {
    if (setting) return;
    setting = true;
    error = "";
    try {
      await flow.setSafetyLevel(level);
      shut();
    } catch (cause) {
      error = isSessionLost(cause) ? "The live session ended (idle timeout or another client took over)." : panelErrorWords(cause);
    } finally {
      setting = false;
      confirming = null;
    }
  }

  function press(choice: SafetyChoice): void {
    const does = safetyPress(choice, confirming);
    if (does === "confirm") {
      confirming = choice.level;
    } else if (does === "set") {
      void set(choice.level);
    }
  }
</script>

<!-- The selector's place was the button's when it opened: a page that moves under it shuts it. -->
<svelte:window onresize={shut} onscroll={shut} />

<span class="safety-chooser">
  <button
    bind:this={button}
    type="button"
    class="state-badge safety safety-{safety.tone}"
    aria-haspopup="true"
    aria-expanded={open}
    popovertarget={menuID}
    title="Your ship's safety level. Press to change it."
  >Safety {safety.word}</button>
  <div
    bind:this={menu}
    id={menuID}
    popover="auto"
    class="safety-pop"
    style:top="{place.top}px"
    style:left="{place.left}px"
    onbeforetoggle={opening}
    ontoggle={closed}
  >
    {#if open}
      <SafetyMenu {choices} {confirming} {setting} {lockedToFull} {error} onpress={press} onconfirm={(level) => void set(level)} oncancel={() => { confirming = null; }} />
    {/if}
  </div>
</span>
