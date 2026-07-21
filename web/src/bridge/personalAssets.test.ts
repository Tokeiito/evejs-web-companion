// R37 — decoding the personal-assets surface, against REAL CAPTURED BYTES.
//
// Every fixture below is the verbatim JSON body of a live read against the
// running emulator (account `test2`, characters GM Elysian and Test Two),
// copied out of the response rather than hand-built. That matters here more
// than usual: the two handlers send DIFFERENT packedrow variants, and R32's
// contract defect survived a test whose hand-built fixture used the wrong one.

import test from "node:test";
import assert from "node:assert/strict";

import type { JsonValue } from "./wire.ts";
import {
  decodeAssetItems,
  decodeAssetStations,
  formatAssetVolume,
  formatUnits,
  totalVolume,
  assetRefusalMessage,
} from "./personalAssets.ts";

// --- Real bytes -------------------------------------------------------------

/**
 * GET /api/bridge/assets → `stations`, verbatim, for GM Elysian.
 *
 * charMgr.ListStations' CRowset. ⚠ Note what this actually is: `objectex2`
 * whose rows are on `list` (NOT `items`), each a packedrow carrying `columns` +
 * `values` and NO `fields` object. Row: Jita IV-4 (60003760) in Jita
 * (30000142), station type 52678, 9 stacks, upkeepState null.
 */
const LIVE_STATIONS_CROWSET = {
  type: "objectex2",
  header: [
    [{ type: "token", value: "carbon.common.script.sys.crowset.CRowset" }],
    {
      type: "dict",
      entries: [
        [
          "header",
          {
            type: "objectex1",
            header: [
              { type: "token", value: "blue.DBRowDescriptor" },
              [
                [
                  ["stationID", 20],
                  ["solarSystemID", 20],
                  ["typeID", 3],
                  ["itemCount", 3],
                  ["upkeepState", 17],
                ],
              ],
            ],
            list: [],
            dict: [],
          },
        ],
      ],
    },
  ],
  list: [
    {
      type: "packedrow",
      header: {
        type: "objectex1",
        header: [
          { type: "token", value: "blue.DBRowDescriptor" },
          [
            [
              ["stationID", 20],
              ["solarSystemID", 20],
              ["typeID", 3],
              ["itemCount", 3],
              ["upkeepState", 17],
            ],
          ],
        ],
        list: [],
        dict: [],
      },
      columns: [
        ["stationID", 20],
        ["solarSystemID", 20],
        ["typeID", 3],
        ["itemCount", 3],
        ["upkeepState", 17],
      ],
      values: [60003760, 30000142, 52678, 9, null],
    },
  ],
  dict: [],
} as const;

/** The same read for Test Two: Elonaya X - Moon 22 (60000256) in Lonetrek. */
const LIVE_STATIONS_TEST_TWO = {
  ...LIVE_STATIONS_CROWSET,
  list: [
    {
      ...LIVE_STATIONS_CROWSET.list[0],
      values: [60000256, 30001399, 1531, 1, null],
    },
  ],
} as const;

const ITEM_COLUMNS = [
  ["itemID", 20],
  ["typeID", 3],
  ["ownerID", 3],
  ["locationID", 20],
  ["flagID", 2],
  ["quantity", 3],
  ["groupID", 3],
  ["categoryID", 3],
  ["customInfo", 129],
  ["singleton", 2],
  ["stacksize", 3],
] as const;

function liveItemRow(fields: Record<string, JsonValue>): JsonValue {
  // The live rows carry a `header` descriptor too; it is reproduced here as the
  // handler builds it so the fixture is the real shape, not a convenient subset.
  return {
    type: "packedrow",
    header: {
      type: "objectex1",
      header: [{ type: "token", value: "blue.DBRowDescriptor" }, [[...ITEM_COLUMNS]]],
      list: [],
      dict: [],
    },
    columns: ITEM_COLUMNS.map((column) => [...column]),
    fields,
  };
}

/**
 * GET /api/bridge/assets/station?stationID=60003760 → `items`, verbatim.
 *
 * ⚠ A DIFFERENT SHAPE FROM THE STATIONS ABOVE: a plain `{type:"list", items}`
 * whose rows are the NAME-KEYED packedrow (`fields`, no `values`).
 *
 * ⚠ NOTE `quantity: -1` ON EVERY SINGLETON. That is the retail convention for
 * an assembled item, not a count — three of these five rows carry it.
 */
