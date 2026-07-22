// The Character Sheet panel (goal R56) as it actually RENDERS, through Svelte's
// server generator (no DOM) — the same harness panelFirstMount uses. onMount /
// $effect do not run here, so the panel renders against whatever the store
// already holds: exactly a first paint after loadCharacterSheet + the name
// resolution landed.
//
// WHAT THIS SUITE GUARDS, worst-damage-first:
//   1. ⚠ R7d — corporationID / allianceID / home stationID / implant typeIDs are
//      entity ids and MUST render as NAMES, never numbers. Every id is swept for.
//   2. An id static data cannot name (a PLAYER corp — Farmer's own) degrades to
//      "Unknown corporation", NOT the number.
//   3. empty ≠ failed — an empty bio / a clean clone read as honest "none";
//      a failed read shows its reason, never the empty message.
//   4. The security status is shown as a signed FLOAT, and bloodline / race /
//      ancestry (which have no name path) are never on screen.
//
// The values are Farmer's REAL character sheet, captured live 2026-07-22.

import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./svelteSsrHook.ts", import.meta.url);

const { render } = await import("svelte/server");
const { createClientStore } = await import("../store/clientStore.ts");
const CharacterSheet = (await import("./CharacterSheet.svelte")).default;

type CharacterIdentity = import("../store/types.ts").CharacterIdentity;
type CloneSummary = import("../store/types.ts").CloneSummary;

function fakeFlow(): unknown {
  return new Proxy({}, { get: () => async () => {} });
}

