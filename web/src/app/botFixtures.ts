// TEST FIXTURES ONLY — the raw BFF envelopes the bot suites decode (goal R43).
//
// Nothing in the app imports this; it is here rather than inside one test file
// because three suites need the SAME ship, and a second hand-typed copy of a
// fit is exactly how two tests come to disagree about what a Procurer is.
// (`ui/svelteSsrHook.ts` sets the precedent for a test-only module under src.)
//
// ⚠ EVERY VALUE BELOW WAS CAPTURED FROM THE RUNNING BFF, not invented. It is
// Farmer (140000005) in Perimeter VI - Ytiri Storage aboard the live Procurer,
// read on 2026-07-21 from:
//
//   GET  /api/bridge/fitting        (11 modules, slot counts 2/3/3/3)
//   GET  /api/bridge/flight/status
//   GET  /api/bridge/ship/ore-hold  (16,000 m³ ore hold, 350 m³ cargo)
//   POST /api/names                 (every typeID below)
//
// ⚠ AND THIS FIT IS THE WHOLE POINT. It carries BOTH known traps in the
// "which of these is a miner" derivation, which is why it and not a synthetic
// two-module ship is what the requirement check is pinned against:
//
//   • `Ice Harvester Upgrade II` (low slot) — matches `harvest`, and is
//     excluded ONLY by the `/upgrade/` term in looksLikeMiningEquipment.
//   • `Medium Ice Harvester Accelerator I` (RIG) — also matches `harvest`, and
//     the name guess does NOT exclude it. It is dropped purely because the
//     shared derivation skips the rig family structurally. A second,
//     independently-written "do you have a miner" check would say yes to this
//     ship even with no Strip Miner aboard at all.
//
// The two real miners are the 2× `Strip Miner I` in the high slots.

/** Farmer's live Procurer. */
export const SHIP_ID = 9988400023309;
export const STATION_ID = 60000358;
export const SOLAR_SYSTEM_ID = 30000144;

/** The two Strip Miner I itemIDs — the only modules on this hull that mine. */
export const STRIP_MINER_ITEM_IDS: readonly number[] = Object.freeze([
  9988400037240, 9988400037239,
]);

/** Every fitted module, exactly as the capture reported it. */
interface FittedRow {
  readonly itemID: number;
  readonly typeID: number;
  readonly flagID: number;
  readonly groupID: number;
  readonly name: string;
}

export const PROCURER_MODULES: readonly FittedRow[] = Object.freeze([
  // High slots (flags 27-28) — the miners.
  { itemID: 9988400037240, typeID: 17482, flagID: 27, groupID: 464, name: "Strip Miner I" },
  { itemID: 9988400037239, typeID: 17482, flagID: 28, groupID: 464, name: "Strip Miner I" },
  // Mid slots (flags 19-21).
  { itemID: 9988400023312, typeID: 527, flagID: 19, groupID: 65, name: "Stasis Webifier II" },
  { itemID: 9988400023306, typeID: 448, flagID: 20, groupID: 52, name: "Warp Scrambler II" },
  { itemID: 9988400023317, typeID: 12058, flagID: 21, groupID: 46, name: "10MN Afterburner II" },
  // Low slots (flags 11-13) — note the FIRST one.
  {
    itemID: 9988400023307,
    typeID: 28578,
    flagID: 11,
    groupID: 546,
    name: "Ice Harvester Upgrade II",
  },
  {
    itemID: 9988400023311,
    typeID: 2605,
    flagID: 12,
    groupID: 763,
    name: "Nanofiber Internal Structure II",
  },
  {
    itemID: 9988400023315,
    typeID: 4405,
    flagID: 13,
    groupID: 645,
    name: "Drone Damage Amplifier II",
  },
  // Rigs (flags 92-94) — note the LAST one.
  {
    itemID: 9988400023308,
    typeID: 31173,
    flagID: 92,
    groupID: 782,
    name: "Medium Low Friction Nozzle Joints II",
  },
  {
    itemID: 9988400023310,
    typeID: 31724,
    flagID: 93,
    groupID: 774,
    name: "Medium EM Shield Reinforcer II",
  },
  {
    itemID: 9988400023313,
    typeID: 32819,
    flagID: 94,
    groupID: 1232,
    name: "Medium Ice Harvester Accelerator I",
  },
]);

function packedRow(fields: Record<string, unknown>): unknown {
  return { type: "packedrow", fields };
}

/**
 * The ship's own attribute map, captured. 14/13/12/1137 are the slot COUNTS
 * the decoder draws from: 2 high, 3 mid, 3 low, 3 rig.
 */
const SHIP_ATTRIBUTES: ReadonlyArray<readonly [number, unknown]> = Object.freeze([
  [11, 112.5],
  [12, 3],
  [13, 3],
  [14, 2],
  [15, 79],
  [18, 1000],
  [48, 387.5],
  [49, 281],
  [1132, 400],
  [1137, 3],
  [1152, 400],
]);

/**
 * `GET /api/bridge/fitting` for the live Procurer.
 *
 * `offline` names itemIDs to LEAVE OUT of the online list, so a suite can ask
 * "what does the requirement say when the miners are fitted but powered down?"
 * against the same ship rather than a second fixture.
 */
