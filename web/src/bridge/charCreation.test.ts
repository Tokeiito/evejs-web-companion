// The character-creation picker decoder, against the shapes the two sources
// actually emit.
//
// creationInfo mirrors charService.Handle_GetCharCreationInfo exactly (eve.js
// server/src/services/character/charService.js:1201 — a {type:"dict"} of two
// {type:"list"}s of util.KeyVal) and carries this world's REAL race and
// bloodline rows. The ancestry rows are the real SDE groupings as
// staticData.listAncestries normalizes them.
//
// The assertion that matters most is the JOIN: the SDE covers bloodlines this
// world does not have (Jove, Drifter), and an ancestry whose bloodline is not in
// the retail list must never reach a player, because the create route would
// refuse it.

import test from "node:test";
import assert from "node:assert/strict";

import {
  bloodlineChoicesForRace,
  bloodlineForAncestry,
  bloodlinesForRace,
  decodeCharCreationTables,
} from "./charCreation.ts";
import type { JsonValue } from "./wire.ts";

function keyVal(entries: readonly (readonly [string, JsonValue])[]): JsonValue {
  return {
    type: "object",
    name: "util.KeyVal",
    args: { type: "dict", entries: entries as unknown as JsonValue },
  } as JsonValue;
}

const CREATION_INFO: JsonValue = {
  type: "dict",
  entries: [
    [
      "races",
      {
        type: "list",
        items: [
          keyVal([["raceID", 1], ["raceName", "Caldari"], ["shipTypeID", 601], ["shipName", "Ibis"]]),
          keyVal([["raceID", 4], ["raceName", "Amarr"], ["shipTypeID", 596], ["shipName", "Impairor"]]),
        ],
      },
    ],
    [
      "bloodlines",
      {
        type: "list",
        items: [
          keyVal([["bloodlineID", 1], ["bloodlineName", "Deteis"], ["raceID", 1], ["corporationID", 1000006]]),
          keyVal([["bloodlineID", 2], ["bloodlineName", "Civire"], ["raceID", 1], ["corporationID", 1000009]]),
          keyVal([["bloodlineID", 11], ["bloodlineName", "Achura"], ["raceID", 1], ["corporationID", 1000014]]),
          keyVal([["bloodlineID", 5], ["bloodlineName", "Amarr"], ["raceID", 4], ["corporationID", 1000066]]),
        ],
      },
    ],
  ],
} as JsonValue;

function ancestry(
  ancestryID: number,
  bloodlineID: number,
  name: string,
  extra: Record<string, JsonValue> = {},
): JsonValue {
  return {
    ancestryID,
    bloodlineID,
    name,
    shortDescription: `${name} short`,
    description: `${name} long`,
    iconID: 1650,
    attributes: { charisma: 0, intelligence: 0, memory: 0, perception: 0, willpower: 0 },
    ...extra,
  } as JsonValue;
}

const ANCESTRIES: JsonValue = [
  ancestry(10, 1, "Merchandisers", {
    attributes: { charisma: 3, intelligence: 0, memory: 1, perception: 0, willpower: 0 },
  }),
  ancestry(11, 1, "Scientists"),
  ancestry(12, 1, "Tube Child"),
  ancestry(7, 2, "Entrepreneurs"),
  ancestry(8, 2, "Mercs"),
  ancestry(9, 2, "Dissenters"),
  ancestry(31, 11, "Inventors"),
  ancestry(1, 5, "Liberal Holders"),
  // Jove — in the SDE, not in this world's bloodline list.
  ancestry(25, 9, "Rogue Drone Hunters"),
] as JsonValue;

const RESPONSE: JsonValue = {
  ok: true,
  creationInfo: CREATION_INFO,
  ancestries: ANCESTRIES,
} as JsonValue;

test("races and bloodlines decode off the retail util.KeyVal rows", () => {
  const tables = decodeCharCreationTables(RESPONSE);

  assert.deepEqual(tables.races, [
    { raceID: 1, raceName: "Caldari", shipTypeID: 601, shipName: "Ibis" },
    { raceID: 4, raceName: "Amarr", shipTypeID: 596, shipName: "Impairor" },
  ]);
  assert.equal(tables.bloodlines.length, 4);
  assert.deepEqual(tables.bloodlines[2], {
    bloodlineID: 11,
    bloodlineName: "Achura",
    raceID: 1,
    corporationID: 1000014,
  });
});

