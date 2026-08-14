// The market picker as it RENDERS (goal R83).
//
// The panel's way in used to be a search box and nothing else. These check the
// browse surface exists, that a group and an item are both offered as real
// controls, and — the part worth guarding — that a capped group SAYS it capped
// rather than showing a silent slice.

import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

register("./svelteSsrHook.ts", import.meta.url);

const { render } = await import("svelte/server");
const { createClientStore } = await import("../store/clientStore.ts");
const Market = (await import("./Market.svelte")).default;

const UI_DIR = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(path.join(UI_DIR, "Market.svelte"), "utf8");

/**
 * The source with COMMENTS BLANKED.
 *
 * ⚠ Needed for any "this wording must not appear" check. The comment above
 * `useOrderPrice` explains that the panel never says "buy it now" — and a naive
 * scan of the raw source then finds that phrase and fails, reporting the
 * explanation as the offence. Blanking keeps offsets and line breaks intact.
 */
/** Replace every character except newlines with a space. */
function blank(text: string): string {
  return text.replace(/[^\n]/g, " ");
}

const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, (match) => blank(match))
  .replace(/<!--[\s\S]*?-->/g, (match) => blank(match))
  .replace(/(^|[^:])\/\/[^\n]*/g, (match, lead: string) => lead + blank(match).slice(lead.length));

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

// --- R84: the books --------------------------------------------------------

test("the order books are lists, not sideways-scrolling tables", () => {
  // Same failure the overview had (R82): six columns read in a window that is
  // nowhere near six columns wide.
  const body = renderMarket();
  // With no item chosen there are no rows, so this checks the SHAPE is gone:
  // the books must never render a table again.
  assert.equal(
    /On sale[\s\S]{0,400}<table/.test(body),
    false,
    "the sell book must not be a table",
  );
});

test("R7d: the picker renders no bare numeric ID", () => {
  const text = visibleText(renderMarket());
  // Market group ids and typeIDs are handles the panel passes back, never data.
  assert.equal(/\b\d{4,}\b/.test(text), false, `an id leaked: ${text.slice(0, 200)}`);
});

// --- R84: taking a price off the book ---------------------------------------
//
// The behaviour lives inside the component, so it is checked at the source
// rather than by driving a click through SSR (which runs no handlers). These
// pin the two caps, which are the part that can silently go wrong: a draft that
// offers more than the counterparty wants, or more than the stack holds, is a
// refusal the player only discovers on submit.

test("a book row drafts the OPPOSITE side", () => {
  // Clicking a SELL order (someone is selling) drafts a BUY, and vice versa.
  // Getting this backwards would offer to sell to a seller.
  assert.match(SOURCE, /useOrderPrice\(order, "buy"\)/, "the sell book must draft a buy");
  assert.match(SOURCE, /useOrderPrice\(order, "sell"\)/, "the buy book must draft a sell");
});

test("a sell draft is capped by BOTH the stack and what the buyer wants", () => {
  // ⚠ Two different refusals. Offering more than the stack holds is refused by
  // the inventory; offering more than the order wants is refused by the market.
  // Only taking the smaller avoids both.
  const fn = SOURCE.slice(SOURCE.indexOf("function useOrderPrice"));
  const body = fn.slice(0, fn.indexOf("\n  }\n"));
  assert.match(body, /Math\.min\(\s*stack\.quantity,\s*order\.volumeRemaining\s*\)/);
});

test("the row says it takes a PRICE, never that it buys", () => {
  // Placing a buy at a seller's price is not the same act as taking that
  // listing, and whether it matches at once is the server's business. The panel
  // has never claimed an outcome it has not read back.
  assert.match(SOURCE, /Use \$\{formatIsk\(order\.price\)\} as your buy price/);
  assert.match(SOURCE, /Use \$\{formatIsk\(order\.price\)\} as your sell price/);
  assert.equal(
    /Buy it now|Buy now|Instant buy/i.test(CODE),
    false,
    "no instant-buy claim in anything a player reads",
  );
});
