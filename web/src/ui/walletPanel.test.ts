// The Wallet + Corp Wallet panels (goal R50) render real balances, and the Corp
// Wallet panel tells an EMPTY corp wallet apart from a FAILED read. Rendered
// through Svelte's server generator (no DOM), the same harness panelFirstMount
// uses. onMount/$effect do not run here, so the panels render against whatever
// the store already holds — exactly what a first paint after a loadWallet shows.

import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./svelteSsrHook.ts", import.meta.url);

const { render } = await import("svelte/server");
const { createClientStore } = await import("../store/clientStore.ts");
const { formatIsk } = await import("./isk.ts");
const Wallet = (await import("./Wallet.svelte")).default;
const CorpWallet = (await import("./CorpWallet.svelte")).default;

function fakeFlow(): unknown {
  return new Proxy({}, { get: () => async () => {} });
}

function visibleText(body: string): string {
  return body.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

// --- formatIsk (companion proof for the panels' amount formatting) ----------

test("formatIsk groups, suffixes ISK, and never goes through Number", () => {
  assert.equal(formatIsk("1000165000"), "1,000,165,000 ISK");
  assert.equal(formatIsk("0"), "0 ISK");
  assert.equal(formatIsk("-2500"), "-2,500 ISK");
  assert.equal(formatIsk("1234.50"), "1,234.5 ISK");
  // A balance past 2^53 must stay EXACT (the failure mode of Number()).
  assert.equal(formatIsk("9007199254740993"), "9,007,199,254,740,993 ISK");
  assert.equal(formatIsk(null), "—");
});

// --- Wallet -----------------------------------------------------------------

test("Wallet renders the personal balance as grouped ISK", () => {
  const store = createClientStore();
  store.apply({
    type: "wallet/loaded",
    cashBalance: "1000165000",
    cashError: null,
    corpDivisions: null,
    corpError: null,
  });
  const output = render(Wallet as never, { props: { store, flow: fakeFlow() } } as never);
  const text = visibleText(output.body);
  assert.match(text, /1,000,165,000 ISK/);
});

// --- Corp Wallet ------------------------------------------------------------

test("CorpWallet renders each division by name with its balance", () => {
  const store = createClientStore();
  store.apply({
    type: "wallet/loaded",
    cashBalance: "10",
    cashError: null,
    corpDivisions: [
      { key: 1000, division: 1, name: "Master Wallet", balance: "500000000" },
      { key: 1001, division: 2, name: null, balance: "0" },
    ],
    corpError: null,
  });
  const output = render(CorpWallet as never, { props: { store, flow: fakeFlow() } } as never);
  const text = visibleText(output.body);
  assert.match(text, /Master Wallet/);
  assert.match(text, /500,000,000 ISK/);
  // A nameless division falls back to a plain "Division N" label, never a key.
  assert.match(text, /Division 2/);
  assert.equal(text.includes("1000"), false, "the account key is never rendered");
  assert.equal(text.includes("1001"), false, "the account key is never rendered");
});

test("CorpWallet shows an honest empty message for a real 'no divisions'", () => {
  const store = createClientStore();
  store.apply({
    type: "wallet/loaded",
    cashBalance: "10",
    cashError: null,
    corpDivisions: [],
    corpError: null,
  });
  const output = render(CorpWallet as never, { props: { store, flow: fakeFlow() } } as never);
  const text = visibleText(output.body);
  assert.match(text, /no wallet divisions/i);
});

test("CorpWallet shows the error, NOT the empty message, when the read failed", () => {
  const store = createClientStore();
  store.apply({
    type: "wallet/loaded",
    cashBalance: "10",
    cashError: null,
    // Failed read: divisions null, error carried.
    corpDivisions: null,
    corpError: "corp wallet: READ_FAILED",
  });
  const output = render(CorpWallet as never, { props: { store, flow: fakeFlow() } } as never);
  const text = visibleText(output.body);
  assert.match(text, /READ_FAILED/);
  // ⚠ A failed read must never claim the corp has no divisions.
  assert.equal(/no wallet divisions/i.test(text), false);
});
