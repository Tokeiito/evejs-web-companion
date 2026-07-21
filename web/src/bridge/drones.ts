// R25 slice A: the drone panel's decoders — the bay, the two limits the server
// enforces on a launch, and the plain-language wording for what a drone is
// doing.
//
// Decoder rule (docs/bridge-wire-contract.md): numeric IDs decode with
// unwrapLong — never the `typeof === "number" ? … : 0` pattern, which silently
// zeroes a {type:"long"} wrapper.
//
// The rule that matters most here is the difference between ZERO and UNKNOWN,
// and it matters more for drones than anywhere else in this client. "You have
// no drones in space" and "we could not look" are the same pixels and opposite
// facts: the first invites a player to launch, the second invites them to
// launch a SECOND set on top of the flight already out there. Every read below
// keeps them apart, and null always means unknown.

import { unwrapLong, type JsonValue } from "./wire.ts";
import { decodeShipAttributes } from "./fitting.ts";
import type { DroneBayStack, DroneInSpace, DroneLimits } from "../store/types.ts";

function asObject(value: JsonValue | undefined): Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : {};
}

/** A positive game ID (long-aware), or null. */
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

/** A finite number, or null. Zero is a real answer and survives. */
function numberOrNull(value: JsonValue | undefined): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  const long = unwrapLong(value);
  const numeric = Number(long === null ? value : long);
  return Number.isFinite(numeric) ? numeric : null;
}

function ratioOrNull(value: JsonValue | undefined): number | null {
  const numeric = numberOrNull(value);
  return numeric === null ? null : Math.min(1, Math.max(0, numeric));
}

/**
 * Dogma attribute IDs for the two limits the SERVER enforces on a launch.
 *
 * They are read here rather than computed anywhere: 352 is how many drones may
 * be in space at once, 1271 is the hull's drone bandwidth in Mbit/sec, and each
 * drone type draws its own bandwidth against it. The client shows both and then
 * LETS THE SERVER REFUSE — pre-guessing a refusal here would mean
 * re-implementing the launch rules in the browser, and a browser that guesses
 * wrong either blocks a legal launch or promises an illegal one.
 */
const ATTR_MAX_ACTIVE_DRONES = 352;
const ATTR_DRONE_BANDWIDTH = 1271;

/**
 * The launch limits, read out of the ship's ordinary attribute map (the same
 * dogmaIM.ShipGetInfo result the fitting panel decodes — no new server call).
 *
 * Both are null when the ship has no such attribute, which is the honest answer
 * for a hull with no drone bay at all. A zero would read as "this ship may
 * carry no drones", which is TRUE for such a hull but indistinguishable from a
 * read that failed — so the panel is told "unknown" and says so.
 */
export function decodeDroneLimits(shipInfo: JsonValue | undefined): DroneLimits {
  if (shipInfo === undefined || shipInfo === null) {
    return { maxActiveDrones: null, droneBandwidth: null };
  }
  const attributes = decodeShipAttributes(shipInfo);
  const max = attributes.get(ATTR_MAX_ACTIVE_DRONES);
  const bandwidth = attributes.get(ATTR_DRONE_BANDWIDTH);
  return {
    maxActiveDrones: max === undefined || max === null ? null : Math.max(0, Math.trunc(max)),
    droneBandwidth:
      bandwidth === undefined || bandwidth === null ? null : Math.max(0, bandwidth),
  };
}

/**
 * The drone bay's stacks. `null` means the bay could not be read — NOT that it
 * is empty.
 */
export function decodeDroneBay(raw: JsonValue | undefined): readonly DroneBayStack[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const stacks: DroneBayStack[] = [];
  for (const entry of raw as JsonValue[]) {
    const row = asObject(entry);
    const itemID = idOrNull(row.itemID);
    const typeID = idOrNull(row.typeID);
    if (itemID === null || typeID === null) {
      continue;
    }
    stacks.push({ itemID, typeID, quantity: numberOrNull(row.quantity) ?? 1 });
  }
  return stacks;
}

/**
 * The drones actually in space, as the SERVER reports them. `null` means the
 * snapshot could not be read.
 */
export function decodeDronesInSpace(raw: JsonValue | undefined): readonly DroneInSpace[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const drones: DroneInSpace[] = [];
  for (const entry of raw as JsonValue[]) {
    const row = asObject(entry);
    const itemID = idOrNull(row.itemID);
    if (itemID === null) {
      continue;
    }
    drones.push({
      itemID,
      typeID: idOrNull(row.typeID),
      name: typeof row.name === "string" && row.name.length > 0 ? row.name : null,
      // null stays null: "we could not tell what it is doing" is not "idle".
      activity: typeof row.activity === "string" && row.activity.length > 0 ? row.activity : null,
      targetID: idOrNull(row.targetID),
      shieldRatio: ratioOrNull(row.shieldRatio),
      armorRatio: ratioOrNull(row.armorRatio),
      hullRatio: ratioOrNull(row.hullRatio),
    });
  }
  return drones;
}

/**
 * What a drone is doing, in the words a player uses (R9a).
 *
 * The gateway already turned the runtime's activity enum into a token; this
 * turns the token into a sentence fragment. An UNKNOWN token is rendered as
 * "Unknown", never silently as "Idle" — a player who is told their drones are
 * idle when nobody looked will not launch the ones that would have saved them.
 */
export function droneActivityLabel(activity: string | null): string {
  switch (activity) {
    case "idle":
      return "Waiting";
    case "fighting":
      return "Attacking";
    case "mining":
      return "Mining";
    case "approaching":
      return "Closing in";
    case "returning":
      return "Coming home";
    case "chasing":
      return "Chasing";
    case "salvaging":
      return "Salvaging";
    default:
      return "Unknown";
  }
}

/**
 * Is a drone busy, as far as the server is concerned? Used only to sort the
 * working drones above the waiting ones. An unknown activity counts as NOT
 * busy, so it sorts with the drones a player might want to give a job to.
 */
export function droneIsBusy(activity: string | null): boolean {
  return (
    activity === "fighting" ||
    activity === "mining" ||
    activity === "approaching" ||
    activity === "chasing" ||
    activity === "salvaging"
  );
}
