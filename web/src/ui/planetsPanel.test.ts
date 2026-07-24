// R41 as it actually RENDERS: the colonies, and what is on a planet.
//
// Screenshots have been unavailable to every worker on this repo — and the
// browser pane never flushes async panel content — so the only honest way to
// say "this is on screen" is to render the component and read the output. That
// is what this file does, through Svelte's server generator.
//
// Four claims are load-bearing and each is checked against real markup:
//
//   1. THREE OUTCOMES, FOUR SENTENCES, NONE OF THEM ALIKE. "Still loading",
//      "that read failed", "you genuinely have no colonies", and "this server
//      reported no colony information" are distinct facts about the world, and
//      only the third is a claim about the player. This is the defect class
//      this codebase keeps reproducing (worldHasNoContracts, ownsNothing).
//
//   2. NO NUMERIC IDs REACH THE PLAYER (R7d). A planet is "Tanoo I", a
//      structure is its name. planetIDs, pinIDs and typeIDs live only in keys,
//      icon URLs and onclick arguments. The sweep at the bottom has a COMPANION
//      test proving its regex actually matches an id when one is present —
//      three sweeps in this repo were once written with a template-literal
//      `\b`, which is the BACKSPACE character and matches nothing.
//
//   3. TIME ON SCREEN COMES FROM THE SERVER. The countdown is the program's own
//      expiry against the server's clock, and a finished extractor says so
//      rather than showing a negative number.
//
//   4. THE ICONS ARE REAL PICTURES OR DELIBERATE TILES (R27). Every image on
//      the page comes from the local cache; TypeIcon's lettered fallback is the
//      only other thing allowed.
//
// The standing invariants are re-proven on the new markup: R7d, R9a (plain
// player language — no group names, no "pin", no "ECU"), R8 (touch-sized
// controls, a table that reflows).

import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

register("./svelteSsrHook.ts", import.meta.url);

const { render } = await import("svelte/server");
const { createClientStore } = await import("../store/clientStore.ts");
const Planets = (await import("./Planets.svelte")).default;

const UI_DIR = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(path.join(UI_DIR, "Planets.svelte"), "utf8");

const PLANET_ID = 40000002;
const SYSTEM_ID = 30000001;
const PLANET_TYPE_ID = 11;
const COMMAND_TYPE_ID = 2254;
const ECU_TYPE_ID = 3068;
const STORAGE_TYPE_ID = 2562;
const AQUEOUS_TYPE_ID = 2268;
const PIN_ID_COMMAND = 1;
const PIN_ID_RUNNING = 2;
const PIN_ID_FINISHED = 3;
const PIN_ID_STORAGE = 6;

const NOW = Date.UTC(2026, 6, 21, 12, 0, 0);
const HOUR = 3_600_000;

function fakeFlow(): unknown {
  return new Proxy({}, { get: () => async () => {} });
}

