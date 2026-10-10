// loadWallet (goal R50). The page asks the wallet's five calls itself, by the
// generic call (bridge/walletReads.ts; the plan's Phase 6b): the personal balance
// (account.GetCashBalance), the corp division balances
// (account.GetWalletDivisionsInfo), the corporation's own row for their names,
// the transactions and the entry kinds. The flow decodes them into the wallet
// slice. Each test describes a wallet as the five answers and their failures;
// the stand-in for the BFF answers each call from that.
//
// ⚠ The invariant under test is empty-vs-failed: a FAILED corp read leaves
// corpDivisions null (with a corpError); a SUCCESSFUL empty read makes it [].

import test from "node:test";
import assert from "node:assert/strict";

import { createClientStore } from "../store/clientStore.ts";
import { createAppFlow } from "./flow.ts";
import { bridgeAsk } from "./api.ts";
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

/** A corporation's own row (corpRegistry.GetCorporation, a util.Row) with these wallet divisions named, and its hangar's named otherwise. */
function corporationRow(walletNames: Record<number, string>): JsonValue {
  const header: string[] = [];
  const line: JsonValue[] = [];
  for (let division = 1; division <= 7; division += 1) {
    header.push(`division${division}`, `walletDivision${division}`);
    line.push(`Hangar ${division}`, walletNames[division] ?? null);
  }
  return { type: "object", name: "util.Row", args: { type: "dict", entries: [["header", { type: "list", items: header }], ["line", { type: "list", items: line }]] } };
}

interface WalletAnswers {
  readonly cash?: JsonValue;
  readonly divisions?: JsonValue;
  /** The corporation's own names for its wallet divisions, by ordinal. */
  readonly divisionNames?: Record<number, string>;
  readonly transactions?: JsonValue;
  readonly entryTypes?: JsonValue;
  /** Why each call fails, where it does. */
  readonly errors?: Partial<Record<"cash" | "divisions" | "corp" | "transactions" | "entryTypes", string | null>>;
}

/** The BFF's generic call, answering the wallet's five calls from a wallet described; and what was asked of it. */
function walletFetch(wallet: WalletAnswers, asked: string[] = []): typeof fetch {
  const errors = wallet.errors ?? {};
  const answers: Record<string, readonly [JsonValue, string | null | undefined]> = {
    "account.GetCashBalance": [wallet.cash ?? null, errors.cash],
    "account.GetWalletDivisionsInfo": [wallet.divisions ?? null, errors.divisions],
    "corpRegistry.GetCorporation": [corporationRow(wallet.divisionNames ?? {}), errors.corp],
    "account.GetTransactions": [wallet.transactions ?? null, errors.transactions],
    "account.GetEntryTypes": [wallet.entryTypes ?? null, errors.entryTypes],
  };
  return (async (input: unknown, init?: RequestInit) => {
    if (String(input) !== "/api/bridge/call") {
      asked.push(String(input));
      return { ok: true, status: 200, async json() { return { ok: true }; } };
    }
    const { service, method, args } = JSON.parse(String(init?.body)) as { service: string; method: string; args: JsonValue[] };
    asked.push(`${service}.${method}(${JSON.stringify(args).slice(1, -1)})`);
    const [result, failure] = answers[`${service}.${method}`] ?? [null, "CALL_NOT_ALLOWED"];
    return failure
      ? { ok: false, status: 502, async json() { return { ok: false, error: failure, message: `${service}.${method} failed.` }; } }
      : { ok: true, status: 200, async json() { return { ok: true, service, method, result, notifications: [] }; } };
  }) as unknown as typeof fetch;
}

