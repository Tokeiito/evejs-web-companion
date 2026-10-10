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

const WHOSE = { characterID: 140000002, corporationID: 98000001 };
const count = (asked: readonly string[], pair: string): number => asked.filter((each) => each.startsWith(pair)).length;
/** How many times each of the five has been asked, in the order: the ISK, the divisions, the corporation, the transactions, the kinds. */
const counts = (asked: readonly string[]): number[] =>
  ["account.GetCashBalance", "account.GetWalletDivisionsInfo", "corpRegistry.GetCorporation", "account.GetTransactions", "account.GetEntryTypes"].map((pair) => count(asked, pair));

test("several windows that want the wallet together ask for each thing once, and one that opens after asks for nothing", async () => {
  const { ask, asked } = asking(ANSWERS);
  const wallet = createWalletReads(ask, { now: () => 1_000_000 });
  // Three windows at once, as at a login.
  const three = await Promise.all([wallet.read(), wallet.read(), wallet.read()]);
  assert.deepEqual(counts(asked), [1, 1, 1, 1, 1]);
  for (const each of three) assert.deepEqual(JSON.parse(JSON.stringify(each)), JSON.parse(JSON.stringify(three[0])));
  assert.deepEqual([three[0]!.cash, three[0]!.entryTypes], [1000165000, { type: "list", items: [["a kind"]] }]);
  // A window opened later: everything is had.
  await wallet.read();
  assert.deepEqual(counts(asked), [1, 1, 1, 1, 1]);
  // Asked for afresh, as the window's own button asks: everything again but the kinds, which do not change.
  await wallet.read({ fresh: true });
  assert.deepEqual(counts(asked), [2, 2, 2, 2, 1]);
  await wallet.read({ fresh: false });
  await wallet.read({});
  assert.deepEqual(counts(asked), [2, 2, 2, 2, 1]);
  // Another pilot: what was kept was the last one's, all of it.
  wallet.forget();
  await wallet.read();
  assert.deepEqual(counts(asked), [3, 3, 3, 3, 2]);
});

test("the pilot's ISK is what the server says it is, from the moment it says so, with nothing asked", async () => {
  const { ask, asked } = asking(ANSWERS);
  const wallet = createWalletReads(ask, { now: () => 1_000_000 });
  assert.equal((await wallet.read()).cash, 1000165000);
  // OnAccountChange('cash', charID, balance), as the server sends it for the pilot's own ISK.
  wallet.accountChanged("cash", 140000002, 1000195800.5, WHOSE);
  const after = await wallet.read();
  assert.equal(after.cash, 1000195800.5);
  // accountsvc.OnAccountChange: the transactions kept are out of date, and are asked for again. Nothing else is.
  assert.deepEqual(counts(asked), [1, 1, 1, 2, 1]);
  // The owner said as the server may say it (a long is a string of digits on the wire's other spelling).
  wallet.accountChanged("cash", "140000002", { type: "long", value: "7" }, WHOSE);
  assert.deepEqual((await wallet.read()).cash, { type: "long", value: "7" });

  // What is not the pilot's own ISK changes nothing of it: another character's, a corporation's first account
  // (which has the same name), another account of the pilot's that is no ISK, and a balance of nothing.
  for (const [accountKey, ownerID, balance] of [["cash", 140000003, 1], ["cash", 98000001, 2], ["cash2", 140000002, 3], ["aur", 140000002, 4], ["cash", 140000002, null], [1000, 140000002, 5]] as const) {
    wallet.accountChanged(accountKey, ownerID, balance, WHOSE);
    assert.deepEqual((await wallet.read()).cash, { type: "long", value: "7" }, JSON.stringify([accountKey, ownerID, balance]));
  }
  assert.equal(count(asked, "account.GetCashBalance"), 1);
  // Each of them was still the server's word that an account changed: the transactions were asked for again each time.
  assert.equal(count(asked, "account.GetTransactions"), 3 + 6);
  // A pilot not yet known to be anyone has no ISK of its own to be told of.
  const nobody = createWalletReads(asking(ANSWERS).ask);
  await nobody.read();
  nobody.accountChanged("cash", 140000002, 9, { characterID: null, corporationID: null });
  assert.equal((await nobody.read()).cash, 1000165000);
});

