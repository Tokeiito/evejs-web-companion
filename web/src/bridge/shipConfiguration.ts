// ship.GetShipConfiguration decoded to a plain record (goal R71, PLUMBING ONLY —
// no UI).
//
// GET /api/bridge/ship-configuration returns the SESSION's own active-ship SMB /
// fleet-hangar sharing flags. ⚠ The route calls GetShipConfiguration ARG-LESS on
// purpose: the handler (_getShipConfiguration) looks a supplied shipID up with NO
// ownership check — verified LIVE that a FOREIGN shipID is honored, returning that
// ship's config — so forwarding a client shipID would leak another ship's config.
// Arg-less pins the read to the session's active ship (shipService._getShipID).
//
// Captured LIVE from Farmer (char 140000005) on 2026-07-22:
//   {type:"dict", entries:[
//     ["allowFleetSMBUsage", false], ["SMB_AllowFleetAccess", false],
//     ["allowCorpSMBUsage", false],  ["SMB_AllowCorpAccess", false],
//     ["FleetHangar_AllowFleetAccess", false], ["FleetHangar_AllowCorpAccess", false]]}
// All false is a real "sharing disabled" state, not an absence.

import { readDictEntry, type JsonValue } from "./wire.ts";

/** The ship maintenance bay / fleet hangar access-sharing flags. */
export interface ShipConfiguration {
  /** Ship maintenance bay: fleet may use it. */
  readonly allowFleetSMBUsage: boolean;
  /** Ship maintenance bay: fleet access flag (server keeps this in step with the above). */
  readonly smbAllowFleetAccess: boolean;
  /** Ship maintenance bay: corp may use it. */
  readonly allowCorpSMBUsage: boolean;
  /** Ship maintenance bay: corp access flag. */
  readonly smbAllowCorpAccess: boolean;
  /** Fleet hangar: fleet access. */
  readonly fleetHangarAllowFleetAccess: boolean;
  /** Fleet hangar: corp access. */
  readonly fleetHangarAllowCorpAccess: boolean;
}

function toBool(value: JsonValue | undefined): boolean {
  return value === true;
}

/**
 * Decode ship.GetShipConfiguration -> the sharing flags. null when the value is not
 * the expected dict (so a caller can tell "read failed / absent" from "present and
 * all-false"). A missing flag reads as false.
 */
export function decodeShipConfiguration(
  result: JsonValue | null | undefined,
): ShipConfiguration | null {
  if (
    typeof result !== "object" ||
    result === null ||
    Array.isArray(result) ||
    (result as { type?: unknown }).type !== "dict"
  ) {
    return null;
  }
  return {
    allowFleetSMBUsage: toBool(readDictEntry(result, "allowFleetSMBUsage")),
    smbAllowFleetAccess: toBool(readDictEntry(result, "SMB_AllowFleetAccess")),
    allowCorpSMBUsage: toBool(readDictEntry(result, "allowCorpSMBUsage")),
    smbAllowCorpAccess: toBool(readDictEntry(result, "SMB_AllowCorpAccess")),
    fleetHangarAllowFleetAccess: toBool(readDictEntry(result, "FleetHangar_AllowFleetAccess")),
    fleetHangarAllowCorpAccess: toBool(readDictEntry(result, "FleetHangar_AllowCorpAccess")),
  };
}
