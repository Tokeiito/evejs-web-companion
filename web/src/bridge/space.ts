// Space snapshot decoder (goal R11). The BFF returns the gateway's read-only
// projection of what the ship can see; this module turns it into plain
// SpaceEntity / SpaceShipStatus rows for the store.
//
// Decoder rule (docs/bridge-wire-contract.md): numeric IDs decode with
// unwrapLong — never the `typeof === "number" ? … : 0` pattern, which silently
// zeroes a {type:"long"} wrapper. Item/type/group/category IDs all fit in 2^53
// and are kept as `number`.
//
// Everything geometric stays raw here: distance, sorting and filtering are the
// browser's job (that is how the retail client works too), so this module only
// normalizes — it computes nothing.

import { unwrapLong, type JsonValue } from "./wire.ts";
import type {
  SpaceEntity,
  SpaceShipStatus,
  SpaceSnapshot,
  SpaceVector,
} from "../store/types.ts";

const ORIGIN: SpaceVector = { x: 0, y: 0, z: 0 };

function asObject(value: JsonValue | undefined): Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : {};
}

/** A game ID as a plain number (long-aware), or null. */
function idOrNull(value: JsonValue | undefined): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  const long = unwrapLong(value);
  if (long === null) {
    return null;
  }
  const numeric = Number(long);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

/** A finite float, or null. */
function floatOrNull(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A finite float, or `fallback`. */
function floatOr(value: JsonValue | undefined, fallback: number): number {
  const numeric = floatOrNull(value);
  return numeric === null ? fallback : numeric;
}

/** A 0-1 remaining fraction, or null when the object has no such layer. */
function ratioOrNull(value: JsonValue | undefined): number | null {
  const numeric = floatOrNull(value);
  if (numeric === null) {
    return null;
  }
  return Math.min(1, Math.max(0, numeric));
}

function stringOrNull(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function decodeVector(value: JsonValue | undefined): SpaceVector {
  const raw = asObject(value);
  return {
    x: floatOr(raw.x, 0),
    y: floatOr(raw.y, 0),
    z: floatOr(raw.z, 0),
  };
}

/** One overview row. Returns null for a row with no usable identity. */
function decodeEntity(value: JsonValue): SpaceEntity | null {
  const raw = asObject(value);
  const itemID = idOrNull(raw.itemID);
  if (itemID === null) {
    return null;
  }
  return {
    kind: stringOrNull(raw.kind),
    itemID,
    typeID: idOrNull(raw.typeID),
    groupID: idOrNull(raw.groupID),
    categoryID: idOrNull(raw.categoryID),
    name: stringOrNull(raw.name),
    ownerID: idOrNull(raw.ownerID),
    radius: floatOr(raw.radius, 0),
    position: decodeVector(raw.position),
    velocity: decodeVector(raw.velocity),
    isSelf: raw.isSelf === true,
    shieldRatio: ratioOrNull(raw.shieldRatio),
    armorRatio: ratioOrNull(raw.armorRatio),
    hullRatio: ratioOrNull(raw.hullRatio),
    characterID: idOrNull(raw.characterID),
    corporationID: idOrNull(raw.corporationID),
    allianceID: idOrNull(raw.allianceID),
    // Security status is signed (-10..10), so it is NOT an id decode.
    securityStatus: floatOrNull(raw.securityStatus),
    maxVelocity: floatOrNull(raw.maxVelocity),
    mode: stringOrNull(raw.mode),
    capacitorRatio: ratioOrNull(raw.capacitorRatio),
  };
}

function decodeShip(value: JsonValue | undefined): SpaceShipStatus | null {
  if (value === undefined || value === null) {
    return null;
  }
  const raw = asObject(value);
  return {
    itemID: idOrNull(raw.itemID),
    typeID: idOrNull(raw.typeID),
    name: stringOrNull(raw.name),
    mode: stringOrNull(raw.mode),
    maxVelocity: floatOrNull(raw.maxVelocity),
    radius: floatOr(raw.radius, 0),
    position: decodeVector(raw.position),
    velocity: decodeVector(raw.velocity),
    shieldRatio: ratioOrNull(raw.shieldRatio),
    armorRatio: ratioOrNull(raw.armorRatio),
    hullRatio: ratioOrNull(raw.hullRatio),
    capacitorRatio: ratioOrNull(raw.capacitorRatio),
    shieldCapacity: floatOrNull(raw.shieldCapacity),
    armorCapacity: floatOrNull(raw.armorCapacity),
    hullCapacity: floatOrNull(raw.hullCapacity),
    // R23: which modules the SERVER says are cycling. An ABSENT field decodes
    // to null ("unknown"), not [] — a gateway that could not answer must never
    // be reported to the player as "nothing is running".
    activeModuleIDs: decodeIDList(raw.activeModuleIDs),
  };
}

/** A list of game IDs (long-aware) — or null when the field is absent. */
function decodeIDList(value: JsonValue | undefined): readonly number[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return (value as JsonValue[])
    .map((entry) => idOrNull(entry))
    .filter((entry): entry is number => entry !== null);
}

/**
 * The itemIDs the server says are locked, from the targets read (goal R23).
 * Shared by the poll and by every lock/unlock re-read, because both answer the
 * same `targetIDs` array — the ONLY authority on what is locked.
 */
export function decodeTargetIDs(raw: JsonValue | undefined): readonly number[] {
  return decodeIDList(raw) ?? [];
}

export function decodeSpaceSnapshot(raw: JsonValue | undefined): SpaceSnapshot {
  const space = asObject(raw);
  const entities = Array.isArray(space.entities)
    ? (space.entities as JsonValue[])
        .map(decodeEntity)
        .filter((row): row is SpaceEntity => row !== null)
    : [];
  return {
    inSpace: space.inSpace === true,
    solarSystemID: idOrNull(space.solarSystemID),
    shipID: idOrNull(space.shipID),
    sampledAtMs: floatOrNull(space.sampledAtMs),
    entities,
    ship: decodeShip(space.ship),
  };
}

/** The origin the browser measures distances from (the ship's own position). */
export function egoPosition(snapshot: SpaceSnapshot | null): SpaceVector {
  if (!snapshot) {
    return ORIGIN;
  }
  if (snapshot.ship) {
    return snapshot.ship.position;
  }
  const self = snapshot.entities.find((entity) => entity.isSelf);
  return self ? self.position : ORIGIN;
}
