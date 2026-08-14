// The tactical viewport as it is actually WIRED (goal R70).
//
// `space/tactical.ts` proves the projection and `ui/tacticalDraw.ts` is exercised
// by the harness page; what neither can prove is that the desktop puts the thing
// on screen at all, and only while in space. That is this file's whole job.
//
// It renders `Desktop` through the SSR generator, so it checks the real
// component tree rather than a regex over markup. `$effect` never runs under SSR,
// so the canvas is never painted here — the assertion is about the LAYER being
// mounted (and about the docked case not mounting it), which is exactly the part
// a later refactor could silently drop.

import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./svelteSsrHook.ts", import.meta.url);

const { render } = await import("svelte/server");
const { createClientStore } = await import("../store/clientStore.ts");
const Desktop = (await import("./Desktop.svelte")).default;

/** A flow stub — the server generator never runs effects or handlers. */
function fakeFlow(): unknown {
  return new Proxy({}, { get: () => async () => {} });
}

function renderDesktop(isDocked: boolean): string {
  const store = createClientStore();
  return render(Desktop as never, {
    props: {
      store: store as never,
      flow: fakeFlow() as never,
      wins: [],
      focused: null,
      isDocked,
      onFocus: () => {},
      onClose: () => {},
      onToggleCollapse: () => {},
      onMove: () => {},
      onResize: () => {},
      onOpen: () => {},
    } as never,
  }).body;
}

test("in space the desktop mounts the tactical view as its backdrop", () => {
  const body = renderDesktop(false);
  assert.match(body, /class="tactical"/, "the viewport layer must be on the desktop");
  assert.match(body, /class="desktop has-view"/, "the desktop must drop its blueprint grid");
});

test("the viewport is announced to a screen reader, not left an unlabelled box", () => {
  // A canvas with no accessible name is a rectangle nobody can read. It carries
  // a role and a real summary, and it points at the list that IS operable by
  // keyboard — the canvas itself is a convenience on top of that, never the only
  // way to reach an object.
  const body = renderDesktop(false);
  assert.match(body, /role="img"/);
  assert.match(body, /aria-label="Tactical view:/);
  assert.match(body, /Use the overview list to select and act on them/);
});

test("docked, no tactical view is drawn at all", () => {
  // There is nothing outside to see. A starfield behind a market window would be
  // a lie about where the player is.
  const body = renderDesktop(true);
  assert.equal(/class="tactical"/.test(body), false, "no viewport while docked");
  assert.match(body, /class="desktop"/, "and the desktop keeps its ordinary surface");
});

test("the empty-desktop tip is shown docked and suppressed in space", () => {
  // In space the surface is a view of the grid, and covering it with a tip about
  // how windows work would hide the most useful thing on screen to explain the
  // least useful.
  assert.match(renderDesktop(true), /Open a panel from the left/);
  assert.equal(/Open a panel from the left/.test(renderDesktop(false)), false);
});

test("with nothing on grid the viewport says so rather than drawing a blank", () => {
  const body = renderDesktop(false);
  assert.match(body, /Nothing on grid\./);
  assert.match(body, /aria-label="Tactical view: nothing on grid\./);
});

test("the pointer to the keyboard path survives an EMPTY grid", () => {
  // The state where a player most needs telling where the real controls are is
  // the state with nothing to click — so the guidance must not be attached to
  // the "N objects" sentence. It was, once; this is what caught it.
  const body = renderDesktop(false);
  assert.match(body, /nothing on grid\. Use the overview list to select and act on them\./);
});
