// C3 — the palette metadata. Every macro has an entry, the copy matches the
// sentence register, and nothing on a palette card is an id or an engineering
// word (R7d / R9a).

import test from "node:test";
import assert from "node:assert/strict";

import { MACRO_IDS } from "./botScript.ts";
import { MACRO_SPECS } from "./macroSpecs.ts";
import { macroName } from "./scriptText.ts";
import { MACRO_CATALOG_LIST, macroEntry } from "./macroCatalogView.ts";

const JARGON = /\b(typeGroup|groupID|macro|args?|until|stationID|beltID|kind|null)\b/i;
const DIGITS = /\d/;

test("every macro has a catalog entry, in menu order", () => {
  assert.equal(MACRO_CATALOG_LIST.length, MACRO_IDS.length);
  assert.deepEqual(
    MACRO_CATALOG_LIST.map((e) => e.id),
    [...MACRO_IDS],
  );
});

test("each entry's name matches the sentence register", () => {
  for (const id of MACRO_IDS) {
    assert.equal(macroEntry(id).name, macroName(id));
  }
});

test("the does/needs/name copy carries no ids or engineering words", () => {
  for (const e of MACRO_CATALOG_LIST) {
    for (const text of [e.name, e.does, e.needs ?? ""]) {
      assert.doesNotMatch(text, DIGITS, `"${text}" should have no digits`);
      assert.doesNotMatch(text, JARGON, `"${text}" should read plainly`);
    }
    assert.ok(e.does.length > 0, `${e.id} needs a "what it does"`);
  }
});

test("parameters are derived from the shared macro spec", () => {
  for (const id of MACRO_IDS) {
    const entry = macroEntry(id);
    const spec = MACRO_SPECS[id];
    assert.deepEqual(
      entry.params.map((p) => p.key),
      spec.args.map((a) => a.key),
    );
    assert.equal(entry.untilRequired, spec.untilRequired);
  }
});

test("undock needs nothing; mine-at-belt needs a belt, equipment, and an until", () => {
  const undock = macroEntry("undock");
  assert.equal(undock.needs, null);
  assert.deepEqual(undock.params, []);
  assert.equal(undock.untilRequired, false);

  const mine = macroEntry("mine-at-belt");
  assert.deepEqual(mine.params.map((p) => p.key).sort(), ["belt", "equipment"]);
  assert.equal(mine.params.find((p) => p.key === "belt")?.required, true);
  assert.equal(mine.params.find((p) => p.key === "equipment")?.required, false, "equipment is optional (auto)");
  assert.equal(mine.untilRequired, true);
});

test("travel and deliver both take a station picker", () => {
  for (const id of ["travel-to-station", "deliver-ore"] as const) {
    const params = macroEntry(id).params;
    assert.equal(params.length, 1);
    assert.equal(params[0]?.picker, "station");
    assert.equal(params[0]?.required, true);
  }
});