test("the server's word of the ISK is kept over an asking that was still out when it came", async () => {
  const out: Array<(value: JsonValue) => void> = [];
  const { ask } = asking({ ...ANSWERS, "account.GetCashBalance": () => new Promise<JsonValue>((answer) => out.push(answer)) });
  const wallet = createWalletReads(ask);
  const first = wallet.read();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(out.length, 1);
  wallet.accountChanged("cash", 140000002, 200, WHOSE);
  out[0]!(100);
  // Who asked is answered with what it asked for; what is kept is the server's later word.
  assert.equal((await first).cash, 100);
  assert.equal((await wallet.read()).cash, 200);
  assert.equal(out.length, 1);
});

test("the corporation's divisions are kept five minutes, and forgotten when one of its accounts changes", async () => {
  let clock = 1_000_000;
  const { ask, asked } = asking(ANSWERS);
  const wallet = createWalletReads(ask, { now: () => clock });
  const divisions = (): number => count(asked, "account.GetWalletDivisionsInfo");
  await wallet.read();
  clock += 5 * 60_000 - 1;
  await wallet.read();
  assert.equal(divisions(), 1);
  // accountsvc.py 135: good for five minutes.
  clock += 1;
  await wallet.read();
  assert.equal(divisions(), 2);
  clock += 60_000;
  await wallet.read();
  assert.equal(divisions(), 2);
  // One of the corporation's seven accounts changed: asked for again when next wanted.
  for (const [index, accountKey] of ["cash", "cash2", "cash7"].entries()) {
    wallet.accountChanged(accountKey, 98000001, 5, WHOSE);
    await wallet.read();
    assert.equal(divisions(), 3 + index, accountKey);
  }
  // Another corporation's, a character's, an account that is none of the seven, a balance of nothing, and a
  // pilot in no corporation that is known: the divisions kept stand.
  for (const [accountKey, ownerID, balance, whose] of [["cash2", 98000002, 5, WHOSE], ["cash", 140000002, 5, WHOSE], ["cash8", 98000001, 5, WHOSE], ["cash2", 98000001, null, WHOSE],
    ["cash2", 98000001, 5, { characterID: 140000002, corporationID: null }]] as const) {
    wallet.accountChanged(accountKey, ownerID, balance, whose);
    await wallet.read();
    assert.equal(divisions(), 5, JSON.stringify([accountKey, ownerID, balance]));
  }
  // The corporation itself changed: its row is asked for again, and nothing else.
  const before = counts(asked);
  wallet.corporationChanged();
  await wallet.read();
  assert.deepEqual(counts(asked), [before[0], before[1], before[2]! + 1, before[3], before[4]]);
});

test("an asking that fails is not kept: those that asked together are each told, and the next read asks again", async () => {
  for (const [pair, key] of [["account.GetCashBalance", "cash"], ["account.GetWalletDivisionsInfo", "divisions"], ["corpRegistry.GetCorporation", "corp"], ["account.GetTransactions", "transactions"], ["account.GetEntryTypes", "entryTypes"]] as const) {
    let fails = true;
    let asks = 0;
    const wallet = createWalletReads(asking({ ...ANSWERS, [pair]: () => { asks += 1; if (fails) throw failing("CALL_TIMEOUT"); return (ANSWERS as Record<string, JsonValue>)[pair]!; } }).ask, { now: () => 1_000_000 });
    const failed = await Promise.all([wallet.read(), wallet.read()]);
    assert.deepEqual([failed.map((each) => each.errors[key]), asks], [["CALL_TIMEOUT", "CALL_TIMEOUT"], 1], pair);
    fails = false;
    assert.deepEqual([(await wallet.read()).errors[key], asks], [null, 2], pair);
    await wallet.read();
    assert.equal(asks, 2, pair);
  }
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

test("the pilot's own ISK alone is one call, asked of the server each time: a guard's asking, kept by nobody", async () => {
  const { ask, asked } = asking(ANSWERS);
  const wallet = createWalletReads(ask);
  assert.equal(await wallet.cash(), 1000165000);
  assert.deepEqual(asked, ["account.GetCashBalance(0)"]);
  // Asked again each time, whatever the server has said since and whatever a window has kept.
  wallet.accountChanged("cash", 140000002, 5, WHOSE);
  assert.equal(await wallet.cash(), 1000165000);
  await wallet.read();
  assert.equal(await wallet.cash(), 1000165000);
  assert.equal(count(asked, "account.GetCashBalance"), 3);
  // And what a guard was answered is not what a window is shown: that is still the server's word.
  assert.equal((await wallet.read()).cash, 5);
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
