// The R11 overview view logic: distance is computed IN THE BROWSER from the
// reported positions (as the retail client does), the list sorts nearest-first,
// filters narrow it by category / group / text, and the cap always keeps the
// nearest matches.

import test from "node:test";
import assert from "node:assert/strict";

import {
  METRES_PER_AU,
  buildOverviewRows,
  distanceMeters,
  formatDistance,
  overviewFilterIDs,
  ratioPercent,
} from "./overview.ts";
import type { SpaceEntity, SpaceSnapshot, SpaceVector } from "../store/types.ts";

const ORIGIN: SpaceVector = { x: 0, y: 0, z: 0 };

function entity(over: Partial<SpaceEntity> & { itemID: number }): SpaceEntity {
  return {
    kind: "celestial",
    typeID: 16,
    groupID: 10,
    categoryID: 2,
    name: null,
    ownerID: null,
    radius: 100,
    position: ORIGIN,
    velocity: ORIGIN,
    isSelf: false,
    shieldRatio: null,
    armorRatio: null,
    hullRatio: null,
    characterID: null,
    corporationID: null,
    allianceID: null,
    securityStatus: null,
    maxVelocity: null,
    mode: null,
    capacitorRatio: null,
  remainingQuantity: null,
  miningYieldTypeID: null,
  beltID: null,
    ...over,
  };
}

function snapshotOf(entities: SpaceEntity[]): SpaceSnapshot {
  return {
    inSpace: true,
    solarSystemID: 30000142,
    shipID: 9001,
    sampledAtMs: 1,
    entities,
    ship: null,
  };
}

const SELF = entity({ itemID: 9001, kind: "ship", isSelf: true, name: "My ship" });
const NEAR = entity({
  itemID: 50001,
  name: "Near gate",
  groupID: 10,
  categoryID: 2,
  position: { x: 1_000, y: 0, z: 0 },
});
const MID = entity({
  itemID: 50002,
  name: "Mid station",
  groupID: 15,
  categoryID: 3,
  position: { x: 0, y: 500_000, z: 0 },
});
const FAR = entity({
  itemID: 50003,
  name: "Far planet",
  groupID: 7,
  categoryID: 2,
  position: { x: 0, y: 0, z: 5 * METRES_PER_AU },
});

test("distance is computed client-side from the reported positions", () => {
  assert.equal(distanceMeters(ORIGIN, { x: 3, y: 4, z: 0 }), 5);
  assert.equal(distanceMeters({ x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 }), 0);
  // Distance is measured from the SHIP, not the system origin.
  assert.equal(distanceMeters({ x: 10, y: 0, z: 0 }, { x: 4, y: 8, z: 0 }), 10);
});

test("distances read in the units a player expects", () => {
  assert.equal(formatDistance(0), "0 m");
  assert.equal(formatDistance(750), "750 m");
  assert.equal(formatDistance(1_500), "1.5 km");
  assert.equal(formatDistance(250_000), "250 km");
  assert.equal(formatDistance(3 * METRES_PER_AU), "3.0 AU");
  assert.equal(formatDistance(Number.NaN), "—");
});

test("the overview sorts nearest first and never lists the player's own ship", () => {
  const { rows, matched } = buildOverviewRows(snapshotOf([FAR, SELF, NEAR, MID]), ORIGIN);

  assert.deepEqual(rows.map((row) => row.itemID), [NEAR.itemID, MID.itemID, FAR.itemID]);
  assert.equal(matched, 3, "the player's own ship is excluded from the list");
  assert.ok(rows.every((row) => row.isSelf === false));
  // Each row carries the distance the client computed.
  assert.equal(rows[0]?.distance, 1_000);
  assert.equal(rows[2]?.distance, 5 * METRES_PER_AU);
});

test("sorting by name still breaks ties by distance", () => {
  const a1 = entity({ itemID: 1, name: "Alpha", position: { x: 900, y: 0, z: 0 } });
  const a2 = entity({ itemID: 2, name: "Alpha", position: { x: 100, y: 0, z: 0 } });
  const b = entity({ itemID: 3, name: "Beta", position: { x: 10, y: 0, z: 0 } });

  const { rows } = buildOverviewRows(snapshotOf([a1, b, a2]), ORIGIN, { sort: "name" });

  assert.deepEqual(rows.map((row) => row.itemID), [2, 1, 3]);
});

