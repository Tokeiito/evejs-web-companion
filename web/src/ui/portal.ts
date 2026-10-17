// A popup moved to the document's body while it is shown (use:portal).
//
// ⚠ A WINDOW IS THE CONTAINING BLOCK OF ITS FIXED DESCENDANTS. `.win` has
// `filter: drop-shadow()` and `backdrop-filter` (styles.css), and either one
// makes an element the containing block of its `position: fixed` descendants.
// A menu or tooltip inside a window, placed by the pointer's (clientX/clientY)
// or an element's (getBoundingClientRect) screen coordinates, so landed offset
// by the window's own corner: a plan card's menu asked at (400, 600) showed at
// (620, 735) in a window at (219, 134) (seen 2026-10-17). On the body it is
// placed where it is asked.

/** Svelte action: the node moved to document.body, and taken away with it. */
export function portal(node: HTMLElement): { destroy(): void } {
  document.body.appendChild(node);
  return {
    destroy() {
      node.remove();
    },
  };
}