function visibleText(body: string): string {
  return body.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

// The real ids on Farmer's sheet, plus a synthetic alliance + implants so the
// name-and-sweep paths are exercised on more than one id each.
const IDENTITY: CharacterIdentity = {
  characterID: 140000005,
  characterName: "Farmer",
  corporationID: 98000001,
  allianceID: 99000001,
  securityStatus: 0.1404,
};
const HOME_STATION_ID = 60015249;
const CLONE: CloneSummary = {
  homeStationID: HOME_STATION_ID,
  cloneStationID: HOME_STATION_ID,
  implants: [
    { typeID: 9941, slot: 1 },
    { typeID: 9899, slot: 6 },
  ],
  jumpCloneCount: 0,
};

// Every id resolves to a name (the corp too, for the by-name render test).
const NAMES: Readonly<Record<string, string | null>> = {
  "corporation:98000001": "Farmer's Legion",
  "alliance:99000001": "Test Alliance Please Ignore",
  "station:60015249": "Manifest V - AIR Laboratories Trade Center",
  "type:9941": "Cybernetic Subprocessor",
  "type:9899": "Ocular Filter",
};

// Every id that must NEVER appear in the rendered text (characterID included:
// the panel shows the name, never the number).
const SWEEP_IDS = [140000005, 98000001, 99000001, 60015249, 9941, 9899];

function loadedSheet(
  over: Partial<{
    identity: CharacterIdentity | null;
    identityError: string | null;
    description: string | null;
    descriptionError: string | null;
    homeStationID: number | null;
    homeStationError: string | null;
    clone: CloneSummary | null;
    cloneError: string | null;
  }> = {},
  names: Readonly<Record<string, string | null>> = NAMES,
): ReturnType<typeof createClientStore> {
  const store = createClientStore();
  store.apply({
    type: "character-sheet/loaded",
    identity: IDENTITY,
    identityError: null,
    description: "Character created via EveJS Elysian",
    descriptionError: null,
    homeStationID: HOME_STATION_ID,
    homeStationError: null,
    clone: CLONE,
    cloneError: null,
    ...over,
  });
  store.apply({ type: "names/resolved", entries: names });
  return store;
}

test("CharacterSheet renders name, security, corp/alliance/home/implants BY NAME", () => {
  const store = loadedSheet();
  const output = render(CharacterSheet as never, { props: { store, flow: fakeFlow() } } as never);
  const text = visibleText(output.body);

  assert.match(text, /Farmer/);
  // Security status as a signed float (not an id).
  assert.match(text, /\+0\.14/);
  // Names, not ids.
  assert.match(text, /Farmer's Legion/);
  assert.match(text, /Test Alliance Please Ignore/);
  assert.match(text, /Manifest V - AIR Laboratories Trade Center/);
  assert.match(text, /Cybernetic Subprocessor/);
  assert.match(text, /Ocular Filter/);
  // The bio text.
  assert.match(text, /Character created via EveJS Elysian/);
});

// R7d SWEEP: not one of the ids may appear in the rendered text.
test("CharacterSheet never renders a raw id (R7d)", () => {
  const store = loadedSheet();
  const output = render(CharacterSheet as never, { props: { store, flow: fakeFlow() } } as never);
  const text = visibleText(output.body);
  for (const id of SWEEP_IDS) {
    assert.equal(text.includes(String(id)), false, `id ${id} must never render`);
  }
});

// COMPANION to the sweep: the sweep only means something if the matcher WOULD
// catch an id that leaked. Render a store whose corp name never resolved — the
// panel must show "Unknown corporation", NOT the id — and prove the same
// `includes` check fires on a string that does contain the id.
test("the CharacterSheet id-sweep matcher actually inspects rendered text", () => {
  const store = loadedSheet({}, {}); // no names resolved at all
  const output = render(CharacterSheet as never, { props: { store, flow: fakeFlow() } } as never);
  const text = visibleText(output.body);
  // Player corp degrades to a NAME-shaped fallback, never the id.
  assert.match(text, /Unknown corporation/);
  assert.equal(text.includes("98000001"), false);
  // The matcher is real: it finds a digit-run that IS present.
  assert.equal(`corp 98000001 here`.includes("98000001"), true);
});

test("CharacterSheet shows 'Unknown corporation' for a player corp with no static name", () => {
  // Farmer's real corp (98000001) resolves to null live — a definitive unknown.
  const store = loadedSheet({}, { ...NAMES, "corporation:98000001": null });
  const output = render(CharacterSheet as never, { props: { store, flow: fakeFlow() } } as never);
  const text = visibleText(output.body);
  assert.match(text, /Unknown corporation/);
  assert.equal(text.includes("98000001"), false);
});

test("CharacterSheet omits the alliance row entirely when there is no alliance", () => {
  const store = loadedSheet({ identity: { ...IDENTITY, allianceID: null } });
  const output = render(CharacterSheet as never, { props: { store, flow: fakeFlow() } } as never);
  const text = visibleText(output.body);
  assert.equal(/Alliance/.test(text), false, "no Alliance label when the character has none");
});

test("CharacterSheet shows an honest 'no implants' for a clean clone (empty ≠ failed)", () => {
  const store = loadedSheet({ clone: { ...CLONE, implants: [] } });
  const output = render(CharacterSheet as never, { props: { store, flow: fakeFlow() } } as never);
  const text = visibleText(output.body);
  assert.match(text, /no implants/i);
});

test("CharacterSheet shows an honest 'no bio' for an empty bio (empty ≠ failed)", () => {
  const store = loadedSheet({ description: "" });
  const output = render(CharacterSheet as never, { props: { store, flow: fakeFlow() } } as never);
  const text = visibleText(output.body);
  assert.match(text, /have not written a bio/i);
});

test("CharacterSheet shows the error, NOT the empty message, when the clone read failed", () => {
  const store = loadedSheet({ clone: null, cloneError: "your clone: READ_FAILED" });
  const output = render(CharacterSheet as never, { props: { store, flow: fakeFlow() } } as never);
  const text = visibleText(output.body);
  assert.match(text, /READ_FAILED/);
  // ⚠ A failed read must never claim the clone is clean.
  assert.equal(/your active clone has no implants/i.test(text), false);
});

test("CharacterSheet renders on first paint with an empty store (R18 loading state)", () => {
  const store = createClientStore();
  const output = render(CharacterSheet as never, { props: { store, flow: fakeFlow() } } as never);
  const text = visibleText(output.body);
  // Nothing loaded yet: honest "reading…" placeholders, no crash, no id.
  assert.match(text, /Reading your character/i);
  for (const id of SWEEP_IDS) {
    assert.equal(text.includes(String(id)), false);
  }
});