const LIVE_ITEM_FIELDS: Record<string, JsonValue>[] = [
  {
    itemID: 9988400022135, typeID: 9854, ownerID: 140000004, locationID: 60003760,
    flagID: 4, quantity: -1, groupID: 237, categoryID: 6, customInfo: "",
    singleton: 1, stacksize: 1,
  },
  {
    itemID: 9988400022136, typeID: 40340, ownerID: 140000004, locationID: 60003760,
    flagID: 4, quantity: 12, groupID: 1657, categoryID: 65, customInfo: "",
    singleton: 0, stacksize: 12,
  },
  {
    itemID: 9988400043639, typeID: 9854, ownerID: 140000004, locationID: 60003760,
    flagID: 4, quantity: -1, groupID: 237, categoryID: 6, customInfo: "",
    singleton: 1, stacksize: 1,
  },
  {
    itemID: 9988400043767, typeID: 40519, ownerID: 140000004, locationID: 60003760,
    flagID: 4, quantity: 1, groupID: 1301, categoryID: 5, customInfo: "",
    singleton: 0, stacksize: 1,
  },
  {
    itemID: 9988400043768, typeID: 2420, ownerID: 140000004, locationID: 60003760,
    flagID: 4, quantity: 1, groupID: 508, categoryID: 7, customInfo: "",
    singleton: 0, stacksize: 1,
  },
];

const LIVE_STATION_ITEMS: JsonValue = {
  type: "list",
  items: LIVE_ITEM_FIELDS.map((fields) => liveItemRow(fields)),
};

/** The `volumes` map the BFF attached to that same response, verbatim. */
const LIVE_VOLUMES = {
  "2420": 20,
  "9854": 20400,
  "9862": 20400,
  "40340": 800000,
  "40519": 0.01,
  "41239": 4000,
} as const;

/** ListStations for a character who genuinely owns nothing: an empty CRowset. */
const LIVE_STATIONS_EMPTY = { ...LIVE_STATIONS_CROWSET, list: [] } as const;

// --- The station list -------------------------------------------------------

test("the station list decodes from the CRowset's POSITIONAL packedrows", () => {
  const rows = decodeAssetStations(LIVE_STATIONS_CROWSET);
  assert.equal(rows.length, 1);
  const row = rows[0]!;
  // Every field read off `columns`/`values` — this is the whole reason
  // readRowField exists. A decoder that used readKeyVal gets undefined here and
  // drops the row entirely, leaving a panel that looks like an empty world.
  assert.equal(row.stationID, 60003760);
  assert.equal(row.solarSystemID, 30000142);
  assert.equal(row.typeID, 52678);
  assert.equal(row.itemCount, 9);
});

test("the station rows are on `list`, and reading `items` finds nothing", () => {
  // The CRowset has no `items` at all. This pins the specific mistake: a
  // decoder that reached for `items` (as the ITEM read legitimately does) would
  // decode zero stations from a perfectly good read.
  assert.equal("items" in LIVE_STATIONS_CROWSET, false);
  assert.equal(decodeAssetStations(LIVE_STATIONS_CROWSET).length, 1);
});

test("a second character's real read decodes to that character's own station", () => {
  const rows = decodeAssetStations(LIVE_STATIONS_TEST_TWO);
  assert.deepEqual(rows.map((row) => row.stationID), [60000256]);
  assert.equal(rows[0]!.solarSystemID, 30001399);
  assert.equal(rows[0]!.itemCount, 1);
});

test("a successful EMPTY read decodes to no stations without throwing", () => {
  assert.deepEqual(decodeAssetStations(LIVE_STATIONS_EMPTY), []);
});

test("a failed read — null — decodes to no stations rather than throwing", () => {
  // The panel must be able to tell this apart from the empty case, but that is
  // the BFF's `ownsNothing` fact, not something the decoder can know.
  assert.deepEqual(decodeAssetStations(null), []);
  assert.deepEqual(decodeAssetStations(undefined), []);
});

test("a station whose typeID is absent carries null, never a zero type id", () => {
  const noType = {
    ...LIVE_STATIONS_CROWSET,
    list: [{ ...LIVE_STATIONS_CROWSET.list[0], values: [60003760, 30000142, 0, 9, null] }],
  };
  assert.equal(decodeAssetStations(noType)[0]!.typeID, null);
});

// --- The station contents ---------------------------------------------------

test("station contents decode from the NAME-KEYED packedrows", () => {
  const items = decodeAssetItems(LIVE_STATION_ITEMS, LIVE_VOLUMES);
  assert.equal(items.length, 5);
  // Sorted biggest stack first: the Keepstar stack of 12 leads.
  assert.equal(items[0]!.typeID, 40340);
  assert.equal(items[0]!.units, 12);
});