/** Everything a player can see, with markup stripped and whitespace collapsed. */
function visibleText(body: string): string {
  return body
    .replace(/<img[^>]*>/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

interface SceneOptions {
  readonly loaded?: boolean;
  readonly error?: string | null;
  readonly coloniesReadable?: boolean;
  readonly empty?: boolean;
  readonly open?: boolean;
}

function colonyState(): unknown {
  return {
    planetID: PLANET_ID,
    planetName: "Tanoo I",
    solarSystemID: SYSTEM_ID,
    solarSystemName: "Tanoo",
    planetTypeID: PLANET_TYPE_ID,
    planetTypeName: "Planet (Temperate)",
    commandCenterLevel: 3,
    lastSimulatedAtMs: NOW - 60_000,
    linkCount: 4,
    pins: [
      {
        pinID: PIN_ID_RUNNING,
        typeID: ECU_TYPE_ID,
        typeName: "Temperate Extractor Control Unit",
        kind: "extractor-control",
        contents: [],
        program: {
          resourceTypeID: AQUEOUS_TYPE_ID,
          resourceTypeName: "Aqueous Liquids",
          cycleTimeSeconds: 3600,
          quantityPerCycle: 2841,
          installedAtMs: NOW - 3 * HOUR,
          // Half an hour off the hour boundary ON PURPOSE: the panel reads its
          // own Date.now() a tick after `scene` pinned the offset, and an exact
          // 21h would flip to "20h 59m" on any ms of drift (a real intermittent
          // red). Thirty minutes of slack makes the words drift-proof.
          expiresAtMs: NOW + 21 * HOUR + HOUR / 2,
          headCount: 3,
        },
      },
      {
        pinID: PIN_ID_FINISHED,
        typeID: ECU_TYPE_ID,
        typeName: "Temperate Extractor Control Unit",
        kind: "extractor-control",
        contents: [],
        program: {
          resourceTypeID: 2073,
          resourceTypeName: "Microorganisms",
          cycleTimeSeconds: 1800,
          quantityPerCycle: 1204,
          installedAtMs: NOW - 48 * HOUR,
          expiresAtMs: NOW - 2 * HOUR,
          headCount: 1,
        },
      },
      {
        pinID: PIN_ID_STORAGE,
        typeID: STORAGE_TYPE_ID,
        typeName: "Temperate Storage Facility",
        kind: "storage",
        contents: [
          { typeID: AQUEOUS_TYPE_ID, typeName: "Aqueous Liquids", quantity: 12000 },
        ],
        program: null,
      },
      {
        pinID: PIN_ID_COMMAND,
        typeID: COMMAND_TYPE_ID,
        typeName: "Temperate Command Center",
        kind: "command",
        contents: [],
        program: null,
      },
    ],
    routes: [
      {
        routeID: 1,
        path: [PIN_ID_RUNNING, PIN_ID_STORAGE],
        commodityTypeID: AQUEOUS_TYPE_ID,
        commodityTypeName: "Aqueous Liquids",
        commodityQuantity: 2841,
      },
    ],
  };
}

function scene(options: SceneOptions = {}) {
  const store = createClientStore();
  if (options.loaded !== false) {
    store.apply({
      type: "planets/loaded",
      colonies: (options.empty ? [] : [colonyState()]) as never,
      coloniesReadable: options.coloniesReadable ?? true,
      // The panel ticks off Date.now(); pin the offset so "now" is exactly NOW.
      clockOffsetMs: NOW - Date.now(),
    });
    if (options.error) {
      store.apply({ type: "planets/error", message: options.error });
    }
    if (options.open) {
      store.apply({ type: "planets/selected", planetID: PLANET_ID });
    }
  }
  const output = render(Planets as never, {
    props: { store, flow: fakeFlow() },
  } as never);
  return { body: output.body, text: visibleText(output.body) };
}

// --- 1. Four outcomes, four sentences ---------------------------------------

test("before the first read the page says it is looking, and claims nothing", () => {
  const { text } = scene({ loaded: false });
  assert.match(text, /Looking for your colonies/i);
  assert.doesNotMatch(text, /have not built/i);
  assert.doesNotMatch(text, /could not be read/i);
});

test("a FAILED read never says the player has no colonies", () => {
  const { text } = scene({ error: "Your colonies could not be read: the gateway is down" });
  assert.match(text, /could not be read/i);
  // ⚠ THE DEFECT THIS GUARDS. A failed read must not render as an empty world.
  assert.doesNotMatch(text, /have not built/i);
  assert.doesNotMatch(text, /no colon/i);
});

test("a SUCCESSFUL empty read is the only thing that tells a player they own nothing", () => {
  const { text } = scene({ empty: true, coloniesReadable: true });
  assert.match(text, /have not built on any planet/i);
  assert.doesNotMatch(text, /could not be read/i);
  // And it says what to do about it, rather than just stating a void (R9a).
  assert.match(text, /command centre/i);
});

test("a server that reported no colony information says exactly that, and no more", () => {
  const { text } = scene({ empty: true, coloniesReadable: false });
  assert.match(text, /did not report any colony information/i);
  // ⚠ The fourth case. It must NOT be worded as a fact about the player.
  assert.doesNotMatch(text, /have not built/i);
  // And it must say so out loud, because an absence is not evidence.
  assert.match(text, /not the same as having no colonies/i);
});

// --- 2. What a colony looks like --------------------------------------------

test("a colony is a place with a name, and its state in a sentence", () => {
  const { text } = scene();
  assert.match(text, /Tanoo I/);
  assert.match(text, /Tanoo/);
  // One extractor has finished; that is what a player needs to know first.
  assert.match(text, /finished its program/i);
});

test("opening a colony shows what is on the planet, in player words", () => {
  const { text } = scene({ open: true });
  assert.match(text, /Temperate Command Center/);
  assert.match(text, /Temperate Storage Facility/);
  assert.match(text, /Aqueous Liquids/);
  assert.match(text, /12,000 units/);
  assert.match(text, /command centre level 3/i);
  assert.match(text, /4 links/);
});

test("a running program counts down, and a finished one says finished", () => {
  const { text } = scene({ open: true });
  // 21h 30m left on the server's clock — never a raw instant, never negative.
  assert.match(text, /Running — 21h 30m left/);
  assert.match(text, /Finished — this extractor has stopped/);
  assert.doesNotMatch(text, /-\d+ (hour|minute|day)/);
  // The server's own cycle numbers are shown as given.
  assert.match(text, /2,841 per 1 hour cycle/);
  assert.match(text, /3 heads/);
});

test("commodities pool into one \"everything stored here\" list", () => {
  const { text } = scene({ open: true });
  assert.match(text, /Everything stored here/i);
  assert.match(text, /Aqueous Liquids — 12,000 units/);
});

// --- 3. R27: real pictures, from the local cache only -----------------------

test("every picture on the page comes from the LOCAL icon cache", () => {
  const { body } = scene({ open: true });
  const sources = [...body.matchAll(/<img[^>]*src="([^"]+)"/g)].map((match) => match[1]!);
  assert.ok(sources.length > 0, "the panel renders no pictures at all");
  for (const source of sources) {
    assert.ok(
      source.startsWith("/icon-cache/"),
      `icon must come from the local cache, got ${source}`,
    );
  }
});

test("the planet and its structures ask for their OWN type icons", () => {
  const { body } = scene({ open: true });
  for (const typeID of [PLANET_TYPE_ID, COMMAND_TYPE_ID, ECU_TYPE_ID, STORAGE_TYPE_ID]) {
    assert.ok(
      body.includes(`/icon-cache/types/64/icon/${typeID}.png`),
      `no icon requested for type ${typeID}`,
    );
  }
});

// --- 4. R7d: nothing numeric reaches the player -----------------------------

test("COMPANION: the id sweep's regex really does match a string containing an id", () => {
  // ⚠ THIS TEST EXISTS BECAUSE THE SWEEP BELOW CANNOT PROVE ITSELF. Three
  // sweeps in this repo were once written as `\b${id}\b` inside a TEMPLATE
  // literal, where `\b` is the BACKSPACE character (charCode 8) and the pattern
  // matched nothing at all — so the sweep passed while asserting nothing.
  const pattern = new RegExp(`\\b${PLANET_ID}\\b`);
  assert.match(` the planet is ${PLANET_ID} here `, pattern);
  assert.doesNotMatch(" the planet is Tanoo I here ", pattern);
  // And the escape really is a word boundary, not a control character.
  assert.equal(pattern.source.charCodeAt(0), "\\".charCodeAt(0));
  assert.notEqual(pattern.source.charCodeAt(0), 8);
});

test("no planetID, pinID, systemID or typeID is ever visible to the player", () => {
  const { text } = scene({ open: true });
  for (const id of [
    PLANET_ID,
    SYSTEM_ID,
    PLANET_TYPE_ID,
    COMMAND_TYPE_ID,
    ECU_TYPE_ID,
    STORAGE_TYPE_ID,
    AQUEOUS_TYPE_ID,
  ]) {
    assert.doesNotMatch(
      text,
      new RegExp(`\\b${id}\\b`),
      `id ${id} leaked to the player`,
    );
  }
});

test("an unnamed planet still reads as a place, not as a number", () => {
  const store = createClientStore();
  const unnamed = { ...(colonyState() as Record<string, unknown>), planetName: null };
  store.apply({
    type: "planets/loaded",
    colonies: [unnamed] as never,
    coloniesReadable: true,
    clockOffsetMs: NOW - Date.now(),
  });
  const text = visibleText(
    render(Planets as never, { props: { store, flow: fakeFlow() } } as never).body,
  );
  assert.match(text, /a planet in Tanoo/);
  assert.doesNotMatch(text, new RegExp(`\\b${PLANET_ID}\\b`));
});

// --- 5. R9a plain language, R8 real controls --------------------------------

test("the page never uses the emulator's vocabulary", () => {
  const { text } = scene({ open: true });
  for (const jargon of [
    "pinID",
    "planetID",
    "ECU",
    "Extractor Control Unit pin",
    "coloniesByKey",
    "schematicID",
    "programType",
    "FILETIME",
  ]) {
    assert.doesNotMatch(
      text,
      new RegExp(jargon.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
      `${jargon} is emulator vocabulary and must not be on screen`,
    );
  }
});

test("the controls are real buttons, and the table reflows on a phone (R8)", () => {
  const { body } = scene();
  assert.match(body, /<button[^>]*>\s*Refresh/);
  assert.match(body, /<button[^>]*>\s*See this colony/);
  // The wide record table scrolls inside its own box and reflows to cards,
  // so the page body never scrolls sideways.
  assert.match(body, /class="[^"]*table-wrap[^"]*overflow-x-auto/);
  assert.match(body, /class="[^"]*reflow/);
  // Every cell carries the label its card form shows.
  assert.match(body, /data-label="Planet"/);
  assert.match(body, /data-label="System"/);
  assert.match(body, /data-label="State"/);
});

test("the panel reads state and never computes a colony itself", () => {
  // A grep-level guard: the arithmetic lives in bridge/planets.ts, and the
  // panel must not grow its own yield/cycle maths.
  for (const forbidden of ["Math.pow", "yieldPerCycle", "* 0.99", "richness"]) {
    assert.ok(
      !SOURCE.includes(forbidden),
      `${forbidden} is a colony mechanic and does not belong in the panel`,
    );
  }
  // And it must go through the shared decoder's helpers rather than reinvent.
  assert.match(SOURCE, /from "\.\.\/bridge\/planets\.ts"/);
});
