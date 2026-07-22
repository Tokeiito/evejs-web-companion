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

type LedgerEntry = import("../store/types.ts").LedgerEntry;

function fakeFlow(): unknown {
  return new Proxy({}, { get: () => async () => {} });
}

function visibleText(body: string): string {
  return body.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

// The R54 ledger fields default to null (unread) for the R50 balance/corp cases.
const NO_LEDGER = {
  journal: null,
  journalError: null,
  transactions: null,
  transactionsError: null,
} as const;

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
    ...NO_LEDGER,
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
    ...NO_LEDGER,
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
    ...NO_LEDGER,
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
    ...NO_LEDGER,
  });
  const output = render(CorpWallet as never, { props: { store, flow: fakeFlow() } } as never);
  const text = visibleText(output.body);
  assert.match(text, /READ_FAILED/);
  // ⚠ A failed read must never claim the corp has no divisions.
  assert.equal(/no wallet divisions/i.test(text), false);
});

// --- R54 Wallet ledger ------------------------------------------------------

// The three real ledger rows Farmer's wallet returned, already decoded to the
// LedgerEntry shape the store carries (transactionID kept only as `id`, dates as
// FILETIME bigints, ISK as signed decimal strings, ref-types as words).
const REAL_LEDGER: readonly LedgerEntry[] = [
  { id: "1784675859816261", date: 134291494598160000n, amount: "10000", refType: "Bounty Prize" },
  { id: "1784621463235892", date: 134290950632350000n, amount: "-1459390", refType: "Market Transaction" },
  { id: "1784233305981917", date: 134287069059810000n, amount: "-45000", refType: "Planetary Construction" },
];

function loadedWallet(over: Partial<{
  journal: readonly LedgerEntry[] | null;
  journalError: string | null;
  transactions: readonly LedgerEntry[] | null;
  transactionsError: string | null;
}>): ReturnType<typeof createClientStore> {
  const store = createClientStore();
  store.apply({
    type: "wallet/loaded",
    cashBalance: "115789452720",
    cashError: null,
    corpDivisions: null,
    corpError: null,
    journal: null,
    journalError: null,
    transactions: null,
    transactionsError: null,
    ...over,
  });
  return store;
}

test("Wallet renders each ledger row as date + ref-type WORDS + signed ISK", () => {
  const store = loadedWallet({ journal: REAL_LEDGER, transactions: [] });
  const output = render(Wallet as never, { props: { store, flow: fakeFlow() } } as never);
  const text = visibleText(output.body);
  // R9a: the ref-type reads as words, never the entryTypeID code (17/2/98).
  assert.match(text, /Bounty Prize/);
  assert.match(text, /Market Transaction/);
  assert.match(text, /Planetary Construction/);
  // A credit shows "+", a debit its "-"; both grouped, bigint-safe.
  assert.match(text, /\+10,000 ISK/);
  assert.match(text, /-1,459,390 ISK/);
});

// R7d SWEEP: no raw refID/ownerID/transactionID may appear in the rendered text.
test("Wallet never renders a raw id from a ledger row (R7d)", () => {
  const store = loadedWallet({ journal: REAL_LEDGER, transactions: REAL_LEDGER });
  const output = render(Wallet as never, { props: { store, flow: fakeFlow() } } as never);
  const text = visibleText(output.body);
  // transactionID (kept only as a keyed-each key) and the ids the decoder drops.
  assert.equal(text.includes("1784675859816261"), false, "transactionID must not render");
  assert.equal(text.includes("1784621463235892"), false, "transactionID must not render");
  assert.equal(text.includes("140000005"), false, "ownerID must not render");
  assert.equal(text.includes("21980"), false, "referenceID must not render");
});

// COMPANION to the sweep: the sweep is only meaningful if the rendered text
// COULD contain a bare number and the matcher would catch it. Here an amount
// deliberately contains the digit-run "45000" and the sweep-style matcher finds
// it — proving `includes` fires on rendered content, so the absences above mean
// something.
test("the Wallet id-sweep matcher actually inspects rendered text", () => {
  const store = loadedWallet({ journal: REAL_LEDGER, transactions: [] });
  const output = render(Wallet as never, { props: { store, flow: fakeFlow() } } as never);
  const text = visibleText(output.body);
  // "45,000" is the grouped amount of the -45000 debit; its digits are present.
  assert.equal(text.includes("45,000"), true);
});

test("Wallet shows an honest empty message for a real 'no ledger entries'", () => {
  const store = loadedWallet({ journal: [], transactions: [] });
  const output = render(Wallet as never, { props: { store, flow: fakeFlow() } } as never);
  const text = visibleText(output.body);
  assert.match(text, /No wallet activity yet/i);
  assert.match(text, /No market transactions yet/i);
});

test("Wallet shows the ledger error, NOT the empty message, when the read failed", () => {
  const store = loadedWallet({
    journal: null,
    journalError: "journal: READ_FAILED",
    transactions: [],
  });
  const output = render(Wallet as never, { props: { store, flow: fakeFlow() } } as never);
  const text = visibleText(output.body);
  assert.match(text, /READ_FAILED/);
  // ⚠ A failed journal read must never claim the wallet has no activity.
  assert.equal(/No wallet activity yet/i.test(text), false);
});
