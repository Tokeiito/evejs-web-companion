<script lang="ts">
  // The refit block's fitting picker: a select whose dropdown opens with a
  // filter field on top and the fits grouped under their hull below it. A
  // native <select> cannot hold a text field, so this is a button plus a
  // listbox, driven like one: arrows move, Enter picks, Escape closes.
  //
  // The list stays in the DOM while closed (hidden), so the SSR render that is
  // the only net a template has here still sees every fit.

  import { fittingPickerGroups, type PickerFitting } from "../bots/fittingPicker.ts";

  let {
    id,
    fittings,
    value,
    onPick,
  }: {
    id: string;
    fittings: readonly PickerFitting[];
    /** The picked fittingID, or null when nothing is picked yet. */
    value: number | null;
    onPick: (fittingID: number) => void;
  } = $props();

  let open = $state(false);
  let query = $state("");
  let active = $state<number | null>(null);
  let root: HTMLDivElement | undefined = $state();
  let filter: HTMLInputElement | undefined = $state();

  const groups = $derived(fittingPickerGroups(fittings, query, value));
  const flat = $derived(groups.flatMap((g) => g.fittings.map((f) => f.fittingID)));
  const picked = $derived(fittings.find((f) => f.fittingID === value) ?? null);
  const pickedLabel = $derived(
    picked === null ? null : picked.shipName ? `${picked.name} (${picked.shipName})` : picked.name,
  );

  function show(): void {
    open = true;
    query = "";
    active = value;
    queueMicrotask(() => filter?.focus());
  }
  function hide(): void {
    open = false;
  }
  function choose(fittingID: number): void {
    onPick(fittingID);
    hide();
  }
  function move(step: number): void {
    if (flat.length === 0) return;
    const at = active === null ? -1 : flat.indexOf(active);
    active = flat[Math.max(0, Math.min(flat.length - 1, at + step))] ?? null;
    root?.querySelector(`[data-fitting="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const target = active !== null && flat.includes(active) ? active : flat[0];
      if (target !== undefined) choose(target);
    } else if (e.key === "Escape") { e.preventDefault(); hide(); }
  }
  // The typed filter always lands on the first match, so Enter picks it.
  $effect(() => {
    void query;
    if (open && (active === null || !flat.includes(active))) active = flat[0] ?? null;
  });
  // A click anywhere outside the picker closes it, as a select would.
  $effect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (root && !root.contains(e.target as Node)) hide();
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  });
</script>

<div class="fitting-select" bind:this={root}>
  <button
    {id}
    type="button"
    class="trigger"
    aria-haspopup="listbox"
    aria-expanded={open}
    onclick={() => (open ? hide() : show())}>
    <span class:placeholder={pickedLabel === null}>{pickedLabel ?? "pick a saved fitting..."}</span>
    <span class="chevron" aria-hidden="true"></span>
  </button>
  <div class="popup" hidden={!open}>
    <input
      bind:this={filter}
      bind:value={query}
      type="search"
      placeholder="filter by ship or fitting name"
      aria-label="Filter saved fittings by ship or fitting name"
      onkeydown={onKey} />
    <div class="list" role="listbox" aria-label="Saved fittings">
      {#each groups as g (g.label)}
        <div class="group" role="group" aria-label={g.label}>
          <div class="group-label">{g.label}</div>
          {#each g.fittings as f (f.fittingID)}
            <div
              class="option"
              class:active={f.fittingID === active}
              class:picked={f.fittingID === value}
              role="option"
              tabindex="-1"
              aria-selected={f.fittingID === value}
              data-fitting={f.fittingID}
              onpointerenter={() => (active = f.fittingID)}
              onclick={() => choose(f.fittingID)}
              onkeydown={onKey}>{f.label}</div>
          {/each}
        </div>
      {:else}
        <div class="empty">{fittings.length === 0 ? "No saved fittings to pick from." : "No fitting matches the filter."}</div>
      {/each}
    </div>
  </div>
</div>

<style>
  .fitting-select {
    position: relative;
    width: 100%;
  }
  .trigger {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    background: var(--color-field);
    color: var(--color-text-bright);
    border: 1px solid var(--color-line-strong);
    border-radius: var(--radius-control);
    padding: 0.45rem 0.55rem;
    min-height: 2.5rem;
    text-align: left;
    font: inherit;
  }
  .placeholder {
    color: var(--color-muted);
  }
  .chevron {
    flex: none;
    width: 0.4rem;
    height: 0.4rem;
    margin-right: 0.2rem;
    border-right: 1.5px solid var(--color-muted);
    border-bottom: 1.5px solid var(--color-muted);
    transform: translateY(-0.15rem) rotate(45deg);
  }
  .popup {
    position: absolute;
    z-index: 20;
    top: calc(100% + 2px);
    left: 0;
    right: 0;
    display: flex;
    flex-direction: column;
    background: var(--color-panel-3);
    border: 1px solid var(--color-line-strong);
    box-shadow: 0 6px 18px rgb(0 0 0 / 0.5);
  }
  .popup[hidden] {
    display: none;
  }
  .popup input {
    margin: 0.35rem;
  }
  .list {
    max-height: 18rem;
    overflow-y: auto;
    padding-bottom: 0.3rem;
  }
  .group-label {
    padding: 0.35rem 0.55rem 0.15rem;
    color: var(--color-accent);
    font-weight: 600;
  }
  .option {
    padding: 0.3rem 0.55rem 0.3rem 1.3rem;
    color: var(--color-text);
    cursor: pointer;
  }
  .option.active {
    background: var(--color-panel-2);
    color: var(--color-text-bright);
  }
  .option.picked {
    color: var(--color-accent-bright);
  }
  .empty {
    padding: 0.4rem 0.55rem;
    color: var(--color-muted);
  }
</style>