test("loadWallet decodes the personal balance and the named corp divisions", async () => {
  const store = createClientStore();
  const asked: string[] = [];
  const flow = createAppFlow(store, {
    fetch: walletFetch({
      cash: 1000165000,
      divisions: divisionsList([
        [1000, 500000000],
        [1001, 0],
        [1002, 5],
      ]),
      divisionNames: { 1: "not the corporation's to name", 2: "Payroll", 3: "" },
      errors: { cash: null, divisions: null, corp: null },
    }, asked),
  });

  await flow.loadWallet();

  const wallet = store.wallet.get();
  assert.equal(wallet.loaded, true);
  assert.equal(wallet.cashBalance, "1000165000");
  assert.equal(wallet.cashError, null);
  assert.equal(wallet.corpError, null);
  assert.deepEqual(wallet.corpDivisions, [
    // The first is the master wallet, which the client names itself and no corporation does: the panel has its word.
    { key: 1000, division: 1, name: null, balance: "500000000" },
    // The corporation's own name for its second wallet division, and never its second hangar's.
    { key: 1001, division: 2, name: "Payroll", balance: "0" },
    // Blank name -> null (the panel shows "Division 3"); 5 ISK is a real balance.
    { key: 1002, division: 3, name: null, balance: "5" },
  ]);
  // Asked as the client's own services ask, by the generic call, and of no route of the wallet's own.
  assert.deepEqual(asked.slice().sort(), [
    "account.GetCashBalance(0)",
    "account.GetEntryTypes()",
    "account.GetTransactions(1000,null,null,false)",
    "account.GetWalletDivisionsInfo()",
    "corpRegistry.GetCorporation()",
  ]);
  // Read again, as when another of its windows opens: everything is had, and nothing is asked.
  await flow.loadWallet();
  assert.equal(asked.length, 5);
  // The window's own Refresh asks the server again, for all but the entry kinds.
  await flow.loadWallet({ fresh: true });
  assert.deepEqual([asked.length, asked.filter((each) => each === "account.GetEntryTypes()").length], [9, 1]);
});

test("loadWallet: a FAILED corp read leaves corpDivisions null and sets corpError", async () => {
  const store = createClientStore();
  const flow = createAppFlow(store, {
    fetch: walletFetch({
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
      cash: null,
      divisions: divisionsList([[1001, 7]]),
      divisionNames: { 2: "Payroll" },
      errors: { cash: "READ_FAILED", divisions: null, corp: null },
    }),
  });

  await flow.loadWallet();

  const wallet = store.wallet.get();
  assert.equal(wallet.cashBalance, null);
  assert.equal(wallet.cashError, "READ_FAILED");
  assert.deepEqual(wallet.corpDivisions, [
    { key: 1001, division: 2, name: "Payroll", balance: "7" },
  ]);
});

// --- R54 ledger ------------------------------------------------------------

// The GetEntryTypes cached envelope, trimmed to the ref-types under test.
function entryTypes(pairs: ReadonlyArray<readonly [number, string]>): JsonValue {
  return {
    type: "object",
    name: { type: "rawstr", value: "carbon.common.script.net.objectCaching.CachedMethodCallResult" },
    args: [
      { type: "dict", entries: [] },
      {
        type: "substream",
        value: {
          type: "list",
          items: pairs.map(([id, name]) =>
            keyVal([["entryTypeID", id], ["entryTypeName", name]]),
          ),
        },
      },
    ],
  };
}

test("loadWallet decodes the wallet's activity, read as the client reads it, with ref-type labels", async () => {
  const store = createClientStore();
  const flow = createAppFlow(store, {
    fetch: walletFetch({
      cash: 115789452720,
      divisions: null,
      divisionNames: {},
      // account.GetTransactions answers a list of KeyVals, one for each entry.
      transactions: { type: "list", items: [keyVal([
        ["transactionID", 1784675859816261], ["transactionDate", { type: "long", value: "134291494598160000" }], ["referenceID", 21980], ["entryTypeID", 17],
        ["ownerID1", 140000005], ["ownerID2", 140000005], ["accountKey", 1000], ["amount", 10000], ["balance", 115789452720.04], ["description", "NBL"], ["currency", 1], ["sortValue", 1],
      ])] },
      entryTypes: entryTypes([[17, "BountyPrize"]]),
      errors: { cash: null, divisions: "READ_FAILED", corp: "READ_FAILED", transactions: null, entryTypes: null },
    }),
  });

  await flow.loadWallet();

  const wallet = store.wallet.get();
  assert.deepEqual(wallet.journal, [
    { id: "1784675859816261", date: 134291494598160000n, amount: "10000", refType: "Bounty Prize" },
  ]);
  assert.equal(wallet.journalError, null);
});

