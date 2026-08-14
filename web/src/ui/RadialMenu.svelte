<script lang="ts" module>
  /** One verb on the ring. `disabledReason` is the honest sentence, or null. */
  export interface RadialItem {
    /** Stable identity for keying. Never rendered. */
    readonly id: string;
    readonly label: string;
    /** null = usable. A sentence = why it is not, rendered ON the control. */
    readonly disabledReason: string | null;
  }
</script>

<script lang="ts">
  // THE RADIAL MENU (goal R77) — EVE's right-click ring.
  //
  // The verbs for a thing appear AROUND the thing, so the pointer starts in the
  // middle of them and every option is the same short flick away. A dropdown
  // makes you travel to the option you want and puts the ninth item nine times
  // further from the pointer than the first.
  //
  // Geometry and placement are `radialMenu.ts`; this file is the control.
  //
  // ⚠ IT IS A REAL MENU FOR THE KEYBOARD TOO, and that is not decoration. The
  // items are absolutely positioned but they are ordinary <button>s in ring
  // order, so Tab reaches them; arrow keys walk the ring and WRAP; Escape closes
  // and hands focus back to whatever opened it. A radial that could only be used
  // with a pointer would be a feature that quietly removed every verb from
  // anyone who does not use one — which is why the verb bar in the overview also
  // stays exactly where it was. This is an accelerator, never the only path.
  import { clampMenuCentre, moveRadialFocus, radialSlots } from "./radialMenu.ts";

  let {
    items,
    x,
    y,
    label = "Actions",
    onPick,
    onClose,
  }: {
    items: readonly RadialItem[];
    /** Where the menu was asked for, in viewport coordinates. */
    x: number;
    y: number;
    label?: string;
    onPick: (id: string) => void;
    onClose: () => void;
  } = $props();

  const RADIUS = 92;

  let root = $state<HTMLElement | null>(null);
  let focusIndex = $state(0);
  /** The viewport, so the ring can be nudged fully into view. */
  let bounds = $state({ width: 0, height: 0 });

  const slots = $derived(radialSlots(items.length, RADIUS));
  const centre = $derived(
    bounds.width > 0 ? clampMenuCentre(x, y, RADIUS, bounds) : { x, y },
  );

  $effect(() => {
    const measure = (): void => {
      bounds = { width: window.innerWidth, height: window.innerHeight };
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  });

  /**
   * Take the keyboard on open, so the ring is immediately usable without a
   * pointer — and so Escape has somewhere to be heard.
   */
  $effect(() => {
    const first = root?.querySelector<HTMLButtonElement>("button[data-radial-item]");
    first?.focus();
  });

  function focusAt(index: number): void {
    const buttons = root?.querySelectorAll<HTMLButtonElement>("button[data-radial-item]");
    buttons?.[index]?.focus();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    const next = moveRadialFocus(focusIndex, items.length, event.key);
    if (next !== focusIndex) {
      event.preventDefault();
      focusIndex = next;
      focusAt(next);
    }
  }

  function pick(item: RadialItem): void {
    if (item.disabledReason !== null) {
      return;
    }
    onPick(item.id);
    onClose();
  }
</script>

<!-- The backdrop closes the menu on any click outside it — including a
     right-click, so a second right-click somewhere else moves the menu rather
     than stacking a second one. It is transparent, not dimmed: a radial is a
     quick flick, and dimming the whole workspace for it would read as a modal. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="radial-backdrop"
  onclick={onClose}
  oncontextmenu={(event) => {
    event.preventDefault();
    onClose();
  }}
></div>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={root}
  class="radial"
  role="menu"
  aria-label={label}
  tabindex="-1"
  style={`left:${centre.x}px; top:${centre.y}px`}
  onkeydown={onKeyDown}
>
  <span class="radial-hub" aria-hidden="true"></span>
  {#each items as item, index (item.id)}
    {@const slot = slots[index]}
    <button
      type="button"
      role="menuitem"
      data-radial-item
      class="radial-item"
      class:unavailable={item.disabledReason !== null}
      disabled={item.disabledReason !== null}
      title={item.disabledReason ?? item.label}
      aria-label={item.disabledReason ? `${item.label} — ${item.disabledReason}` : item.label}
      style={`transform: translate(-50%, -50%) translate(${slot?.dx ?? 0}px, ${slot?.dy ?? 0}px)`}
      onclick={() => pick(item)}
      onfocus={() => (focusIndex = index)}
    >
      {item.label}
    </button>
  {/each}
</div>