test("⚠ an ancestry whose bloodline this world does not have is DROPPED", () => {
  const tables = decodeCharCreationTables(RESPONSE);

  assert.equal(
    tables.ancestries.some((row) => row.ancestryID === 25),
    false,
    "the Jove ancestry must not survive the join",
  );
  assert.equal(tables.ancestries.length, 8);
});

test("an ancestry keeps its flavor text and retail attribute bonuses", () => {
  const tables = decodeCharCreationTables(RESPONSE);
  const merchandisers = tables.ancestries.find((row) => row.ancestryID === 10);

  assert.deepEqual(merchandisers, {
    ancestryID: 10,
    bloodlineID: 1,
    name: "Merchandisers",
    shortDescription: "Merchandisers short",
    description: "Merchandisers long",
    iconID: 1650,
    attributes: { charisma: 3, intelligence: 0, memory: 1, perception: 0, willpower: 0 },
  });
});

test("bloodlinesForRace narrows to one race", () => {
  const tables = decodeCharCreationTables(RESPONSE);

  assert.deepEqual(
    bloodlinesForRace(tables, 1).map((row) => row.bloodlineName),
    ["Deteis", "Civire", "Achura"],
  );
  assert.deepEqual(
    bloodlinesForRace(tables, 4).map((row) => row.bloodlineName),
    ["Amarr"],
  );
});

test("the picker groups a race's ancestries under their bloodline", () => {
  const tables = decodeCharCreationTables(RESPONSE);
  const choices = bloodlineChoicesForRace(tables, 1);

  assert.deepEqual(
    choices.map((choice) => [
      choice.bloodline.bloodlineName,
      choice.ancestries.map((row) => row.name),
    ]),
    [
      ["Deteis", ["Merchandisers", "Scientists", "Tube Child"]],
      ["Civire", ["Entrepreneurs", "Mercs", "Dissenters"]],
      // The SDE has three Achura ancestries; this fixture carries one, and the
      // grouping shows exactly what it has rather than inventing the rest.
      ["Achura", ["Inventors"]],
    ],
  );
});

test("a bloodline with NO ancestries is still offered, not hidden", () => {
  // Drop every Achura ancestry: the bloodline is still a legal create (the
  // server rolls ancestry 0 for it), so hiding it would shrink the player's
  // options over a gap in the SDE.
  const withoutAchura = {
    ...(RESPONSE as Record<string, JsonValue>),
    ancestries: (ANCESTRIES as readonly JsonValue[]).filter(
      (row) => (row as { bloodlineID: number }).bloodlineID !== 11,
    ),
  } as JsonValue;
  const choices = bloodlineChoicesForRace(decodeCharCreationTables(withoutAchura), 1);

  const achura = choices.find((choice) => choice.bloodline.bloodlineID === 11);
  assert.ok(achura, "Achura is still offered");
  assert.deepEqual(achura.ancestries, []);
});

test("an ancestry resolves back to its bloodline — the id the write actually sends", () => {
  const tables = decodeCharCreationTables(RESPONSE);

  assert.equal(bloodlineForAncestry(tables, 8)?.bloodlineID, 2);
  assert.equal(bloodlineForAncestry(tables, 8)?.raceID, 1);
  // A Jove ancestry was dropped at the boundary, so it resolves to nothing.
  assert.equal(bloodlineForAncestry(tables, 25), null);
  assert.equal(bloodlineForAncestry(tables, 999), null);
});

test("an empty world decodes to empty tables, not a throw", () => {
  const empty = decodeCharCreationTables({ ok: true, creationInfo: null, ancestries: [] } as JsonValue);

  assert.deepEqual(empty, { races: [], bloodlines: [], ancestries: [] });
  assert.deepEqual(bloodlineChoicesForRace(empty, 1), []);
});

test("a malformed envelope decodes to empty rather than half-formed rows", () => {
  assert.deepEqual(decodeCharCreationTables({ ok: true } as JsonValue), {
    races: [],
    bloodlines: [],
    ancestries: [],
  });
  // Rows missing their id are not partially-usable rows.
  const noIDs = {
    ok: true,
    creationInfo: {
      type: "dict",
      entries: [["races", { type: "list", items: [keyVal([["raceName", "Nameless"]])] }]],
    },
    ancestries: [{ name: "Orphan" }],
  } as JsonValue;
  assert.deepEqual(decodeCharCreationTables(noIDs), {
    races: [],
    bloodlines: [],
    ancestries: [],
  });
});
