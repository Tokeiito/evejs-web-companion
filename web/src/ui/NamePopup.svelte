<script lang="ts">
  // The client's name popup (utilWindows.NamePopup, namedPopup.py NamePopupWnd): its caption, the field's word and the
  // field (with what it starts with and how long it may be), OK and Cancel. OK takes what was typed unless the
  // window's check refuses it (CheckName by default: nothing but spaces is refused, with UI/Common/PleaseTypeSomething,
  // which the client says in a dialog and the page says under the field); a check that refuses nothing is given as null.
  let {
    caption,
    label,
    value = "",
    maxLength = null,
    refusal,
    okWord,
    cancelWord,
    onok,
    oncancel,
  }: {
    caption: string;
    label: string;
    value?: string;
    maxLength?: number | null;
    /** What an empty name is refused with; null where the check refuses nothing. */
    refusal: string | null;
    okWord: string;
    cancelWord: string;
    onok: (text: string) => void;
    oncancel: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let typed = $state(value);
  let refused = $state("");

  function confirm(): void {
    if (refusal !== null && typed.trim().length < 1) {
      refused = refusal;
      return;
    }
    onok(typed);
  }
</script>

<div class="name-popup" role="dialog" aria-label={caption}>
  <h3>{caption}</h3>
  <form class="controls" onsubmit={(event) => { event.preventDefault(); confirm(); }}>
    <label>
      {label}
      <input type="text" bind:value={typed} maxlength={maxLength ?? undefined} />
    </label>
    <button type="submit">{okWord}</button>
    <button type="button" class="minor" onclick={oncancel}>{cancelWord}</button>
  </form>
  {#if refused}<p class="error">{refused}</p>{/if}
</div>

<style>
  .name-popup { border: 1px solid rgba(255, 255, 255, 0.15); padding: 0.5rem 0.75rem; margin: 0.5rem 0; }
  .name-popup h3 { margin: 0 0 0.25rem; }
</style>
