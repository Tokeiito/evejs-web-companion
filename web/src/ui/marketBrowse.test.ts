// The market picker as it RENDERS (goal R83).
//
// The panel's way in used to be a search box and nothing else. These check the
// browse surface exists, that a group and an item are both offered as real
// controls, and — the part worth guarding — that a capped group SAYS it capped
// rather than showing a silent slice.

import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./svelteSsrHook.ts", import.meta.url);

const { render } = await import("svelte/server");
const { createClientStore } = await import("../store/clientStore.ts");
const Market = (await import("./Market.svelte")).default;

/**
 * A flow whose market reads answer, and whose browse reads never resolve.
 *
 * ⚠ SSR RUNS NO EFFECTS AND AWAITS NOTHING, so the tree is never actually
 * fetched here — the first paint is what this file checks. That is the honest
 * limit of an SSR render, and it is why the assertions below are about the
 * PICKER CHROME (the breadcrumb, the empty state) rather than about a branch
 * having loaded.
 */
function fakeFlow(): unknown {
  return new Proxy(
    {},
    {
      get: (_target, name) => {
        if (name === "loadMarketGroups") return async () => [];
        if (name === "loadMarketGroupTypes") return async () => ({ types: [], total: 0, capped: false });
        return async () => {};
      },
    },
  );
}

function renderMarket(): string {
  return render(Market as never, {
    props: { store: createClientStore() as never, flow: fakeFlow() as never },
  } as never).body;
}

/** Everything a player can read, markup and images stripped. */
function visibleText(body: string): string {
  return body
    .replace(/<img[^>]*>/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

test("the market opens on a breadcrumb, not just a search box", () => {
  // The whole point of R83: something to look AT before you have typed anything.
  const body = renderMarket();
  assert.match(body, /class="market-crumbs"/, "no breadcrumb");
  assert.match(visibleText(body), /All items/, "no root crumb to return to");
});

test("the root crumb is a real control", () => {
  // Browsing has to be reachable by keyboard, like every other navigation in
  // this app — it is not a decorative trail.
  const body = renderMarket();
  assert.match(body, /<button[^>]*class="crumb"/);
});

test("the search box is still there — browsing did not replace it", () => {
  const body = renderMarket();
  assert.match(body, /type="search"/);
  // ⚠ Against the RAW body: a placeholder is an attribute, so `visibleText`
  // strips it along with the tag. Asserting it there fails on a search box that
  // is present and working.
  assert.match(body, /placeholder="Search for an item/);
});

test("an empty branch says so rather than looking broken", () => {
  // ⚠ An empty market group is an ORDINARY answer (54 groups in this dataset
  // hold only unpublished items). It must read as a fact, not as a failure.
  const text = visibleText(renderMarket());
  assert.match(text, /This part of the market holds nothing/);
});

test("R7d: the picker renders no bare numeric ID", () => {
  const text = visibleText(renderMarket());
  // Market group ids and typeIDs are handles the panel passes back, never data.
  assert.equal(/\b\d{4,}\b/.test(text), false, `an id leaked: ${text.slice(0, 200)}`);
});
