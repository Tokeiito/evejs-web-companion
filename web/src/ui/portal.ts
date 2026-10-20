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
//
// Measured in the page's browser (a fixed child asked at (10, 10) in a box at
// (300, 200)): `filter`, `backdrop-filter` and `contain: layout` move it to
// (310, 210); `container-type: inline-size` or `size` and a plain box do not. Of the
// page's fixed popups only those inside a `.win` are moved, and those are the
// ones that take this.

/** Svelte action: the node moved to document.body, and taken away with it. */
export function portal(node: HTMLElement, target: HTMLElement = document.body): { update(target: HTMLElement): void; destroy(): void } {
  target.appendChild(node);
  return {
    update(next) { if (node.parentElement !== next) next.appendChild(node); },
    destroy() {
      node.remove();
    },
  };
}
