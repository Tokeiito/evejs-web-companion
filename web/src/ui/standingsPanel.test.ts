// The Standings panel (goal R55) as it actually RENDERS, through Svelte's server
// generator (no DOM) — the same harness panelFirstMount uses. onMount/$effect do
// not run here, so the panel renders against whatever the store already holds:
// exactly a first paint after loadStandings + the name resolution landed.
//
// WHAT THIS SUITE GUARDS, worst-damage-first:
//   1. ⚠ R7d — a standing's `fromID` is an entity id and MUST render as a NAME,
//      never a number. The real ids from Farmer's standings are swept for.
//   2. Names are grouped the way the retail panel groups them (Factions /
//      Corporations / Agents), by the SAME id-range classification the flow
//      resolved them under.
//   3. empty ≠ failed — an empty standings list reads as "none yet"; a failed
//      read shows its reason and never the empty message.
//
// The rows are Farmer's REAL standings, captured live 2026-07-21.

import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./svelteSsrHook.ts", import.meta.url);

const { render } = await import("svelte/server");
const { createClientStore } = await import("../store/clientStore.ts");
const Standings = (await import("./Standings.svelte")).default;

type CharStanding = import("../store/types.ts").CharStanding;

function fakeFlow(): unknown {
  return new Proxy({}, { get: () => async () => {} });
}

function visibleText(body: string): string {
  return body.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

// Farmer's real char standings (a faction, an NPC corp, an agent, a negative).
const CHAR: readonly CharStanding[] = [
  { fromID: 500001, standing: 2.14 },
  { fromID: 500010, standing: -0.003 },
  { fromID: 1000030, standing: 1.304 },
  { fromID: 1000031, standing: -1.304 },
  { fromID: 3008416, standing: 0.13 },
];

// The names the flow's /api/names resolution returned for those ids, each under
// its classified kind (faction / corporation / agent).
const NAMES: Readonly<Record<string, string | null>> = {
  "faction:500001": "Caldari State",
  "faction:500010": "Guristas Pirates",
  "corporation:1000030": "Modern Finances",
  "corporation:1000031": "Chief Executive Panel",
  "agent:3008416": "Antaken Kamola",
};

function loadedStandings(
  over: Partial<{
    char: readonly CharStanding[] | null;
    charError: string | null;
    corp: readonly CharStanding[] | null;
    corpError: string | null;
  }> = {},
  names: Readonly<Record<string, string | null>> = NAMES,
): ReturnType<typeof createClientStore> {
  const store = createClientStore();
  store.apply({
    type: "standings/loaded",
    char: CHAR,
    charError: null,
    corp: null,
    corpError: null,
    ...over,
  });
  store.apply({ type: "names/resolved", entries: names });
  return store;
}

test("Standings renders each entity by NAME, grouped as the retail panel does", () => {
  const store = loadedStandings();
  const output = render(Standings as never, { props: { store, flow: fakeFlow() } } as never);
  const text = visibleText(output.body);
  // Names, not ids.
  assert.match(text, /Caldari State/);
  assert.match(text, /Guristas Pirates/);
  assert.match(text, /Modern Finances/);
  assert.match(text, /Antaken Kamola/);
  // The retail groupings.
  assert.match(text, /Factions/);
  assert.match(text, /Corporations/);
  assert.match(text, /Agents/);
  // The standing value on the −10..+10 scale, signed.
  assert.match(text, /\+2\.14/);
  assert.match(text, /−1\.30/);
});

// R7d SWEEP: not one of the real entity ids may appear in the rendered text.
test("Standings never renders a raw fromID (R7d)", () => {
  const store = loadedStandings();
  const output = render(Standings as never, { props: { store, flow: fakeFlow() } } as never);
  const text = visibleText(output.body);
  for (const { fromID } of CHAR) {
    assert.equal(
      text.includes(String(fromID)),
      false,
      `fromID ${fromID} must never render`,
    );
  }
});

// COMPANION to the sweep: the sweep only means something if the matcher WOULD
// catch a fromID that leaked. Render a store whose name never resolved — the
// panel must show the "Unknown entity" fallback, NOT the id — and prove the same
// `includes` check fires on a string that does contain the id.
test("the Standings id-sweep matcher actually inspects rendered text", () => {
  const store = loadedStandings(
    { char: [{ fromID: 500001, standing: 2.14 }] },
    {}, // no names resolved
  );
  const output = render(Standings as never, { props: { store, flow: fakeFlow() } } as never);
  const text = visibleText(output.body);
  // Degrades to a NAME-shaped fallback, never the id.
  assert.match(text, /Unknown entity/);
  assert.equal(text.includes("500001"), false);
  // The matcher is real: it finds a digit-run that IS present.
  assert.equal(`entity 500001 here`.includes("500001"), true);
});

test("Standings shows an honest empty message for a real 'no standings'", () => {
  const store = loadedStandings({ char: [], corp: [] });
  const output = render(Standings as never, { props: { store, flow: fakeFlow() } } as never);
  const text = visibleText(output.body);
  assert.match(text, /no standings with anyone yet/i);
});

test("Standings shows the error, NOT the empty message, when the read failed", () => {
  const store = loadedStandings({ char: null, charError: "your standings: READ_FAILED" });
  const output = render(Standings as never, { props: { store, flow: fakeFlow() } } as never);
  const text = visibleText(output.body);
  assert.match(text, /READ_FAILED/);
  // ⚠ A failed read must never claim the character stands with no one.
  assert.equal(/you have no standings with anyone yet/i.test(text), false);
});
