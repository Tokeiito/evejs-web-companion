// The wallet's reads, made by the page itself (bridge/walletReads.ts; the plan's Phase 6b).
//
// What has to hold: the calls are the client's own (walletSvc.py, accountsvc.py), each asked as the client asks
// it; what the client keeps is asked once; a read that fails is its own failure and no other's; and a session
// that is lost is said, whatever else was answered.

import test from "node:test";
import assert from "node:assert/strict";

import { createWalletReads, divisionNamesOf, type Ask } from "./walletReads.ts";
import type { JsonValue } from "./wire.ts";

/** A corporation's own row, in the shape the server sends it (util.Row: 51 columns on this server; these are some, in their order). */
function corporationRow(values: Record<string, JsonValue>): JsonValue {
  const header = ["corporationID", "corporationName", "ticker", "division1", "division2", "division3", "division4", "division5", "division6", "division7",
    "walletDivision1", "walletDivision2", "walletDivision3", "walletDivision4", "walletDivision5", "walletDivision6", "walletDivision7", "isRecruiting"];
  return {
    type: "object",
    name: "util.Row",
    args: { type: "dict", entries: [["header", { type: "list", items: header }], ["line", { type: "list", items: header.map((column) => values[column] ?? null) }]] },
  };
}

const failing = (code: string | undefined, message = "it failed"): Error => Object.assign(new Error(message), code === undefined ? {} : { code });

/** An asking the test answers, with what was asked kept in order. */
function asking(answers: Record<string, JsonValue | (() => JsonValue | Promise<JsonValue>)>): { ask: Ask; asked: string[] } {
  const asked: string[] = [];
  const ask: Ask = async (service, method, args) => {
    const pair = `${service}.${method}`;
    asked.push(`${pair}(${JSON.stringify(args).slice(1, -1)})`);
    const answer = answers[pair];
    return typeof answer === "function" ? answer() : answer ?? null;
  };
  return { ask, asked };
}

const ROW = corporationRow({ corporationID: 98000001, division1: "Hangar One", division2: "Hangar Two", walletDivision1: "never read", walletDivision2: "Payroll", walletDivision3: "  ", walletDivision5: "Ships" });
const NAMES = { 1: null, 2: "Payroll", 3: null, 4: null, 5: "Ships", 6: null, 7: null };
const ANSWERS = {
  "account.GetCashBalance": 1000165000,
  "account.GetWalletDivisionsInfo": { type: "list", items: [] },
  "corpRegistry.GetCorporation": ROW,
  "account.GetTransactions": { type: "list", items: [] },
  "account.GetEntryTypes": { type: "list", items: [["a kind"]] },
};

test("the wallet is read with the client's own calls, each asked as the client asks it", async () => {
  const { ask, asked } = asking(ANSWERS);
  const reads = await createWalletReads(ask).read();
  assert.deepEqual(asked, [
    // walletSvc.py 41: the pilot's own ISK.
    "account.GetCashBalance(0)",
    "account.GetWalletDivisionsInfo()",
    "corpRegistry.GetCorporation()",
    // accountsvc.py 116: GetTransactions(accountingKeyCash, year, month, False).
    "account.GetTransactions(1000,null,null,false)",
    "account.GetEntryTypes()",
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(reads)), {
    cash: 1000165000,
    divisions: { type: "list", items: [] },
    divisionNames: Object.fromEntries(Object.entries(NAMES)),
    transactions: { type: "list", items: [] },
    entryTypes: { type: "list", items: [["a kind"]] },
    errors: { cash: null, divisions: null, corp: null, transactions: null, entryTypes: null },
  });
});

test("the kinds of a wallet entry are asked once and kept, however many want them and however many at once", async () => {
  let fails = false;
  let asks = 0;
  const { ask, asked } = asking({ ...ANSWERS, "account.GetEntryTypes": () => { asks += 1; if (fails) throw failing("CALL_TIMEOUT"); return { type: "list", items: [["a kind"]] }; } });
  const wallet = createWalletReads(ask);
  const count = (pair: string): number => asked.filter((each) => each.startsWith(pair)).length;
  // Three windows at once: one asking for the kinds, and three for everything else.
  const three = await Promise.all([wallet.read(), wallet.read(), wallet.read()]);
  assert.deepEqual([count("account.GetEntryTypes"), count("account.GetCashBalance"), count("account.GetTransactions")], [1, 3, 3]);
  for (const each of three) assert.deepEqual(each.entryTypes, { type: "list", items: [["a kind"]] });
  await wallet.read();
  assert.deepEqual([count("account.GetEntryTypes"), count("account.GetCashBalance")], [1, 4]);

  // Another pilot: what was kept was the last one's, and is asked for again.
  wallet.forget();
  await wallet.read();
  assert.equal(count("account.GetEntryTypes"), 2);

  // An asking that fails is not kept: those that asked together are each told, and the next read asks again.
  wallet.forget();
  fails = true;
  const failed = await Promise.all([wallet.read(), wallet.read()]);
  assert.deepEqual(failed.map((each) => [each.entryTypes, each.errors.entryTypes]), [[null, "CALL_TIMEOUT"], [null, "CALL_TIMEOUT"]]);
  assert.equal(asks, 3);
  fails = false;
  assert.deepEqual((await wallet.read()).errors.entryTypes, null);
  assert.equal(asks, 4);
  await wallet.read();
  assert.equal(asks, 4);
});