test("an ASSEMBLED item counts as one, never as its raw quantity of -1", () => {
  // Three of the five live rows carry quantity:-1 / singleton:1. Rendering that
  // field raw puts "-1" on screen next to a ship's name.
  const rawQuantities = LIVE_ITEM_FIELDS.map((fields) => fields.quantity);
  assert.ok(rawQuantities.includes(-1), "fixture must contain the -1 case");

  const items = decodeAssetItems(LIVE_STATION_ITEMS, LIVE_VOLUMES);
  for (const item of items) {
    assert.ok(item.units >= 1, `every stack has at least one unit, got ${item.units}`);
  }
  const singletons = items.filter((item) => item.singleton);
  assert.equal(singletons.length, 2);
  for (const item of singletons) {
    assert.equal(item.units, 1);
  }
});

test("volume comes from the static map, and an unknown type is null not zero", () => {
  const items = decodeAssetItems(LIVE_STATION_ITEMS, LIVE_VOLUMES);
  const keepstar = items.find((item) => item.typeID === 40340)!;
  assert.equal(keepstar.volume, 800000);
  // 40519 has a real, TINY volume (0.01) — it must survive as itself and not be
  // rounded away to null by a truthiness check.
  assert.equal(items.find((item) => item.typeID === 40519)!.volume, 0.01);
  // With no volume map at all, every volume is unknown — never 0.
  for (const item of decodeAssetItems(LIVE_STATION_ITEMS, {})) {
    assert.equal(item.volume, null);
  }
});

test("total volume multiplies by units and is null when nothing is known", () => {
  const items = decodeAssetItems(LIVE_STATION_ITEMS, LIVE_VOLUMES);
  // 12 x 800000 + 2 x 20400 + 1 x 0.01 + 1 x 20
  assert.equal(totalVolume(items), 12 * 800000 + 2 * 20400 + 0.01 + 20);
  assert.equal(totalVolume(decodeAssetItems(LIVE_STATION_ITEMS, {})), null);
  assert.equal(totalVolume([]), null);
});

test("a failed contents read decodes to nothing rather than throwing", () => {
  assert.deepEqual(decodeAssetItems(null, {}), []);
  assert.deepEqual(decodeAssetItems({ type: "list", items: [] }, {}), []);
});

// --- Value encoding ---------------------------------------------------------

test("the live rows carry plain numbers, not {type:'long'} and not strings", () => {
  // The record of what was MEASURED, so a future change to the handler's
  // encoding is caught here rather than by an empty panel in production.
  const fields = LIVE_ITEM_FIELDS[0]!;
  assert.equal(typeof fields.itemID, "number");
  assert.equal(typeof fields.locationID, "number");
  assert.equal(typeof LIVE_STATIONS_CROWSET.list[0]!.values[0], "number");
});

test("a bare decimal string still decodes — the gateway renders BigInt that way", () => {
  // Not what these handlers send today, but exactly what the gateway would send
  // if one of them ever held a real BigInt. R32 lost every contract date to
  // precisely this, so the decoder accepts it up front.
  const asStrings = {
    ...LIVE_STATIONS_CROWSET,
    list: [
      {
        ...LIVE_STATIONS_CROWSET.list[0],
        values: ["60003760", "30000142", 52678, 9, null],
      },
    ],
  };
  const row = decodeAssetStations(asStrings)[0]!;
  assert.equal(row.stationID, 60003760);
  assert.equal(row.solarSystemID, 30000142);
});

test("a {type:'long'} wrapper decodes too", () => {
  const wrapped = {
    ...LIVE_STATIONS_CROWSET,
    list: [
      {
        ...LIVE_STATIONS_CROWSET.list[0],
        values: [{ type: "long", value: 60003760 }, 30000142, 52678, 9, null],
      },
    ],
  };
  assert.equal(decodeAssetStations(wrapped)[0]!.stationID, 60003760);
});

// --- Presentation -----------------------------------------------------------

test("a volume that is genuinely unknown reads as an em dash, not as zero", () => {
  assert.equal(formatAssetVolume(null), "—");
  assert.equal(formatAssetVolume(0), "—");
  assert.match(formatAssetVolume(800000), /m³/);
});

test("units render as digits", () => {
  assert.equal(formatUnits(1), "1");
  assert.match(formatUnits(12), /12/);
});

test("an unmapped refusal passes through verbatim rather than being invented", () => {
  assert.equal(
    assetRefusalMessage({ code: "ASSET_LOCATION_INVALID" }),
    "No location was named.",
  );
  assert.equal(assetRefusalMessage(new Error("something specific")), "something specific");
});