test("filtering narrows by category, by group, and by free text", () => {
  const snapshot = snapshotOf([SELF, NEAR, MID, FAR]);

  const byCategory = buildOverviewRows(snapshot, ORIGIN, { filter: { categoryID: 3 } });
  assert.deepEqual(byCategory.rows.map((row) => row.itemID), [MID.itemID]);

  const byGroup = buildOverviewRows(snapshot, ORIGIN, { filter: { groupID: 7 } });
  assert.deepEqual(byGroup.rows.map((row) => row.itemID), [FAR.itemID]);

  const byText = buildOverviewRows(snapshot, ORIGIN, { filter: { text: "  GATE " } });
  assert.deepEqual(byText.rows.map((row) => row.itemID), [NEAR.itemID]);

  // Filters compose.
  const both = buildOverviewRows(snapshot, ORIGIN, {
    filter: { categoryID: 2, text: "planet" },
  });
  assert.deepEqual(both.rows.map((row) => row.itemID), [FAR.itemID]);

  // A filter that matches nothing yields an empty list, not everything.
  const none = buildOverviewRows(snapshot, ORIGIN, { filter: { text: "wormhole" } });
  assert.deepEqual(none.rows, []);
  assert.equal(none.matched, 0);
});

test("text search matches the resolved type and group names a player sees", () => {
  const ship = entity({ itemID: 77, kind: "ship", name: null, typeID: 670 });
  const snapshot = snapshotOf([ship]);
  const names = () => ({ typeName: "Capsule", groupID: null, groupName: "Capsule" });

  const hit = buildOverviewRows(snapshot, ORIGIN, { filter: { text: "capsule" }, names });
  assert.deepEqual(hit.rows.map((row) => row.itemID), [77]);

  // Without the name lookup the same nameless row cannot be found by type.
  const miss = buildOverviewRows(snapshot, ORIGIN, { filter: { text: "capsule" } });
  assert.deepEqual(miss.rows, []);
});

test("the cap keeps the nearest matches and still reports the full match count", () => {
  const many = Array.from({ length: 10 }, (_, index) =>
    entity({ itemID: 100 + index, position: { x: (10 - index) * 1_000, y: 0, z: 0 } }),
  );

  const { rows, matched } = buildOverviewRows(snapshotOf(many), ORIGIN, { cap: 3 });

  assert.equal(matched, 10, "the count reflects everything that matched, not what was shown");
  assert.equal(rows.length, 3);
  // Nearest three: the ones seeded with the smallest x.
  assert.deepEqual(rows.map((row) => row.distance), [1_000, 2_000, 3_000]);
});

test("filter choices come from what is actually visible, excluding the ship", () => {
  const { categoryIDs, groupIDs } = overviewFilterIDs(snapshotOf([SELF, NEAR, MID, FAR]));

  assert.deepEqual([...categoryIDs].sort((a, b) => a - b), [2, 3]);
  assert.deepEqual([...groupIDs].sort((a, b) => a - b), [7, 10, 15]);
  // A null snapshot offers no filters rather than throwing.
  assert.deepEqual(overviewFilterIDs(null), { categoryIDs: [], groupIDs: [] });
});

test("a missing snapshot yields an empty overview rather than throwing", () => {
  assert.deepEqual(buildOverviewRows(null, ORIGIN), { rows: [], matched: 0 });
});

test("ratios become whole percentages for the HUD bars", () => {
  assert.equal(ratioPercent(1), 100);
  assert.equal(ratioPercent(0), 0);
  assert.equal(ratioPercent(0.257), 26);
  // Out-of-range or absent values are clamped / reported as "no bar".
  assert.equal(ratioPercent(1.4), 100);
  assert.equal(ratioPercent(-0.2), 0);
  assert.equal(ratioPercent(null), null);
  assert.equal(ratioPercent(undefined), null);
  assert.equal(ratioPercent(Number.NaN), null);
});
