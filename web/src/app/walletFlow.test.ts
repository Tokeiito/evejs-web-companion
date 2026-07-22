// loadWallet (goal R50) against the raw /api/bridge/wallet envelope. The BFF
// ships the personal balance (account.GetCashBalance) and the corp division
// balances (account.GetWalletDivisionsInfo) as raw retail shapes, plus the
// server-resolved division names; the flow decodes them into the wallet slice.
//
// ⚠ The invariant under test is empty-vs-failed: a FAILED corp read leaves
// corpDivisions null (with a corpError); a SUCCESSFUL empty read makes it [].

import test from "node:test";
import assert from "node:assert/strict";

import { createClientStore } from "../store/clientStore.ts";
import { createAppFlow } from "./flow.ts";
import type { JsonValue } from "../bridge/wire.ts";

function keyVal(entries: ReadonlyArray<readonly [string, JsonValue]>): JsonValue {
  return { type: "object", name: "util.KeyVal", args: { type: "dict", entries } };
}

function divisionsList(rows: ReadonlyArray<readonly [number, JsonValue]>): JsonValue {
  return {
    type: "list",
    items: rows.map(([key, balance]) => keyVal([["key", key], ["balance", balance]])),
  };
}

function walletFetch(body: unknown): typeof fetch {
  return (async (input: unknown) => ({
    ok: true,
    status: 200,
    async json() {
      return String(input) === "/api/bridge/wallet" ? body : { ok: true };
    },
  })) as unknown as typeof fetch;
}

test("loadWallet decodes the personal balance and the named corp divisions", async () => {
  const store = createClientStore();
  const flow = createAppFlow(store, {
    fetch: walletFetch({
      ok: true,
      cash: 1000165000,
      divisions: divisionsList([
        [1000, 500000000],
        [1001, 0],
      ]),
      divisionNames: { 1: "Master Wallet", 2: "" },
      errors: { cash: null, divisions: null, corp: null },
    }),
  });

  await flow.loadWallet();

  const wallet = store.wallet.get();
  assert.equal(wallet.loaded, true);
  assert.equal(wallet.cashBalance, "1000165000");
  assert.equal(wallet.cashError, null);
  assert.equal(wallet.corpError, null);
  assert.deepEqual(wallet.corpDivisions, [
    { key: 1000, division: 1, name: "Master Wallet", balance: "500000000" },
    // Blank name -> null (the panel shows "Division 2"); 0 ISK is a real balance.
    { key: 1001, division: 2, name: null, balance: "0" },
  ]);
});

test("loadWallet: a FAILED corp read leaves corpDivisions null and sets corpError", async () => {
  const store = createClientStore();
  const flow = createAppFlow(store, {
    fetch: walletFetch({
      ok: true,
      cash: 42,
      divisions: null,
      divisionNames: {},
      errors: { cash: null, divisions: "READ_FAILED", corp: "READ_FAILED" },
    }),
  });

  await flow.loadWallet();

  const wallet = store.wallet.get();
  assert.equal(wallet.loaded, true);
  // The personal balance survived a corp-side failure.
  assert.equal(wallet.cashBalance, "42");
  // ⚠ null, NOT [] — a failed read must never look like an empty corp wallet.
  assert.equal(wallet.corpDivisions, null);
  assert.match(wallet.corpError ?? "", /READ_FAILED/);
});

test("loadWallet: a SUCCESSFUL empty divisions list is [] (a real 'no divisions')", async () => {
  const store = createClientStore();
  const flow = createAppFlow(store, {
    fetch: walletFetch({
      ok: true,
      cash: 0,
      divisions: { type: "list", items: [] },
      divisionNames: {},
      errors: { cash: null, divisions: null, corp: null },
    }),
  });

  await flow.loadWallet();

  const wallet = store.wallet.get();
  assert.equal(wallet.corpError, null);
  // ⚠ [] not null — the corp genuinely has no wallet divisions.
  assert.deepEqual(wallet.corpDivisions, []);
});

test("loadWallet: a failed personal read carries its own error, corp unaffected", async () => {
  const store = createClientStore();
  const flow = createAppFlow(store, {
    fetch: walletFetch({
      ok: true,
      cash: null,
      divisions: divisionsList([[1000, 7]]),
      divisionNames: { 1: "Master Wallet" },
      errors: { cash: "READ_FAILED", divisions: null, corp: null },
    }),
  });

  await flow.loadWallet();

  const wallet = store.wallet.get();
  assert.equal(wallet.cashBalance, null);
  assert.equal(wallet.cashError, "READ_FAILED");
  assert.deepEqual(wallet.corpDivisions, [
    { key: 1000, division: 1, name: "Master Wallet", balance: "7" },
  ]);
});
