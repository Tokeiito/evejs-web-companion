// Saved-fitting decoder (goal R57) against REAL captured bytes.
//
// The fixture below is the EXACT retail shape captured live from Farmer
// (character 140000005) through GET /api/bridge/fittings on 2026-07-22 — a
// marshaled dict keyed by fittingID whose value is a util.KeyVal carrying
// description / fitData (list of tuples [typeID, flagID, quantity]) / fittingID /
// name / ownerID / savedDate (long FILETIME) / shipTypeID. Farmer had ONE saved
// fitting ("asdf", a shipTypeID-588 hull with three fitted modules), so this is a
// populated capture, not a guess.
//
// ⚠ R7d: a decoded row keeps shipTypeID / module typeIDs / flagID / ownerID as
// plain numeric fields for a future UI to resolve — it never renders them. The
// decoder does no rendering, so the R7d proof here is that the ids survive AS
// DATA (not that a label replaced them).

import test from "node:test";
import assert from "node:assert/strict";

import { decodeFittings } from "./fittings.ts";
import type { JsonValue } from "./wire.ts";

// The captured GetFittings dict, verbatim (one fitting, three modules).
const REAL_FITTINGS: JsonValue = {
  type: "dict",
  entries: [
    [
      1,
      {
        type: "object",
        name: "util.KeyVal",
        args: {
          type: "dict",
          entries: [
            ["description", ""],
            [
              "fitData",
              {
                type: "list",
                items: [
                  { type: "tuple", items: [3651, 28, 1] },
                  { type: "tuple", items: [21857, 19, 1] },
                  { type: "tuple", items: [3636, 27, 1] },
                ],
              },
            ],
            ["fittingID", 1],
            ["name", "asdf"],
            ["ownerID", 140000005],
            ["savedDate", { type: "long", value: "134285151537020000" }],
            ["shipTypeID", 588],
          ],
        },
      },
    ],
  ],
};

test("decodeFittings decodes the real GetFittings dict (one fitting, three modules)", () => {
  const rows = decodeFittings(REAL_FITTINGS);
  assert.equal(rows.length, 1);
  const [fit] = rows;
  assert.equal(fit!.fittingID, 1);
  assert.equal(fit!.name, "asdf");
  assert.equal(fit!.description, "");
  assert.equal(fit!.shipTypeID, 588);
  assert.equal(fit!.ownerID, 140000005);
  // The FILETIME survives as a bigint (it exceeds 2^53).
  assert.equal(fit!.savedDate, 134285151537020000n);
  // Each fitData tuple decodes to {typeID, flagID, quantity}, in order.
  assert.deepEqual(fit!.modules, [
    { typeID: 3651, flagID: 28, quantity: 1 },
    { typeID: 21857, flagID: 19, quantity: 1 },
    { typeID: 3636, flagID: 27, quantity: 1 },
  ]);
});

test("decodeFittings on an empty dict is [] (a real 'no saved fittings')", () => {
  assert.deepEqual(decodeFittings({ type: "dict", entries: [] }), []);
});

test("decodeFittings tolerates a fitData tuple delivered as a bare array or a list", () => {
  // The gateway delivers fitData items as {type:"tuple", …}; a defensive decode
  // must also read a plain array and a {type:"list", …}, so a wire change never
  // silently drops modules.
  const mixed: JsonValue = {
    type: "dict",
    entries: [
      [
        7,
        {
          type: "object",
          name: "util.KeyVal",
          args: {
            type: "dict",
            entries: [
              ["fittingID", 7],
              ["shipTypeID", 620],
              ["name", "mixed"],
              [
                "fitData",
                {
                  type: "list",
                  items: [
                    [2048, 11, 1],
                    { type: "list", items: [1319, 12, 2] },
                  ],
                },
              ],
            ],
          },
        },
      ],
    ],
  };
  const [fit] = decodeFittings(mixed);
  assert.deepEqual(fit!.modules, [
    { typeID: 2048, flagID: 11, quantity: 1 },
    { typeID: 1319, flagID: 12, quantity: 2 },
  ]);
});

// R7d id-sweep: the decoded fitting must carry each id AS DATA (a numeric field),
// never lose it and never pre-render it. This proves the decoder preserves the
// ids a future UI resolves, and the companion proves the check is not vacuous.
function fittingIdFields(fit: {
  readonly shipTypeID: number;
  readonly ownerID: number;
  readonly modules: readonly { readonly typeID: number; readonly flagID: number }[];
}): number[] {
  return [
    fit.shipTypeID,
    fit.ownerID,
    ...fit.modules.map((m) => m.typeID),
    ...fit.modules.map((m) => m.flagID),
  ];
}

test("R7d: the decoded fitting preserves every id as a numeric field (for later name resolution)", () => {
  const [fit] = decodeFittings(REAL_FITTINGS);
  const ids = fittingIdFields(fit!);
  // The real capture's ids are all present as data.
  assert.ok(ids.includes(588), "shipTypeID preserved");
  assert.ok(ids.includes(140000005), "ownerID preserved");
  assert.ok(ids.includes(3651) && ids.includes(21857) && ids.includes(3636), "module typeIDs preserved");
});

test("the fitting id-field extractor actually reads the decoded content", () => {
  // Companion: a fit whose fields differ must yield different ids, so the check
  // above is inspecting real content and not a constant.
  const ids = fittingIdFields({ shipTypeID: 1, ownerID: 2, modules: [{ typeID: 3, flagID: 4 }] });
  assert.deepEqual(ids, [1, 2, 3, 4]);
});
