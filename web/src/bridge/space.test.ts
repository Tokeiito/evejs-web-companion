// The R11 space-snapshot decoder: long-aware IDs, clamped health fractions, and
// a stable shape for a partial or malformed payload (the panel must never blow
// up on a snapshot arriving mid-transition).

import test from "node:test";
import assert from "node:assert/strict";

import { decodeSpaceSnapshot, decodeTargetIDs, egoPosition } from "./space.ts";
import type { JsonValue } from "./wire.ts";

test("a full snapshot decodes into overview rows and a ship readout", () => {
  const snapshot = decodeSpaceSnapshot({
    inSpace: true,
    solarSystemID: 30000142,
    shipID: 9001,
    sampledAtMs: 1_700_000_000_000,
    entities: [
      {
        kind: "ship",
        itemID: 9001,
        typeID: 670,
        groupID: 29,
        categoryID: 6,
        name: "My Capsule",
        ownerID: 7,
        radius: 25,
        position: { x: 1, y: 2, z: 3 },
        velocity: { x: 4, y: 5, z: 6 },
        isSelf: true,
        shieldRatio: 1,
        armorRatio: 1,
        hullRatio: 1,
        characterID: 7,
        corporationID: 98000000,
        allianceID: 99000000,
        securityStatus: -1.5,
        maxVelocity: 300,
        mode: "STOP",
        capacitorRatio: 0.5,
      },
      {
        kind: "celestial",
        itemID: 50001248,
        typeID: 16,
        groupID: 10,
        categoryID: 2,
        name: "Stargate (Maurasi)",
        radius: 1500,
        position: { x: 1_000_000, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        isSelf: false,
        shieldRatio: null,
        armorRatio: null,
        hullRatio: null,
      },
    ],
    ship: {
      itemID: 9001,
      typeID: 670,
      name: "My Capsule",
      mode: "STOP",
      maxVelocity: 300,
      position: { x: 1, y: 2, z: 3 },
      velocity: { x: 4, y: 5, z: 6 },
      shieldRatio: 0.5,
      armorRatio: 0.75,
      hullRatio: 1,
      capacitorRatio: 0.25,
      shieldCapacity: 400,
      armorCapacity: 300,
      hullCapacity: 600,
    },
  } as unknown as JsonValue);

  assert.equal(snapshot.inSpace, true);
  assert.equal(snapshot.solarSystemID, 30000142);
  assert.equal(snapshot.entities.length, 2);

  const self = snapshot.entities[0];
  assert.equal(self?.isSelf, true);
  assert.equal(self?.name, "My Capsule");
  // Security status is signed and must survive as-is (it is not an ID decode).
  assert.equal(self?.securityStatus, -1.5);
  assert.deepEqual(self?.position, { x: 1, y: 2, z: 3 });

  const gate = snapshot.entities[1];
  assert.equal(gate?.isSelf, false);
  assert.equal(gate?.shieldRatio, null, "an object with no health reports no bars");

  assert.equal(snapshot.ship?.shieldRatio, 0.5);
  assert.equal(snapshot.ship?.hullCapacity, 600);
});

test("long-wrapped IDs decode like every other bridge payload", () => {
  const snapshot = decodeSpaceSnapshot({
    inSpace: true,
    solarSystemID: { type: "long", value: "30000142" },
    shipID: { type: "long", value: "9988400022009" },
    entities: [
      {
        itemID: { type: "long", value: "9988400022009" },
        typeID: { type: "long", value: "670" },
        position: { x: 0, y: 0, z: 0 },
      },
    ],
    ship: { itemID: { type: "long", value: "9988400022009" } },
  } as unknown as JsonValue);

  assert.equal(snapshot.solarSystemID, 30000142);
  assert.equal(snapshot.shipID, 9988400022009);
  assert.equal(snapshot.entities[0]?.itemID, 9988400022009);
  assert.equal(snapshot.entities[0]?.typeID, 670);
  assert.equal(snapshot.ship?.itemID, 9988400022009);
});

test("health fractions are clamped and absent layers stay null", () => {
  const snapshot = decodeSpaceSnapshot({
    inSpace: true,
    entities: [],
    ship: {
      itemID: 1,
      shieldRatio: 1.9,
      armorRatio: -0.4,
      hullRatio: "half",
      capacitorRatio: 0.33,
    },
  } as unknown as JsonValue);

  assert.equal(snapshot.ship?.shieldRatio, 1);
  assert.equal(snapshot.ship?.armorRatio, 0);
  assert.equal(snapshot.ship?.hullRatio, null, "a non-numeric ratio is no bar, not zero");
  assert.equal(snapshot.ship?.capacitorRatio, 0.33);
});

test("a partial or malformed snapshot still decodes to a usable shape", () => {
  const empty = decodeSpaceSnapshot(undefined);
  assert.equal(empty.inSpace, false);
  assert.deepEqual(empty.entities, []);
  assert.equal(empty.ship, null);

  // A docked read: in space false, nothing around, no ship readout.
  const docked = decodeSpaceSnapshot({
    inSpace: false,
    solarSystemID: 30000142,
    entities: [],
    ship: null,
  } as unknown as JsonValue);
  assert.equal(docked.inSpace, false);
  assert.equal(docked.ship, null);

  // Rows with no usable identity are dropped rather than rendered as blanks.
  const junk = decodeSpaceSnapshot({
    inSpace: true,
    entities: [{ itemID: 0 }, "nonsense", null, { itemID: 42 }],
  } as unknown as JsonValue);
  assert.deepEqual(junk.entities.map((row) => row.itemID), [42]);
  // A row with no position still gets a usable origin vector.
  assert.deepEqual(junk.entities[0]?.position, { x: 0, y: 0, z: 0 });
});

test("distances are measured from the ship, falling back to the self row", () => {
  const withShip = decodeSpaceSnapshot({
    inSpace: true,
    entities: [{ itemID: 1, isSelf: true, position: { x: 9, y: 9, z: 9 } }],
    ship: { itemID: 1, position: { x: 5, y: 0, z: 0 } },
  } as unknown as JsonValue);
  assert.deepEqual(egoPosition(withShip), { x: 5, y: 0, z: 0 });

  // No ship readout: the self row in the visible set is the next best origin.
  const withoutShip = decodeSpaceSnapshot({
    inSpace: true,
    entities: [
      { itemID: 2, position: { x: 100, y: 0, z: 0 } },
      { itemID: 1, isSelf: true, position: { x: 9, y: 9, z: 9 } },
    ],
  } as unknown as JsonValue);
  assert.deepEqual(egoPosition(withoutShip), { x: 9, y: 9, z: 9 });

  // Nothing at all: the origin, so distances are still finite numbers.
  assert.deepEqual(egoPosition(null), { x: 0, y: 0, z: 0 });
});

// --- R23: the generic action layer's two decoded fields ---------------------

test("R23: activeModuleIDs decodes to a list, long-aware", () => {
  const snapshot = decodeSpaceSnapshot({
    inSpace: true,
    entities: [],
    ship: {
      itemID: 9001,
      activeModuleIDs: [7700001, { type: "long", value: "7700002" }],
    },
  } as unknown as JsonValue);
  assert.deepEqual(snapshot.ship?.activeModuleIDs, [7700001, 7700002]);
});

test("R23: an ABSENT activeModuleIDs decodes to null — 'unknown', not 'nothing running'", () => {
  // This distinction is load-bearing. A gateway that could not answer must not
  // be reported to the player as "no modules are running": that reads as Idle
  // and invites a double activation.
  const snapshot = decodeSpaceSnapshot({
    inSpace: true,
    entities: [],
    ship: { itemID: 9001 },
  } as unknown as JsonValue);
  assert.equal(snapshot.ship?.activeModuleIDs, null);

  // An explicitly EMPTY list is a real answer and stays an empty list.
  const idle = decodeSpaceSnapshot({
    inSpace: true,
    entities: [],
    ship: { itemID: 9001, activeModuleIDs: [] },
  } as unknown as JsonValue);
  assert.deepEqual(idle.ship?.activeModuleIDs, []);
});

test("R23: the locked-target list decodes long-aware, and empties safely", () => {
  assert.deepEqual(
    decodeTargetIDs([50001248, { type: "long", value: "50001249" }] as unknown as JsonValue),
    [50001248, 50001249],
  );
  // A malformed or absent payload is an empty list, never a crash.
  assert.deepEqual(decodeTargetIDs(undefined), []);
  assert.deepEqual(decodeTargetIDs(null as unknown as JsonValue), []);
  assert.deepEqual(decodeTargetIDs({ nope: true } as unknown as JsonValue), []);
  // Junk entries are dropped rather than decoded to zero.
  assert.deepEqual(decodeTargetIDs([0, "x", 42] as unknown as JsonValue), [42]);
});