test("loadWallet: a wallet with no activity is an empty list, not a failed read", async () => {
  const store = createClientStore();
  const flow = createAppFlow(store, {
    fetch: walletFetch({
      cash: 42, divisions: null, divisionNames: {}, transactions: { type: "list", items: [] }, entryTypes: null,
      errors: { cash: null, divisions: null, corp: null, transactions: null, entryTypes: null },
    }),
  });
  await flow.loadWallet();
  // ⚠ [] not null — a SUCCESSFUL empty read is a real "none yet".
  assert.deepEqual(store.wallet.get().journal, []);
  assert.equal(store.wallet.get().journalError, null);
});

test("loadWallet: a FAILED read of the activity leaves it null and says why", async () => {
  const store = createClientStore();
  const flow = createAppFlow(store, {
    fetch: walletFetch({
      cash: 42,
      divisions: null,
      divisionNames: {},
      transactions: null,
      entryTypes: null,
      errors: { cash: null, divisions: null, corp: null, transactions: "READ_FAILED", entryTypes: null },
    }),
  });

  await flow.loadWallet();

  const wallet = store.wallet.get();
  // ⚠ null, NOT [] — a failed read must never look like an empty ledger.
  assert.equal(wallet.journal, null);
  assert.match(wallet.journalError ?? "", /READ_FAILED/);
  // The personal balance survived the failure.
  assert.equal(wallet.cashBalance, "42");
});

// --- the asking itself -------------------------------------------------------

test("a call the page makes for itself hands on what came with its answer, to whoever was listening when it was asked", async () => {
  const heard: unknown[] = [];
  let listeners = 0;
  const sent: Array<{ url: string; body: unknown; token: string | null }> = [];
  const answers: Array<() => unknown> = [
    () => ({ ok: true, service: "account", method: "GetCashBalance", result: 42, notifications: [{ method: "OnAccountChange" }, { method: "OnItemChange" }] }),
    () => ({ ok: true, service: "account", method: "GetCashBalance", result: 43 }),
    () => ({ ok: false, error: "CALL_REFUSED", message: "Not now." }),
  ];
  const ask = bridgeAsk({
    token: "the-pilot's",
    fetch: (async (input: unknown, init?: RequestInit) => {
      sent.push({ url: String(input), body: JSON.parse(String(init?.body)), token: (init?.headers as Record<string, string>).authorization ?? null });
      const body = answers.shift()!();
      return { ok: (body as { ok: boolean }).ok, status: (body as { ok: boolean }).ok ? 200 : 409, async json() { return body; } };
    }) as unknown as typeof fetch,
    // Taken when the call is asked, as a route's request takes it: what answers a retired pilot's call is not the next pilot's.
    captureNotificationSink: () => {
      const listener = (listeners += 1);
      return (notifications) => heard.push([listener, notifications]);
    },
  });
  assert.equal(await ask("account", "GetCashBalance", [0]), 42);
  assert.deepEqual(sent, [{ url: "/api/bridge/call", body: { service: "account", method: "GetCashBalance", args: [0], kwargs: null }, token: "Bearer the-pilot's" }]);
  assert.deepEqual(heard, [[1, [{ method: "OnAccountChange" }, { method: "OnItemChange" }]]]);
  // An answer with nothing beside it hands on nothing, and says so.
  assert.equal(await ask("account", "GetCashBalance", [0]), 43);
  assert.deepEqual(heard[1], [2, []]);
  // A call that fails fails for who asked, with its code, and hands on nothing.
  await assert.rejects(ask("account", "GetCashBalance", [0]), (error) => (error as { code?: string }).code === "CALL_REFUSED");
  assert.deepEqual([heard.length, listeners], [2, 3]);
  // With nobody listening, it is just the answer.
  const quiet = bridgeAsk({ fetch: (async () => ({ ok: true, status: 200, async json() { return { ok: true, service: "s", method: "m", result: "r", notifications: [{ method: "OnX" }] }; } })) as unknown as typeof fetch });
  assert.equal(await quiet("s", "m", []), "r");
});