test("an asking for the kinds from before the pilot changed, failing late, does not take away what was asked for since", async () => {
  const out: Array<{ answer: (value: JsonValue) => void; fail: (error: Error) => void }> = [];
  const { ask } = asking({ ...ANSWERS, "account.GetEntryTypes": () => new Promise<JsonValue>((answer, fail) => out.push({ answer, fail })) });
  const wallet = createWalletReads(ask);
  const turn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
  const first = wallet.read();
  await turn();
  assert.equal(out.length, 1);
  // Another pilot, and its wallet read: asked for afresh, and answered.
  wallet.forget();
  const second = wallet.read();
  await turn();
  assert.equal(out.length, 2);
  out[1]!.answer({ type: "list", items: [["the new pilot's"]] });
  assert.deepEqual((await second).entryTypes, { type: "list", items: [["the new pilot's"]] });
  // The old asking fails now: who asked it is told, and what is kept is still the new one's.
  out[0]!.fail(failing("CALL_TIMEOUT"));
  assert.equal((await first).errors.entryTypes, "CALL_TIMEOUT");
  assert.deepEqual((await wallet.read()).entryTypes, { type: "list", items: [["the new pilot's"]] });
  assert.equal(out.length, 2);
});

test("each read fails by itself, with why; and a session that is lost is said, whatever else was answered", async () => {
  const one = async (pair: string, failure: Error) => createWalletReads(asking({ ...ANSWERS, [pair]: () => { throw failure; } }).ask).read();
  assert.deepEqual((await one("account.GetCashBalance", failing("CALL_REFUSED"))).errors, { cash: "CALL_REFUSED", divisions: null, corp: null, transactions: null, entryTypes: null });
  const corpless = await one("account.GetWalletDivisionsInfo", failing("CALL_REFUSED"));
  assert.deepEqual([corpless.divisions, corpless.errors.divisions, corpless.cash], [null, "CALL_REFUSED", 1000165000]);
  // The corporation's row not had: no names, which the panel has its own words for, and the divisions still read.
  const nameless = await one("corpRegistry.GetCorporation", failing("EVE_GATEWAY_TIMEOUT"));
  assert.deepEqual([nameless.divisionNames, nameless.errors.corp, nameless.errors.divisions], [{}, "EVE_GATEWAY_TIMEOUT", null]);
  const unread = await one("account.GetTransactions", failing(undefined));
  assert.deepEqual([unread.transactions, unread.errors.transactions], [null, "READ_FAILED"]);
  // A failure that says nothing of itself is still a failure.
  const odd = await createWalletReads(asking({ ...ANSWERS, "account.GetCashBalance": () => Promise.reject("just a string") as never }).ask).read();
  assert.equal(odd.errors.cash, "READ_FAILED");
  // A read answered with nothing at all is an answer of nothing, and no failure.
  const empty = await createWalletReads(asking({ ...ANSWERS, "account.GetCashBalance": () => undefined as never }).ask).read();
  assert.deepEqual([empty.cash, empty.errors.cash], [null, null]);

  const lost = failing("SESSION_NOT_FOUND", "The pilot's session is gone.");
  for (const pair of Object.keys(ANSWERS)) {
    await assert.rejects(one(pair, lost), (error) => error === lost, pair);
  }
});

test("the pilot's own ISK alone is one call", async () => {
  const { ask, asked } = asking(ANSWERS);
  assert.equal(await createWalletReads(ask).cash(), 1000165000);
  assert.deepEqual(asked, ["account.GetCashBalance(0)"]);
  await assert.rejects(createWalletReads(asking({ "account.GetCashBalance": () => { throw failing("CALL_REFUSED"); } }).ask).cash(), /it failed/);
});

test("a wallet division is named by the corporation's wallet columns, as the client names it: never by its hangar's, and the first by none", () => {
  assert.deepEqual(divisionNamesOf(ROW), Object.fromEntries(Object.entries(NAMES)));
  // Every wallet division named, the master wallet's column among them: the first is still the client's own to name.
  const all = corporationRow(Object.fromEntries(Array.from({ length: 7 }, (unused, index) => [`walletDivision${index + 1}`, `Wallet ${index + 1}`])));
  assert.deepEqual(divisionNamesOf(all), { 1: null, 2: "Wallet 2", 3: "Wallet 3", 4: "Wallet 4", 5: "Wallet 5", 6: "Wallet 6", 7: "Wallet 7" });
  // The hangar's names alone name no wallet division.
  const hangars = corporationRow(Object.fromEntries(Array.from({ length: 7 }, (unused, index) => [`division${index + 1}`, `Hangar ${index + 1}`])));
  const none = { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null, 7: null };
  assert.deepEqual(divisionNamesOf(hangars), none);
  // What is no name is none: a number, a blank, a column not there.
  assert.deepEqual(divisionNamesOf(corporationRow({ walletDivision2: 7, walletDivision3: "", walletDivision4: null })), none);
  // And what is no such row names nothing.
  for (const other of [null, 7, "a row", [], {}, { type: "list", items: [] }, { type: "object", args: null }, { type: "object", args: { entries: "none" } },
    { type: "object", args: { entries: [["header", null], ["line", { items: "none" }]] } }, { type: "notanobject", args: (ROW as { args: JsonValue }).args }] as JsonValue[]) {
    assert.deepEqual(divisionNamesOf(other), none, JSON.stringify(other));
  }
});