export function fittingBody(options: { readonly offline?: readonly number[] } = {}): unknown {
  const offline = new Set(options.offline ?? []);
  return {
    ok: true,
    activeShipID: SHIP_ID,
    stationID: STATION_ID,
    slots: {
      type: "list",
      items: PROCURER_MODULES.map((row) =>
        packedRow({
          itemID: row.itemID,
          typeID: row.typeID,
          ownerID: 140000005,
          locationID: SHIP_ID,
          flagID: row.flagID,
          quantity: -1,
          groupID: row.groupID,
          categoryID: 7,
          customInfo: "",
        }),
      ),
    },
    shipInfo: {
      type: "dict",
      entries: [
        [
          SHIP_ID,
          {
            type: "object",
            name: "util.KeyVal",
            args: {
              type: "dict",
              entries: [
                ["itemID", SHIP_ID],
                ["attributes", { type: "dict", entries: SHIP_ATTRIBUTES.map((pair) => [...pair]) }],
              ],
            },
          },
        ],
      ],
    },
    online: {
      type: "list",
      items: PROCURER_MODULES.map((row) => row.itemID).filter((id) => !offline.has(id)),
    },
    errors: { slots: null, shipInfo: null, online: null },
  };
}

/** `GET /api/bridge/flight/status`, captured docked and mirrored for space. */
export function flightBody(docked: boolean): unknown {
  return {
    ok: true,
    flight: {
      inSpace: !docked,
      docked,
      solarSystemID: SOLAR_SYSTEM_ID,
      stationID: docked ? STATION_ID : null,
      structureID: null,
      shipID: SHIP_ID,
      shipMode: docked ? null : "STOP",
      shipSpeedFraction: docked ? null : 0,
    },
    notifications: [],
  };
}

/**
 * `GET /api/bridge/ship/ore-hold`, captured. The Procurer's real holds: a
 * 16,000 m³ ore hold and a 350 m³ cargo hold, with the three specialty holds it
 * does not have reported `present: false`.
 */
export function holdsBody(oreUsed: number, items: readonly unknown[]): unknown {
  return {
    ok: true,
    activeShipID: SHIP_ID,
    stationID: STATION_ID,
    holds: [
      {
        key: "ore",
        label: "Ore hold",
        items: [...items],
        capacity: { capacity: 16000, used: oreUsed },
        present: true,
        error: null,
      },
      { key: "gas", label: "Gas hold", items: [], capacity: { capacity: 0, used: 0 }, present: false, error: null },
      { key: "ice", label: "Ice hold", items: [], capacity: { capacity: 0, used: 0 }, present: false, error: null },
      {
        key: "asteroid",
        label: "Asteroid hold",
        items: [],
        capacity: { capacity: 0, used: 0 },
        present: false,
        error: null,
      },
      {
        key: "cargo",
        label: "Cargo hold",
        items: [],
        capacity: { capacity: 350, used: 0 },
        present: true,
        error: null,
      },
    ],
  };
}

/** Every captured type name, keyed the way the names slice keys them. */
export const TYPE_NAMES: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(PROCURER_MODULES.map((row) => [`type:${row.typeID}`, row.name])),
);

/**
 * `POST /api/names`, answering only what was asked for — so a suite that wants
 * to model an UNRESOLVED name simply never asks, and the requirement check has
 * to reach its "cannot tell" arm rather than a convenient false negative.
 */
export function namesBody(request: Record<string, unknown>): unknown {
  const items = Array.isArray(request.items) ? (request.items as { kind?: string; id?: number }[]) : [];
  const names: Record<string, string> = {};
  for (const item of items) {
    const key = `${item.kind}:${item.id}`;
    if (key in TYPE_NAMES) {
      names[key] = TYPE_NAMES[key]!;
    }
  }
  return { ok: true, source: "static-data", count: Object.keys(names).length, names, unresolved: [] };
}

/** A raw space snapshot with a belt and one rock, for the mining ladder. */
export function spaceBody(options: { readonly activeModuleIDs?: readonly number[] } = {}): unknown {
  return {
    ok: true,
    space: {
      inSpace: true,
      solarSystemID: SOLAR_SYSTEM_ID,
      shipID: SHIP_ID,
      sampledAtMs: 0,
      ship: {
        itemID: SHIP_ID,
        typeID: 17480,
        name: "Farmer's Procurer",
        mode: "STOP",
        radius: 60,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        shieldRatio: 1,
        armorRatio: 1,
        hullRatio: 1,
        capacitorRatio: 1,
        activeModuleIDs: [...(options.activeModuleIDs ?? [])],
      },
      entities: [
        {
          itemID: 5001,
          kind: "asteroid",
          name: "Veldspar",
          typeID: 1230,
          radius: 100,
          position: { x: 6000, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
          remainingQuantity: 12000,
          miningYieldTypeID: 1230,
          beltID: 40000123,
        },
        {
          itemID: 40000123,
          kind: "celestial",
          name: "Asteroid Belt 1",
          radius: 0,
          position: { x: 500, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
        },
      ],
    },
    notifications: [],
  };
}