// --- the server's word that an account changed --------------------------------

test("the balance on show moves by the server's word alone: OnAccountChange, with the transactions read again and nothing else", async () => {
  const store = createClientStore();
  const asked: string[] = [];
  const wallet = walletFetch({ cash: 1000, divisions: { type: "list", items: [] }, transactions: { type: "list", items: [] } }, asked);
  const sources: Array<{ onmessage: ((event: { data: string }) => void) | null; onopen: (() => void) | null; onerror: (() => void) | null; close(): void }> = [];
  const flow = createAppFlow(store, {
    fetch: (async (input: unknown, init?: RequestInit) => {
      if (String(input) === "/api/bridge/select") {
        return { ok: true, status: 200, async json() { return { ok: true, character: { characterID: 7, characterName: "Test Pilot", stationID: 60003760, structureID: null, solarSystemID: 30000142, corporationID: 98000000 }, station: null, notifications: [] }; } };
      }
      return wallet(input as RequestInfo, init);
    }) as unknown as typeof fetch,
    eventSource: () => {
      const source = { onmessage: null, onopen: null, onerror: null, close() {} };
      sources.push(source);
      return source;
    },
  });
  await flow.selectCharacter(7);
  const walletAsked = (): string[] => asked.filter((each) => /^(account|corpRegistry)\./.test(each));
  const pushed = (sequence: number, method: string, args: unknown[]): void => sources[0]!.onmessage?.({ data: JSON.stringify({
    source: "evejs-web-gateway", apiVersion: 1, type: "event", cursor: { epoch: "e1", sequence }, event: { kind: "notification", notification: { kind: "client", method, args } },
  }) });
  const settle = async (): Promise<void> => { for (let turn = 0; turn < 20; turn += 1) await new Promise<void>((resolve) => setImmediate(resolve)); };

  // Told before the wallet has been read at all: nothing is drawn, and nothing is asked.
  pushed(1, "OnAccountChange", ["cash", 7, 900]);
  await settle();
  assert.deepEqual([store.wallet.get().loaded, walletAsked().length], [false, 0]);

  await flow.loadWallet();
  // (The word that came before the wallet was read stands: the pilot's ISK is what the server said.)
  assert.equal(store.wallet.get().cashBalance, "900");
  const before = walletAsked().length;

  // The server says the pilot's ISK is now this. The wallet on show says so, with only the transactions asked for.
  pushed(2, "OnAccountChange", ["cash", 7, 31700.5]);
  await settle();
  assert.equal(store.wallet.get().cashBalance, "31700.5");
  assert.deepEqual(walletAsked().slice(before), ["account.GetTransactions(1000,null,null,false)"]);

  // Another pilot's ISK is not this one's; and the same word heard twice is acted on once.
  pushed(3, "OnAccountChange", ["cash", 8, 5]);
  pushed(3, "OnAccountChange", ["cash", 7, 5]);
  await settle();
  assert.equal(store.wallet.get().cashBalance, "31700.5");

  // One of the pilot's corporation's accounts: its divisions are asked for again, and its ISK is not the pilot's.
  const mark = walletAsked().length;
  pushed(4, "OnAccountChange", ["cash2", 98000000, 77]);
  await settle();
  assert.deepEqual(walletAsked().slice(mark).sort(), ["account.GetTransactions(1000,null,null,false)", "account.GetWalletDivisionsInfo()"]);
  assert.equal(store.wallet.get().cashBalance, "31700.5");
  // The corporation itself changed: its row is asked for when the wallet is next read, and not before.
  pushed(5, "OnCorporationChanged", [98000000, {}]);
  await settle();
  assert.equal(walletAsked().length, mark + 2);
  await flow.loadWallet();
  assert.deepEqual(walletAsked().slice(mark + 2), ["corpRegistry.GetCorporation()"]);
});
