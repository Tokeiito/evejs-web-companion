// The page asking the BFF for the retail client's own words (POST /api/words),
// and keeping what it is told. Batched and remembered as names are.

import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";

type Answer = { status: number; body: unknown };

function wordsFetch(answer: (labels: string[]) => Answer) {
  const asked: string[][] = [];
  const fetch = (async (input: unknown, init?: { body?: string }) => {
    const path = String(input);
    if (path !== "/api/words") {
      return { ok: true, status: 200, async json() { return { ok: true }; } };
    }
    const labels = (JSON.parse(init?.body ?? "{}") as { labels: string[] }).labels;
    asked.push(labels);
    const outcome = answer(labels);
    return { ok: outcome.status === 200, status: outcome.status, async json() { return outcome.body; } };
  }) as unknown as typeof globalThis.fetch;
  return { fetch, asked };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
const TEXTS: Record<string, string> = { "UI/A/Title": "A made-up title?", "UI/A/Body": "Until {[datetime]when}." };
const fromClient = (labels: string[]): Answer => ({
  status: 200,
  body: { ok: true, available: true, words: Object.fromEntries(labels.map((label) => [label, TEXTS[label] ?? null])) },
});

test("labels asked for in one tick go in one request, and what comes back is kept by label", async () => {
  const store = createClientStore();
  const { fetch, asked } = wordsFetch(fromClient);
  const flow = createAppFlow(store, { fetch });
  assert.deepEqual(store.get().words, { available: null, templates: {} });

  flow.requestWords(["UI/A/Title", "UI/A/Body"]);
  flow.requestWords(["UI/A/Body", "UI/Nope/Label", ""]);
  await settle();

  assert.deepEqual(asked, [["UI/A/Title", "UI/A/Body", "UI/Nope/Label"]]);
  assert.deepEqual(store.get().words, {
    available: true,
    templates: { "UI/A/Title": "A made-up title?", "UI/A/Body": "Until {[datetime]when}.", "UI/Nope/Label": null },
  });
});

test("a label is asked for once, whatever the answer was", async () => {
  const store = createClientStore();
  const { fetch, asked } = wordsFetch(fromClient);
  const flow = createAppFlow(store, { fetch });
  flow.requestWords(["UI/A/Title", "UI/Nope/Label"]);
  await settle();
  flow.requestWords(["UI/A/Title", "UI/Nope/Label"]);
  await settle();
  flow.requestWords(["UI/A/Body"]);
  await settle();
  assert.deepEqual(asked, [["UI/A/Title", "UI/Nope/Label"], ["UI/A/Body"]]);
  // A later answer adds to what is kept; it does not replace it.
  assert.deepEqual(Object.keys(store.get().words.templates).sort(), ["UI/A/Body", "UI/A/Title", "UI/Nope/Label"]);
});

test("with no client for the BFF to read, every label is null and nothing more is asked", async () => {
  const store = createClientStore();
  const { fetch, asked } = wordsFetch((labels) => ({
    status: 200,
    body: { ok: true, available: false, words: Object.fromEntries(labels.map((label) => [label, null])) },
  }));
  const flow = createAppFlow(store, { fetch });
  flow.requestWords(["UI/A/Title"]);
  await settle();
  flow.requestWords(["UI/A/Body"]);
  await settle();
  assert.deepEqual(asked, [["UI/A/Title"]], "the second label is answered without a request");
  assert.deepEqual(store.get().words, { available: false, templates: { "UI/A/Title": null, "UI/A/Body": null } });
});

test("a request that fails keeps nothing, so the same labels are asked again later", async () => {
  const store = createClientStore();
  let fail = true;
  const { fetch, asked } = wordsFetch((labels) => (fail ? { status: 502, body: { ok: false, error: "CALL_FAILED", message: "no" } } : fromClient(labels)));
  const flow = createAppFlow(store, { fetch });
  flow.requestWords(["UI/A/Title"]);
  await settle();
  assert.deepEqual(store.get().words, { available: null, templates: {} });
  fail = false;
  flow.requestWords(["UI/A/Title"]);
  await settle();
  assert.equal(asked.length, 2);
  assert.equal(store.get().words.templates["UI/A/Title"], "A made-up title?");
});

test("more labels than one request takes go in as many requests as that needs", async () => {
  const store = createClientStore();
  const { fetch, asked } = wordsFetch(fromClient);
  const flow = createAppFlow(store, { fetch });
  flow.requestWords(Array.from({ length: 450 }, (_, index) => `UI/Many/${index}`));
  await settle();
  assert.deepEqual(asked.map((labels) => labels.length), [200, 200, 50]);
  assert.equal(Object.keys(store.get().words.templates).length, 450);
});

test("a label the BFF's answer leaves out is kept as one the client has no text for", async () => {
  const store = createClientStore();
  const { fetch } = wordsFetch(() => ({ status: 200, body: { ok: true, available: true, words: { "UI/A/Title": "A made-up title?", "UI/Not/Asked": "stray" } } }));
  const flow = createAppFlow(store, { fetch });
  flow.requestWords(["UI/A/Title", "UI/Left/Out"]);
  await settle();
  // What was asked for, and only that: the one answered, the one left out as null, and nothing that was not asked.
  assert.deepEqual(store.get().words.templates, { "UI/A/Title": "A made-up title?", "UI/Left/Out": null });
});
